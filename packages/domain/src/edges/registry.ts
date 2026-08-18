/**
 * The relationship type registry (07_EDGE_SYSTEM.md §3.1) — the same contract as the node
 * registry: adding a relationship touches this directory only.
 *
 * `get()` never throws on an unknown type. A type from a newer client, a plugin or an import is
 * served by the `custom` definition, so an unrecognised relationship still paints, still exports
 * and still round-trips instead of blanking the board.
 */

import { CUSTOM_EDGE_TYPE, type EdgeTypeDefinition } from './types.ts';

export class EdgeTypeRegistry {
  readonly #types = new Map<string, EdgeTypeDefinition>();

  register(def: EdgeTypeDefinition): void {
    if (this.#types.has(def.type)) {
      throw new Error(`Edge type "${def.type}" is already registered`);
    }
    this.#types.set(def.type, def);
  }

  /** Replaces an existing definition. Used by plugins and by tests, never during boot. */
  override(def: EdgeTypeDefinition): void {
    this.#types.set(def.type, def);
  }

  has(type: string): boolean {
    return this.#types.has(type);
  }

  /** Falls back to `custom` so callers never branch on "is this type known?". */
  get(type: string): EdgeTypeDefinition {
    const found = this.#types.get(type) ?? this.#types.get(CUSTOM_EDGE_TYPE);
    if (found === undefined) {
      throw new Error('Edge type registry is empty: registerEdgeBuiltins() was never called');
    }
    return found;
  }

  list(): EdgeTypeDefinition[] {
    return [...this.#types.values()];
  }

  ids(): string[] {
    return [...this.#types.keys()];
  }

  clear(): void {
    this.#types.clear();
  }

  /**
   * CI guard: a relationship type must be readable in both directions, paintable and constrained.
   * A definition missing one of those is a half-shipped type, and half-shipped types are what
   * produce unlabelled grey lines nobody can interpret six months later.
   */
  assertComplete(): void {
    const problems: string[] = [];
    for (const def of this.#types.values()) {
      if (def.label.trim() === '') problems.push(`${def.type}: empty label`);
      if (def.inverseLabel.trim() === '') problems.push(`${def.type}: empty inverse label`);
      if (def.strokeToken.trim() === '') problems.push(`${def.type}: no stroke token`);
      if (def.width <= 0) problems.push(`${def.type}: non-positive width`);
      if (def.allowed.length === 0) problems.push(`${def.type}: no endpoint rules`);
      if (def.directed === false && def.arrowTarget !== 'none' && def.arrowTarget !== 'dot') {
        problems.push(`${def.type}: undirected but carries a directional arrowhead`);
      }
    }
    if (!this.#types.has(CUSTOM_EDGE_TYPE)) problems.push(`no "${CUSTOM_EDGE_TYPE}" fallback type`);
    if (problems.length > 0) {
      throw new Error(`Incomplete edge type definitions:\n- ${problems.join('\n- ')}`);
    }
  }
}

/** The registry the application uses. Tests build their own instance when they need isolation. */
export const edgeTypes = new EdgeTypeRegistry();
