// Waits for the API to report ready, then seeds the dev data set (18_TESTING.md §15).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const READY_TIMEOUT_MS = 90_000;
const POLL_MS = 1_000;

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/readyz`);
      if (res.ok) return;
      // /readyz names the failing dependency in its body; without it a 503 is undiagnosable in CI.
      lastError = `${res.status} ${res.statusText} ${await res.text()}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(
    `e2e: ${API_URL}/readyz did not become ready within ${READY_TIMEOUT_MS / 1000}s (last: ${lastError}).\n` +
      'Start the stack with `docker compose -f infra/docker-compose.yml up -d && pnpm db:migrate`.',
  );
}

export default async function globalSetup(): Promise<void> {
  await waitForReady();
  if (process.env.E2E_SKIP_SEED === '1') return;
  // Seeds are idempotent: they truncate and recreate their own namespace only.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync('pnpm', ['db:seed'], { cwd: repoRoot, stdio: 'inherit' });
}
