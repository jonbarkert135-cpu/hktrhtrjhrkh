import { afterEach, describe, expect, it, vi } from 'vitest';
import { xhrPut } from './upload.ts';

interface FakeXhr {
  method: string;
  url: string;
  headers: Record<string, string>;
  sent: Blob | null;
  status: number;
  aborted: boolean;
}

const original = globalThis.XMLHttpRequest;

/** Installs a fake XHR and returns the last instance created. */
const installXhr = (): { last: () => FakeXhr; fire: (event: 'load' | 'error') => void } => {
  let instance: (FakeXhr & Record<string, unknown>) | null = null;
  class Fake {
    method = '';
    url = '';
    headers: Record<string, string> = {};
    sent: Blob | null = null;
    status = 200;
    aborted = false;
    upload: { onprogress?: (event: { loaded: number }) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    constructor() {
      instance = this as unknown as FakeXhr & Record<string, unknown>;
    }
    open(method: string, url: string): void {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string): void {
      this.headers[name] = value;
    }
    send(blob: Blob): void {
      this.sent = blob;
      this.upload.onprogress?.({ loaded: blob.size });
    }
    abort(): void {
      this.aborted = true;
      this.onabort?.();
    }
  }
  globalThis.XMLHttpRequest = Fake as unknown as typeof XMLHttpRequest;
  return {
    last: () => instance as unknown as FakeXhr,
    fire: (event) => {
      const target = instance as unknown as Record<string, () => void>;
      target[event === 'load' ? 'onload' : 'onerror']?.();
    },
  };
};

afterEach(() => {
  globalThis.XMLHttpRequest = original;
});

const blob = new Blob([new Uint8Array(16)], { type: 'image/png' });

describe('xhrPut', () => {
  it('PUTs the blob, sets the content type and reports upload progress', async () => {
    const xhr = installXhr();
    const onProgress = vi.fn();
    const promise = xhrPut({
      url: 'https://s3.example.com/put',
      blob,
      contentType: 'image/png',
      onProgress,
      signal: new AbortController().signal,
    });
    xhr.fire('load');
    await expect(promise).resolves.toBeUndefined();

    expect(xhr.last().method).toBe('PUT');
    expect(xhr.last().url).toBe('https://s3.example.com/put');
    expect(xhr.last().headers['Content-Type']).toBe('image/png');
    expect(onProgress).toHaveBeenCalledWith(16);
  });

  it('rejects on a non-2xx status with a message that invites a retry', async () => {
    const xhr = installXhr();
    const promise = xhrPut({
      url: 'u',
      blob,
      contentType: '',
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });
    (xhr.last() as unknown as { status: number }).status = 503;
    xhr.fire('load');
    await expect(promise).rejects.toThrow(/status 503\. Retrying may help/);
    expect(xhr.last().headers['Content-Type']).toBeUndefined();
  });

  it('rejects on a transport error', async () => {
    const xhr = installXhr();
    const promise = xhrPut({
      url: 'u',
      blob,
      contentType: 'image/png',
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });
    xhr.fire('error');
    await expect(promise).rejects.toThrow(/Check your connection/);
  });

  it('aborts the request when the signal fires', async () => {
    const xhr = installXhr();
    const controller = new AbortController();
    const promise = xhrPut({
      url: 'u',
      blob,
      contentType: 'image/png',
      onProgress: vi.fn(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toThrow(/Cancelled/);
    expect(xhr.last().aborted).toBe(true);
  });
});
