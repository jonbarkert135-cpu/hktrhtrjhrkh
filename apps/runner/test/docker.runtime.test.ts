/**
 * The default docker runtime: argv only (never a shell), digest verified after the pull, and a
 * failing docker call surfaced as a canonical error instead of a raw stderr dump.
 */

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const { dockerRuntime, DOCKER_BIN } = await import('../src/executors/container.ts');

/** A fake `docker` process that writes `stdout` and exits with `code`. */
function fakeDocker(stdout: string, code = 0): EventEmitter & { kill: () => void } {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    if (code !== 0) child.stderr.emit('data', Buffer.from('docker: boom'));
    child.emit('close', code);
  }, 0);
  return child;
}

const digest = `sha256:${'a'.repeat(64)}`;

afterEach(() => {
  spawnMock.mockReset();
});

describe('docker runtime', () => {
  it('pulls by digest and verifies the digest that came back', async () => {
    spawnMock
      .mockImplementationOnce(() => fakeDocker(''))
      .mockImplementationOnce(() => fakeDocker(`example/tool@${digest}\n`));

    await dockerRuntime().pull('example/tool', digest, 30_000);

    expect(spawnMock.mock.calls[0]?.[0]).toBe(DOCKER_BIN);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(['pull', `example/tool@${digest}`]);
    expect(spawnMock.mock.calls[1]?.[1]).toContain('inspect');
  });

  it('fails closed when the resolved digest is a different image', async () => {
    spawnMock
      .mockImplementationOnce(() => fakeDocker(''))
      .mockImplementationOnce(() => fakeDocker(`example/tool@sha256:${'b'.repeat(64)}\n`));

    await expect(dockerRuntime().pull('example/tool', digest, 30_000)).rejects.toThrow(
      /IMAGE_DIGEST_MISMATCH/,
    );
  });

  it('turns a non-zero docker exit into TOOL_UNAVAILABLE', async () => {
    spawnMock.mockImplementation(() => fakeDocker('', 1));
    await expect(dockerRuntime().pull('example/tool', digest, 30_000)).rejects.toThrow(
      /TOOL_UNAVAILABLE/,
    );
  });

  it('spawns the container with argv and the injected env only', () => {
    spawnMock.mockImplementation(() => fakeDocker(''));
    dockerRuntime().spawn(['run', '--rm', 'example/tool'], { API_TOKEN: 'x' });
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(['run', '--rm', 'example/tool']);
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({
      env: expect.objectContaining({ API_TOKEN: 'x' }) as Record<string, string>,
    });
  });

  it('reads an output file, and reports a missing one as undefined', async () => {
    spawnMock.mockImplementationOnce(() => fakeDocker('{"ok":true}'));
    const runtime = dockerRuntime();
    const found = await runtime.readOutput('run-1', '/work/out.json');
    expect(new TextDecoder().decode(found)).toBe('{"ok":true}');

    spawnMock.mockImplementationOnce(() => fakeDocker('', 1));
    expect(await runtime.readOutput('run-1', '/work/missing.json')).toBeUndefined();
  });

  it('kills by run id and never rejects when the container is already gone', async () => {
    spawnMock.mockImplementation(() => fakeDocker('', 1));
    await expect(dockerRuntime().kill('run-1', 'SIGKILL')).resolves.toBeUndefined();
  });

  it('lists the run ids of labelled containers, skipping blank lines', async () => {
    spawnMock.mockImplementationOnce(() => fakeDocker('run-1\nrun-2\n\n'));
    expect(await dockerRuntime().listRunIds()).toEqual(['run-1', 'run-2']);
  });
});
