# @nexus/domain

Pure domain logic: ids, clocks, entity schemas and the **board document** (the `Y.Doc` that every
board is). No React, no storage provider, no canvas engine — those live in `apps/web`.

## The board document

One `Y.Doc` per board, `guid = "board:<boardId>"` (`08_DATA_MODEL.md` §2.1). Exactly eight top-level
keys; adding a ninth is a document-format migration:

| root       | type                   | holds                                       |
| ---------- | ---------------------- | ------------------------------------------- |
| `meta`     | `Y.Map<unknown>`       | schema version, board id, title, background |
| `nodes`    | `Y.Map<Y.Map>`         | `nodeId → node record`                      |
| `edges`    | `Y.Map<Y.Map>`         | `edgeId → edge record`                      |
| `groups`   | `Y.Map<Y.Map>`         | frames and clusters                         |
| `richtext` | `Y.Map<Y.XmlFragment>` | `fragmentKey → node body` (bound by P4)     |
| `comments` | `Y.Map<Y.Map>`         | comment threads (outside the undo scope)    |
| `order`    | `Y.Array<string>`      | explicit paint order, back → front          |
| `assets`   | `Y.Map<Y.Map>`         | file metadata; bytes live in OPFS/S3        |

```ts
import { createBoardDoc, addNode, makeNode, listNodes } from '@nexus/domain';

const doc = createBoardDoc({ boardId, now: new Date().toISOString() });
addNode(doc, makeNode({ id, x: 0, y: 0, title: 'Lead' }, now), {
  origin: 'local:create',
  now,
});
listNodes(doc); // validated, z-ordered plain objects
```

## Writing to the document

Every mutation goes through `src/doc` — `tx(doc, origin, fn)` plus the helpers above. Nothing else
may call `doc.transact` or touch a content root; the `raven/no-direct-graph-write` ESLint rule
enforces it. One user gesture is one transaction, which makes it one undo step.

## Origins and undo

Origins are the granular strings in `doc/transactions.ts`; `history/origins.ts` names the four
classes the UI reasons about (`LOCAL_USER`, `LOCAL_IMPORT`, `REMOTE`, `SYSTEM`).
`createBoardHistory(doc)` wraps `Y.UndoManager`: it tracks only `local:*` origins (so ⌘Z never
reverts a collaborator's edit), merges edits within 500 ms, caps the stack at 200 items and carries
a label per step for the "Undo: move 12 nodes" affordance.

## Export / import

`exportBoard(doc)` produces `raven.board.v1` (`08_DATA_MODEL.md` §8.1) with sorted arrays and
`serializeBoardExport` writing deterministic JSON — the same document always yields the same bytes.
`importBoard(json, { mode })` validates with zod, runs the migration chain, remaps ids
(`restore` keeps them, `copy` and `merge-into` remap) and returns a report of what was created,
skipped, remapped and warned about. Round-trip is lossless, including unknown keys inside `data`
(N9, property-tested).

## Invariants and migrations

`checkGraphInvariants(doc)` reports dangling edges, missing parents, asymmetric groups, order
mismatches and missing provenance; repairs run with origin `system:gc`.
`migrateDocument(doc, now)` / `migrateExportJson(json)` apply the forward-only chain in
`doc/migrations.ts` up to `CURRENT_SCHEMA_VERSION`.

## Node types

`packages/domain/src/nodes` holds the node type registry (`06_NODE_SYSTEM.md` §3). A type is data:
`defineNodeType({ type, label, schema, glyph, defaults, capabilities, componentId, inspector,
identityKeys, searchFields, validate?, capture?, io })`. Adding a type means adding one file under
`nodes/types/` and one line in `registerBuiltins()`; the `raven/no-node-type-switch` lint rule keeps
every other package from branching on `node.type`.

`builtinNodeTypes()` returns the populated registry. `createNode` / `updateNodeData` / `setNodeTags`
/ `duplicateNode` / `convertNode` / `deleteNode` in `nodes/lifecycle.ts` are the write API — each is
one transaction and therefore one undo step. `decideCapture(input)` routes a pasted or dropped
payload to the type that claims it most strongly.
