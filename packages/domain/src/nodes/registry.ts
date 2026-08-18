/**
 * The node type registry (06_NODE_SYSTEM.md §3). Adding a type touches this directory only: one
 * file under `types/` plus a `register()` call in `registerBuiltins()`.
 *
 * `get()` never throws on an unknown type — an unrecognised payload from a newer client, a plugin
 * or an import is rendered by the `unknown` definition, read-only, and its data is preserved
 * verbatim (08_DATA_MODEL.md §2.6 forward compatibility).
 */

import { UNKNOWN_NODE_TYPE } from '../entities/node.ts';
import type { AnyNodeTypeDefinition, NodeTypeDefinition } from './types.ts';

export class NodeTypeRegistry {
  readonly #types = new Map<string, AnyNodeTypeDefinition>();

  register<TData>(def: NodeTypeDefinition<TData>): void {
    if (this.#types.has(def.type)) {
      throw new Error(`Node type "${def.type}" is already registered`);
    }
    this.#types.set(def.type, def);
  }

  /** Replaces an existing definition. Used by plugins and by tests, never during boot. */
  override<TData>(def: NodeTypeDefinition<TData>): void {
    this.#types.set(def.type, def);
  }

  has(type: string): boolean {
    return this.#types.has(type);
  }

  /** Falls back to the `unknown` definition so callers never branch on "is this type known?". */
  get(type: string): AnyNodeTypeDefinition {
    const found = this.#types.get(type) ?? this.#types.get(UNKNOWN_NODE_TYPE);
    if (found === undefined) {
      throw new Error('Node type registry is empty: registerBuiltins() was never called');
    }
    return found;
  }

  list(): AnyNodeTypeDefinition[] {
    return [...this.#types.values()];
  }

  ids(): string[] {
    return [...this.#types.keys()];
  }

  clear(): void {
    this.#types.clear();
  }

  /**
   * CI guard: every registered type must be able to paint, render, be inspected, be searched and
   * be exported. A type missing one of those is a half-shipped type, and half-shipped types are
   * what produce blank cards in production.
   */
  assertComplete(): void {
    const problems: string[] = [];
    for (const def of this.#types.values()) {
      if (def.label.trim() === '') problems.push(`${def.type}: empty label`);
      if (def.componentId.trim() === '') problems.push(`${def.type}: no componentId`);
      if (def.glyph.colorToken.trim() === '') problems.push(`${def.type}: no colour token`);
      if (def.glyph.icon.trim() === '') problems.push(`${def.type}: no icon`);
      if (def.inspector.length === 0) problems.push(`${def.type}: no inspector fields`);
      if (def.defaults.size.w < def.defaults.minSize.w)
        problems.push(`${def.type}: size < minSize`);
      if (def.defaults.size.w > def.defaults.maxSize.w)
        problems.push(`${def.type}: size > maxSize`);
    }
    if (!this.#types.has(UNKNOWN_NODE_TYPE)) problems.push('no "unknown" fallback type');
    if (problems.length > 0) {
      throw new Error(`Incomplete node type definitions:\n- ${problems.join('\n- ')}`);
    }
  }
}

/** The registry the application uses. Tests build their own instance when they need isolation. */
export const nodeTypes = new NodeTypeRegistry();
