/**
 * Incremental SHA-256 (FIPS 180-4).
 *
 * ponytail: hand-rolled instead of `crypto.subtle.digest`, because the browser upload path hashes
 * a file *while* streaming it to S3 (09_BACKEND.md §7.1) and WebCrypto exposes no streaming digest
 * — buffering a 100 MB file to hash it would defeat the point. `packages/domain` must also stay
 * runtime-agnostic (N-pure): the same class runs in the SPA, in tests and on the server.
 * Upgrade path: swap the internals for a WebCrypto streaming digest if one ever ships; the public
 * surface (`update` / `hex`) is the whole contract.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Streaming SHA-256: `update()` any number of chunks, then read `hex()` once. */
export class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockLength = 0;
  private totalBytes = 0;
  private finished = false;

  /** Feed the next chunk. Chunks may be any size, including 0. */
  update(chunk: Uint8Array): this {
    if (this.finished) throw new Error('Sha256: update() after hex()');
    this.totalBytes += chunk.length;
    let offset = 0;
    if (this.blockLength > 0) {
      const need = Math.min(64 - this.blockLength, chunk.length);
      this.block.set(chunk.subarray(0, need), this.blockLength);
      this.blockLength += need;
      offset = need;
      if (this.blockLength === 64) {
        this.compress(this.block, 0);
        this.blockLength = 0;
      }
    }
    while (chunk.length - offset >= 64) {
      this.compress(chunk, offset);
      offset += 64;
    }
    if (offset < chunk.length) {
      this.block.set(chunk.subarray(offset), 0);
      this.blockLength = chunk.length - offset;
    }
    return this;
  }

  /** Finalize and return the lowercase hex digest. Calling it twice returns the same string. */
  hex(): string {
    if (!this.finished) {
      const bitLength = this.totalBytes * 8;
      const tail = new Uint8Array(this.blockLength < 56 ? 64 : 128);
      tail.set(this.block.subarray(0, this.blockLength), 0);
      tail[this.blockLength] = 0x80;
      // Length is a 64-bit big-endian bit count; JS numbers cover the low 53 bits exactly, which
      // is 1 PB — far above the 2 GB per-file cap (09_BACKEND.md §7.3).
      const view = new DataView(tail.buffer);
      view.setUint32(tail.length - 8, Math.floor(bitLength / 0x100000000), false);
      view.setUint32(tail.length - 4, bitLength >>> 0, false);
      for (let i = 0; i < tail.length; i += 64) this.compress(tail, i);
      this.finished = true;
      this.blockLength = 0;
    }
    let out = '';
    for (let i = 0; i < 8; i += 1) out += (this.state[i] ?? 0).toString(16).padStart(8, '0');
    return out;
  }

  private compress(input: Uint8Array, offset: number): void {
    const { w, state } = this;
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] =
        ((input[j] ?? 0) << 24) |
        ((input[j + 1] ?? 0) << 16) |
        ((input[j + 2] ?? 0) << 8) |
        (input[j + 3] ?? 0);
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15] ?? 0;
      const y = w[i - 2] ?? 0;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0;
    }
    // Read out explicitly: `noUncheckedIndexedAccess` types every typed-array read as possibly
    // undefined, and the working variables must stay plain numbers through the 64 rounds.
    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    state[0] = ((state[0] ?? 0) + a) | 0;
    state[1] = ((state[1] ?? 0) + b) | 0;
    state[2] = ((state[2] ?? 0) + c) | 0;
    state[3] = ((state[3] ?? 0) + d) | 0;
    state[4] = ((state[4] ?? 0) + e) | 0;
    state[5] = ((state[5] ?? 0) + f) | 0;
    state[6] = ((state[6] ?? 0) + g) | 0;
    state[7] = ((state[7] ?? 0) + h) | 0;
  }
}

/** One-shot convenience wrapper around {@link Sha256}. */
export function sha256Hex(data: Uint8Array): string {
  return new Sha256().update(data).hex();
}

/** True for the exact shape the API accepts as a content hash (64 lowercase hex chars). */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
