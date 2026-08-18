/**
 * Built-in node types (06_NODE_SYSTEM.md §1). `registerBuiltins()` is the only place that knows the
 * full list; everything else asks the registry. It is idempotent so tests and hot reloads can call
 * it freely. It lives beside the barrel rather than inside it because barrels carry no coverage.
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
