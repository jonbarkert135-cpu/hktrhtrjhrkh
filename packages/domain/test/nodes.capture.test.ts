/**
 * Capture routing (06 §7.1). A paste must always land on the same type for the same input, and a
 * payload nobody claims must still become a node — dropping the analyst's clipboard is not an
 * option.
 */

import { describe, expect, it } from 'vitest';

import { NodeTypeRegistry } from '../src/nodes/registry.ts';
import { decideCapture } from '../src/nodes/capture.ts';
import { registerBuiltins } from '../src/nodes/builtins.ts';
import { unknownType } from '../src/nodes/types/unknown.ts';

const registry = registerBuiltins(new NodeTypeRegistry());

describe('decideCapture', () => {
  it('routes a plain URL to a website node', () => {
    const decision = decideCapture({ kind: 'url', text: 'https://example.com/a' }, registry);
    expect(decision.type).toBe('website');
    expect(decision.title).toBe('example.com');
    expect(decision.data['url']).toBe('https://example.com/a');
  });

  it('prefers repo over website for a GitHub URL and parses owner/name', () => {
    const decision = decideCapture(
      { kind: 'url', text: 'https://github.com/jonbarkert135-cpu/osint-site.git' },
      registry,
    );
    expect(decision.type).toBe('repo');
    expect(decision.data['owner']).toBe('jonbarkert135-cpu');
    expect(decision.data['name']).toBe('osint-site');
    expect(decision.data['provider']).toBe('github');
  });

  it('recognises a GitLab URL', () => {
    const decision = decideCapture(
      { kind: 'url', text: 'https://gitlab.com/group/project' },
      registry,
    );
    expect(decision.data['provider']).toBe('gitlab');
  });

  it('routes an email address to a person node', () => {
    const decision = decideCapture({ kind: 'text', text: ' ada@example.com ' }, registry);
    expect(decision.type).toBe('person');
    expect(decision.data['emails']).toEqual(['ada@example.com']);
  });

  it('routes prose to a text node', () => {
    const decision = decideCapture({ kind: 'text', text: 'A paragraph of notes' }, registry);
    expect(decision.type).toBe('text');
    expect(decision.data['plain']).toBe('A paragraph of notes');
  });

  it('routes an image file to an image node and anything else to a file node', () => {
    expect(
      decideCapture({ kind: 'file', mime: 'image/png', filename: 'a.png' }, registry).type,
    ).toBe('image');
    const pdf = decideCapture(
      { kind: 'file', mime: 'application/pdf', filename: 'report.pdf', size: 42 },
      registry,
    );
    expect(pdf.type).toBe('file');
    expect(pdf.data['mime']).toBe('application/pdf');
    expect(pdf.data['size']).toBe(42);
  });

  it('falls back to text when no type claims the payload', () => {
    const decision = decideCapture({ kind: 'text', text: '' }, registry);
    expect(decision.type).toBe('text');
    expect(decision.score).toBeGreaterThan(0);
  });

  it('falls back to unknown when even text is unavailable', () => {
    const bare = new NodeTypeRegistry();
    bare.override(unknownType);
    const decision = decideCapture({ kind: 'text', text: 'hello' }, bare);
    expect(decision.type).toBe('unknown');
    expect(decision.score).toBe(0);
    expect(decision.title).toBe('hello');
  });

  it('is deterministic for the same input', () => {
    const input = { kind: 'url', text: 'https://example.com' } as const;
    expect(decideCapture(input, registry)).toEqual(decideCapture(input, registry));
  });
});
