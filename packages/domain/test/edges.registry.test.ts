import { describe, expect, it } from 'vitest';

import {
  ANY_NODE_TYPE,
  CUSTOM_EDGE_TYPE,
  EDGE_CATEGORIES,
  EdgeTypeRegistry,
  builtinEdgeTypeDefinitions,
  builtinEdgeTypes,
  defineEdgeType,
  registerEdgeBuiltins,
} from '../src/edges/index.ts';

const fresh = (): EdgeTypeRegistry => registerEdgeBuiltins(new EdgeTypeRegistry());

describe('edge type registry', () => {
  it('registers every built-in relationship exactly once', () => {
    const registry = fresh();
    const ids = registry.ids();
    expect(new Set(ids).size).toBe(ids.length);
    // 22 taxonomy types (07 §3.2) plus `related_to` and `custom`.
    expect(ids.length).toBe(24);
    expect(builtinEdgeTypeDefinitions.length).toBe(ids.length);
  });

  it('accepts a complete taxonomy', () => {
    expect(() => fresh().assertComplete()).not.toThrow();
  });

  it('serves unknown relationship types with the custom definition instead of throwing', () => {
    const registry = fresh();
    expect(registry.has('invented_by_a_plugin')).toBe(false);
    expect(registry.get('invented_by_a_plugin').type).toBe(CUSTOM_EDGE_TYPE);
  });

  it('throws when the registry was never populated', () => {
    const registry = new EdgeTypeRegistry();
    expect(() => registry.get('references')).toThrow(/registerEdgeBuiltins/);
  });

  it('refuses to register the same type twice but allows an explicit override', () => {
    const registry = fresh();
    const references = registry.get('references');
    expect(() => {
      registry.register(references);
    }).toThrow(/already registered/);
    registry.override({ ...references, label: 'points at' });
    expect(registry.get('references').label).toBe('points at');
  });

  it('clears', () => {
    const registry = fresh();
    registry.clear();
    expect(registry.list()).toEqual([]);
  });

  it('reports incomplete definitions with the offending type id', () => {
    const registry = fresh();
    registry.override(
      defineEdgeType({
        type: 'broken',
        label: '  ',
        inverseLabel: '',
        category: 'structural',
        strokeToken: ' ',
        width: 0,
        allowed: [],
      }),
    );
    expect(() => {
      registry.assertComplete();
    }).toThrow(/broken: empty label/);
  });

  it('rejects an undirected relationship that carries a directional arrowhead', () => {
    const registry = fresh();
    registry.override(
      defineEdgeType({
        type: 'confused',
        label: 'confused',
        inverseLabel: 'confused',
        category: 'social',
        directed: false,
        arrowTarget: 'arrow',
      }),
    );
    expect(() => {
      registry.assertComplete();
    }).toThrow(/directional arrowhead/);
  });

  it('requires a custom fallback', () => {
    const registry = fresh();
    const withoutCustom = new EdgeTypeRegistry();
    for (const def of registry.list()) {
      if (def.type !== CUSTOM_EDGE_TYPE) withoutCustom.register(def);
    }
    expect(() => {
      withoutCustom.assertComplete();
    }).toThrow(/fallback type/);
  });

  it('exposes a populated shared registry', () => {
    const registry = builtinEdgeTypes();
    expect(registry.get('works_at').inverseLabel).toBe('employs');
    // Idempotent: a second call must not throw on re-registration.
    expect(builtinEdgeTypes().ids().length).toBe(registry.ids().length);
  });

  it('gives every relationship a known category and a usable default', () => {
    for (const def of fresh().list()) {
      expect(EDGE_CATEGORIES).toContain(def.category);
      expect(def.width).toBeGreaterThan(0);
      expect(def.allowed.length).toBeGreaterThan(0);
    }
  });

  it('defaults an unspecified definition to an any-to-any directed relationship', () => {
    const def = defineEdgeType({
      type: 'minimal',
      label: 'minimal',
      inverseLabel: 'minimal by',
      category: 'structural',
    });
    expect(def.directed).toBe(true);
    expect(def.arrowTarget).toBe('arrow');
    expect(def.defaultRouting).toBe('smart');
    expect(def.allowed[0]?.source).toEqual([ANY_NODE_TYPE]);
    expect(def.suggest).toBeUndefined();
  });

  it('keeps a provided heuristic', () => {
    const def = defineEdgeType({
      type: 'heuristic',
      label: 'h',
      inverseLabel: 'h',
      category: 'code',
      suggest: () => 0.5,
    });
    expect(def.suggest?.('a', 'b', {})).toBe(0.5);
  });
});
