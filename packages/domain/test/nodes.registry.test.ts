/**
 * Registry contract (06_NODE_SYSTEM.md §3). These tests are the reason "adding a type = adding a
 * file" holds: a type that cannot paint, be inspected, be searched or be exported fails here
 * instead of shipping a blank card.
 */

import { describe, expect, it } from 'vitest';

import { NodeTypeRegistry } from '../src/nodes/registry.ts';
import { builtinNodeTypes, registerBuiltins } from '../src/nodes/index.ts';
import { linkType } from '../src/nodes/types/link.ts';
import { UNKNOWN_NODE_TYPE, makeNode } from '../src/entities/node.ts';
import type { TypedNode } from '../src/nodes/types.ts';

const T0 = '2026-01-01T00:00:00.000Z';

const nodeOf = (type: string, data: Record<string, unknown>): TypedNode<never> =>
  makeNode(
    { id: `n_${type}`, type, x: 0, y: 0, title: `${type} title`, data },
    T0,
  ) as TypedNode<never>;

describe('NodeTypeRegistry', () => {
  it('registers, finds and lists types', () => {
    const registry = registerBuiltins(new NodeTypeRegistry());
    expect(registry.has('website')).toBe(true);
    expect(registry.get('website').label).toBe('Website');
    expect(registry.ids()).toHaveLength(9);
    expect(registry.list().map((def) => def.type)).toContain('repo');
  });

  it('refuses a duplicate registration but allows an explicit override', () => {
    const registry = new NodeTypeRegistry();
    registry.register(linkType);
    expect(() => {
      registry.register(linkType);
    }).toThrow(/already registered/);
    registry.override({ ...linkType, label: 'Reference' });
    expect(registry.get('link').label).toBe('Reference');
  });

  it('falls back to the unknown definition instead of throwing', () => {
    const registry = registerBuiltins(new NodeTypeRegistry());
    expect(registry.get('type-from-a-newer-client').type).toBe(UNKNOWN_NODE_TYPE);
  });

  it('reports an empty registry rather than returning undefined', () => {
    const registry = new NodeTypeRegistry();
    expect(() => registry.get('website')).toThrow(/registerBuiltins/);
  });

  it('clear() empties the registry', () => {
    const registry = registerBuiltins(new NodeTypeRegistry());
    registry.clear();
    expect(registry.ids()).toEqual([]);
  });

  describe('assertComplete', () => {
    it('passes for the built-in types', () => {
      expect(() => {
        registerBuiltins(new NodeTypeRegistry()).assertComplete();
      }).not.toThrow();
    });

    it('names every incomplete definition', () => {
      const registry = registerBuiltins(new NodeTypeRegistry());
      registry.override({ ...linkType, label: '  ', componentId: '', inspector: [] });
      registry.override({
        ...linkType,
        type: 'broken-size',
        defaults: { ...linkType.defaults, size: { w: 10, h: 10 } },
      });
      expect(() => {
        registry.assertComplete();
      }).toThrow(/empty label[\s\S]*no componentId[\s\S]*no inspector fields/);
    });

    it('requires an unknown fallback type', () => {
      const registry = registerBuiltins(new NodeTypeRegistry());
      const partial = new NodeTypeRegistry();
      for (const def of registry.list()) if (def.type !== UNKNOWN_NODE_TYPE) partial.override(def);
      expect(() => {
        partial.assertComplete();
      }).toThrow(/unknown/);
    });

    it('rejects a glyph without a colour token or icon', () => {
      const registry = registerBuiltins(new NodeTypeRegistry());
      registry.override({ ...linkType, glyph: { colorToken: '', icon: '', shape: 'rounded' } });
      expect(() => {
        registry.assertComplete();
      }).toThrow(/no colour token[\s\S]*no icon/);
    });

    it('rejects a default size above the maximum', () => {
      const registry = registerBuiltins(new NodeTypeRegistry());
      registry.override({
        ...linkType,
        defaults: { ...linkType.defaults, maxSize: { w: 10, h: 10 } },
      });
      expect(() => {
        registry.assertComplete();
      }).toThrow(/size > maxSize/);
    });
  });
});

describe('built-in type capabilities', () => {
  const registry = builtinNodeTypes();

  it('every type parses its own defaults', () => {
    for (const def of registry.list()) {
      expect(() => def.schema.parse(def.defaults.data)).not.toThrow();
    }
  });

  it('every type produces search fields, identity keys and markdown', () => {
    for (const def of registry.list()) {
      const node = nodeOf(def.type, def.defaults.data as Record<string, unknown>);
      const search = def.searchFields(node);
      expect(typeof search.title).toBe('string');
      expect(typeof search.body).toBe('string');
      expect(Array.isArray(search.keywords)).toBe(true);
      expect(Array.isArray(def.identityKeys(node))).toBe(true);
      expect(typeof def.io.toMarkdown(node)).toBe('string');
    }
  });

  it('every type round-trips its payload through export', () => {
    for (const def of registry.list()) {
      const node = nodeOf(def.type, def.defaults.data as Record<string, unknown>);
      const exported = def.io.toExport(node);
      expect(def.io.fromExport(exported)).toEqual(def.schema.parse(exported));
    }
  });

  it('gives every type a distinct colour token', () => {
    const tokens = registry.list().map((def) => def.glyph.colorToken);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('exposes builtinNodeTypes() already populated', () => {
    expect(builtinNodeTypes().has('note')).toBe(true);
  });
});
