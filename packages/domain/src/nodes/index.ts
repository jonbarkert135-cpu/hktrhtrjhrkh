/**
 * Built-in node types (06_NODE_SYSTEM.md §1). `registerBuiltins()` is the only place that knows the
 * full list; everything else asks the registry. It is idempotent so tests and hot reloads can call
 * it freely.
 */

import { nodeTypes } from './registry.ts';
import type { NodeTypeRegistry } from './registry.ts';
import { fileType } from './types/file.ts';
import { imageType } from './types/image.ts';
import { linkType } from './types/link.ts';
import { noteType } from './types/note.ts';
import { personType } from './types/person.ts';
import { repoType } from './types/repo.ts';
import { textType } from './types/text.ts';
import { unknownType } from './types/unknown.ts';
import { websiteType } from './types/website.ts';

export function registerBuiltins(registry: NodeTypeRegistry = nodeTypes): NodeTypeRegistry {
  for (const def of [
    websiteType,
    linkType,
    textType,
    noteType,
    imageType,
    fileType,
    personType,
    repoType,
    unknownType,
  ]) {
    registry.override(def);
  }
  return registry;
}

/** The registry, guaranteed populated. Import this instead of `nodeTypes` from application code. */
export function builtinNodeTypes(): NodeTypeRegistry {
  if (!nodeTypes.has('website')) registerBuiltins(nodeTypes);
  return nodeTypes;
}

export * from './types.ts';
export * from './registry.ts';
export * from './define.ts';
export * from './tags.ts';
export * from './lifecycle.ts';
export * from './capture.ts';
export * from './types/website.ts';
export * from './types/link.ts';
export * from './types/text.ts';
export * from './types/note.ts';
export * from './types/image.ts';
export * from './types/file.ts';
export * from './types/person.ts';
export * from './types/repo.ts';
export * from './types/unknown.ts';
