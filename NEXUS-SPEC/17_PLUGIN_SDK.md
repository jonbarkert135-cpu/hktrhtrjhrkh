# NEXUS — 17 — PLUGIN SDK

## Scope

Specifies third-party extensibility: the plugin manifest (a superset of the integration manifest in
`10_INTEGRATIONS.md` §4), the `@nexus/plugin-sdk` host API with full TypeScript declarations, the
isolation model for UI plugins (sandboxed iframe) and backend plugins (runner containers), the
permission taxonomy and consent UX, the install→uninstall lifecycle with semver compatibility, the
developer experience (scaffold CLI, dev loop, test harness, a complete example plugin), and the
registry/review model. Ships after P9; first third-party-facing release is gated on P16.
Non-goal: first-party integration internals (`10_INTEGRATIONS.md`, `11–13`).

---

## 1. Principles and the two plugin kinds

| # | Principle | Enforcement |
|---|---|---|
| P1 | A plugin can **propose**, never write | no graph mutation API exists in the SDK; only `graph.propose()` (§4.3) |
| P2 | A plugin runs with **no ambient authority** | UI code in a `sandbox`-attribute iframe with a null origin; backend code in the runner sandbox (`10_INTEGRATIONS.md` §6.3) |
| P3 | Every capability is **declared, reviewed, consented** | manifest `permissions` + install-time consent + runtime prompts for escalation (§6) |
| P4 | A plugin cannot degrade canvas performance | UI contributions render outside the canvas surface; a plugin may not mount DOM into the canvas layer (§5.5) |
| P5 | Uninstalling never destroys user data silently | data retention rules, §7.6 |
| P6 | Host API is versioned and stable | `apiVersion` semver range in the manifest; deprecation policy §7.8 |

Two kinds, orthogonal (a plugin may be both):

* **Backend plugin** — contributes one or more *integrations*: manifest-declared execution +
  parser + entity mappings. Executes in the Runner. Everything in `10_INTEGRATIONS.md` applies
  verbatim; the only differences are the declarative-only restriction (§5.3) and review (§9).
* **UI plugin** — contributes panels, inspector sections, commands, context-menu items, node type
  *renderers*, and settings. Executes in a sandboxed iframe in the browser.

```text
packages/plugin-sdk/
├─ src/
│  ├─ index.ts          public entry: definePlugin, host API types
│  ├─ manifest.ts       zod schema (superset of integration manifest)
│  ├─ rpc/
│  │  ├─ protocol.ts    postMessage envelope + zod schemas (§5.4)
│  │  ├─ client.ts      runs inside the plugin iframe
│  │  └─ host.ts        runs in the host page
│  ├─ api/{graph,selection,commands,ui,storage,net,files,events}.ts
│  └─ testkit/          in-memory host for unit tests (§8.3)
├─ bin/create-nexus-plugin.ts     scaffold CLI (§8.1)
└─ README.md

apps/web/src/plugins/
├─ PluginHost.tsx       iframe lifecycle, permission gating
├─ registry.ts          installed plugins, enable/disable state
├─ contributions.ts     merges manifest contributions into UI surfaces
└─ rpc-router.ts        validates + dispatches plugin calls
```

---

## 2. Plugin manifest

`packages/plugin-sdk/src/manifest.ts`. It **reuses** the integration schema pieces
(`zIntegrationManifest` fields for anything backend) and adds UI contributions.

### 2.1 Top-level schema

```ts
import { z } from 'zod';
import {
  zSemver, zEntityKind, zPermission as zIntegrationPermission,
  zInputField, zOutputSpec, zExecution, zEntityMapping, zRateLimits, zCostHints,
} from '@nexus/integrations/manifest';

export const zPluginId = z.string().regex(/^[a-z][a-z0-9-]{2,39}$/);   // registry-unique

export const zPluginPermission = z.enum([
  // graph
  'graph:read', 'graph:read.all', 'graph:propose',
  // ui
  'ui:panel', 'ui:inspector', 'ui:contextMenu', 'ui:command', 'ui:notify', 'ui:nodeRenderer',
  // data
  'storage:local', 'storage:sync',
  // io
  'net:allowlist', 'net:broad', 'secrets:read',
  'files:read.attachment', 'files:write.attachment', 'files:pick',
  // runtime
  'runner:execute', 'events:subscribe', 'clipboard:read',
]);

export const zContributionCommand = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]{2,63}$/),   // namespaced by host as "<pluginId>.<id>"
  title: z.string().min(2).max(60),
  category: z.string().max(30).default('Plugin'),
  icon: z.string().optional(),
  keybinding: z.string().regex(/^(Ctrl|Alt|Shift|Meta)(\+(Ctrl|Alt|Shift|Meta))*\+[A-Za-z0-9]$/)
    .optional(),                                    // advisory; host resolves conflicts (§3.4)
  when: z.string().max(200).optional(),             // when-clause expression, §2.3
  showInPalette: z.boolean().default(true),
});

export const zContributionPanel = z.object({
  id: z.string(),
  title: z.string().min(2).max(40),
  icon: z.string(),
  location: z.enum(['right-dock', 'bottom-dock', 'modal']),
  entry: z.string(),                                // path inside the bundle, e.g. "ui/panel.html"
  defaultWidthPx: z.number().int().min(280).max(720).default(360),
  minWidthPx: z.number().int().min(240).max(720).default(280),
  when: z.string().optional(),
  lazy: z.boolean().default(true),                  // iframe created on first open
});

export const zContributionInspector = z.object({
  id: z.string(),
  title: z.string().min(2).max(40),
  entry: z.string(),
  appliesTo: z.object({
    nodeTypes: z.array(z.string()).default([]),     // empty = all
    entityKinds: z.array(zEntityKind).default([]),
  }),
  order: z.number().int().min(0).max(1000).default(500),
  collapsedByDefault: z.boolean().default(true),
  maxHeightPx: z.number().int().min(80).max(640).default(320),
});

export const zContributionContextMenuItem = z.object({
  id: z.string(),
  title: z.string().min(2).max(48),
  commandId: z.string(),                            // must exist in commands
  group: z.enum(['open','transform','tools','export','danger']).default('tools'),
  order: z.number().int().default(100),
  when: z.string().optional(),
});

export const zContributionNodeType = z.object({
  type: z.string().regex(/^[a-z][a-z0-9-]{2,31}$/), // namespaced to "<pluginId>/<type>"
  label: z.string().min(2).max(40),
  icon: z.string(),
  entityKind: zEntityKind,
  schema: z.record(z.string(), z.object({
    type: z.enum(['string','number','boolean','date','url','enum','text']),
    label: z.string(),
    required: z.boolean().default(false),
    enumValues: z.array(z.string()).optional(),
    indexed: z.boolean().default(false),            // included in FTS
  })),
  identityField: z.string(),                        // which prop forms the identity key
  card: z.object({
    renderer: z.enum(['builtin', 'plugin']).default('builtin'),
    entry: z.string().optional(),                   // required when renderer==='plugin'
    fields: z.array(z.string()).max(4).default([]), // builtin renderer: props shown on the card
    accent: z.string().regex(/^--[a-z0-9-]+$/).default('--node-accent-default'), // design token only
    maxDomHeightPx: z.number().int().min(80).max(320).default(180),
  }),
});

export const zContributionSetting = z.object({
  key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/),
  label: z.string().max(60),
  help: z.string().max(200).optional(),
  type: z.enum(['string','number','boolean','enum','secretRef']),
  enumValues: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  default: z.unknown().optional(),
  scope: z.enum(['user','project','org']).default('project'),
  secret: z.boolean().default(false),               // stored in the secrets vault, never returned raw
});

export const zHostEvent = z.enum([
  'selection.changed', 'node.created', 'node.updated', 'node.deleted',
  'edge.created', 'edge.deleted', 'board.opened', 'board.closed',
  'run.finished', 'proposal.applied', 'settings.changed',
]);

export const zPluginManifest = z.object({
  manifestVersion: z.literal(1),
  kind: z.enum(['ui', 'backend', 'hybrid']),
  id: zPluginId,
  name: z.string().min(2).max(60),
  version: zSemver,
  apiVersion: z.string().regex(/^\^\d+\.\d+\.\d+$/),   // required host SDK range, e.g. "^1.2.0"
  publisher: z.object({
    id: z.string(), name: z.string(), url: z.string().url().optional(),
    verified: z.boolean().default(false),
  }),
  icon: z.string(),
  repository: z.string().url().optional(),
  license: z.string(),
  description: z.string().min(20).max(400),
  documentationUrl: z.string().url().optional(),
  privacyUrl: z.string().url().optional(),
  permissions: z.array(zPluginPermission).min(1),
  contributes: z.object({
    commands: z.array(zContributionCommand).max(50).default([]),
    panels: z.array(zContributionPanel).max(8).default([]),
    inspectors: z.array(zContributionInspector).max(8).default([]),
    contextMenuItems: z.array(zContributionContextMenuItem).max(20).default([]),
    nodeTypes: z.array(zContributionNodeType).max(20).default([]),
    settings: z.array(zContributionSetting).max(40).default([]),
    integrations: z.array(z.object({                 // backend contributions
      id: z.string(),
      name: z.string(),
      inputs: z.array(zInputField).max(24),
      outputs: z.array(zOutputSpec).min(1).max(16),
      execution: zExecution,
      parser: z.object({
        module: z.string(),                          // path inside the bundle
        export: z.string().default('parser'),
        supportedOutputVersions: z.array(z.string()).min(1),
      }),
      entityMappings: z.array(zEntityMapping).default([]),
      rateLimits: zRateLimits,
      costHints: zCostHints,
      consent: z.object({
        required: z.boolean().default(true),
        scopeText: z.string().min(20).max(600),
        allowedTargetScopes: z.array(
          z.enum(['public-index','owned-asset','third-party-host'])).min(1),
      }),
    })).max(10).default([]),
  }),
  events: z.array(zHostEvent).max(12).default([]),
  network: z.object({
    allow: z.array(z.string()).default([]),          // host patterns for net.fetch (§4.7)
    maxRequestsPerMinute: z.number().int().min(1).max(600).default(60),
    maxResponseBytes: z.number().int().min(1024).max(16*1024*1024).default(2*1024*1024),
  }).default({ allow: [], maxRequestsPerMinute: 60, maxResponseBytes: 2*1024*1024 }),
  storage: z.object({
    maxBytes: z.number().int().min(1024).max(5*1024*1024).default(256*1024),
    scope: z.enum(['user','project']).default('project'),
  }).default({ maxBytes: 256*1024, scope: 'project' }),
  maturity: z.enum(['experimental','beta','stable','deprecated']),
  minHostVersion: zSemver,
  bundle: z.object({
    entryHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),   // integrity of the built bundle
    sizeBytes: z.number().int().max(8 * 1024 * 1024),
    csp: z.object({                                   // extra CSP the plugin needs, allowlisted
      connectSrc: z.array(z.string()).default([]),    // must be a subset of network.allow
      imgSrc: z.array(z.string()).default([]),
    }).default({ connectSrc: [], imgSrc: [] }),
  }),
}).superRefine((m, ctx) => {
  const cmdIds = new Set(m.contributes.commands.map(c => c.id));
  for (const item of m.contributes.contextMenuItems)
    if (!cmdIds.has(item.commandId))
      ctx.addIssue({ code: 'custom', path: ['contributes','contextMenuItems'],
                     message: `unknown commandId ${item.commandId}` });
  if (m.contributes.integrations.length > 0 && !m.permissions.includes('runner:execute'))
    ctx.addIssue({ code: 'custom', message: 'integrations require permission runner:execute' });
  if (m.contributes.panels.length > 0 && !m.permissions.includes('ui:panel'))
    ctx.addIssue({ code: 'custom', message: 'panels require permission ui:panel' });
  for (const host of m.bundle.csp.connectSrc)
    if (!m.network.allow.includes(host))
      ctx.addIssue({ code: 'custom', message: `csp.connectSrc ${host} not in network.allow` });
  if (m.kind === 'ui' && m.contributes.integrations.length > 0)
    ctx.addIssue({ code: 'custom', message: 'kind "ui" cannot contribute integrations' });
});

export type PluginManifest = z.infer<typeof zPluginManifest>;
```

### 2.2 Relationship to the integration manifest

`contributes.integrations[]` is the integration manifest **minus** the fields the host owns:
`publisher`, `license`, `repository`, `maturity`, `risk`, `permissions` (inherited from the plugin)
and `manifestVersion`. At load time `expandPluginIntegrations(pluginManifest)` produces genuine
`IntegrationManifest` objects by copying the plugin-level fields down and setting
`risk.label = 'high'` unless the publisher is verified — third-party code gets the strict treatment
by default. Those objects then flow through the *unchanged* pipeline of `10_INTEGRATIONS.md` §3.

### 2.3 When-clause expressions

A tiny, total, side-effect-free expression language (no user code execution). Grammar:

```text
expr    := or
or      := and ('||' and)*
and     := not ('&&' not)*
not     := '!'? atom
atom    := ident | ident 'in' list | ident '==' literal | '(' expr ')'
list    := '[' literal (',' literal)* ']'
```

Available identifiers (evaluated by the host, never by the plugin):

| Identifier | Type |
|---|---|
| `selection.count` | number |
| `selection.kinds` | string[] (use with `in`, e.g. `'url' in selection.kinds`) |
| `selection.single` | boolean |
| `board.readonly` | boolean |
| `view.mode` | `'canvas'\|'graph'\|'timeline'\|'table'\|'list'\|'map'` |
| `plugin.enabled` | boolean |
| `setting.<key>` | string \| number \| boolean |

Parser lives in `packages/plugin-sdk/src/when.ts`, max expression length 200 chars, max depth 8,
evaluation budget 50 µs; a malformed clause disables the contribution and logs a manifest warning
(it never throws into the UI).

---

## 3. Contribution semantics

### 3.1 Panels

Rendered in the right dock (tabs) or bottom dock. Host creates the iframe on first activation
(`lazy: true`), keeps it alive while the board is open, and destroys it on board close or on
disable. Panels get a fixed-size viewport; the host never resizes to content (no layout thrash).
The panel receives `host.ready` with `{ theme tokens, locale, boardId, permissions }`.

### 3.2 Inspectors

Rendered as an additional collapsible section in the node inspector (`06_NODE_SYSTEM.md` §7),
sorted by `order`, filtered by `appliesTo`. Height is capped by `maxHeightPx` with internal scroll —
a plugin cannot push the built-in sections off-screen. Inspector iframes are **shared per plugin**
(one iframe, re-targeted via `inspector.setTarget(nodeId)`) to avoid N iframes on multi-select.

### 3.3 Context menu items

Merged into the node/canvas context menu under `group`. Plugin items always render **below**
built-in items of the same group, separated by a divider, prefixed by the plugin icon. The
`danger` group is unavailable to plugins (they cannot contribute destructive-looking actions).

### 3.4 Commands and keybindings

Commands appear in `Ctrl+K` with the category `Plugin · <plugin name>`. A requested keybinding is
granted only if it is free; on conflict the host keeps the built-in binding, the plugin command
stays unbound, and Settings → Keyboard shows "Requested Ctrl+Shift+W — taken by *Close board*"
with a rebind affordance. Plugins never silently steal a shortcut.

### 3.5 Node types

A plugin-contributed node type is namespaced `"<pluginId>/<type>"` and registered in the node
registry with `origin: 'plugin'`. Consequences:

* Nodes of that type persist in the board and **survive plugin removal**; without the plugin the
  card falls back to the generic entity card (icon + title + props table). Data is never lost (P5).
* `renderer: 'plugin'` cards are rendered by the plugin only at `zoom ≥ 0.55` and only for nodes in
  the DOM overlay set (`05_CANVAS_ENGINE.md` §4). Below that, the host draws the LOD glyph itself.
  A plugin card that does not paint within 8 ms is replaced by the builtin card for the rest of the
  session, with a warning in Settings → Plugins (P4).
* Plugin card iframes are pooled: at most 24 live plugin-card iframes; beyond that the host
  degrades to the builtin renderer. Rationale: iframes cost ~1–2 MB each; 5,000-node boards must
  still hit N1.

### 3.6 Settings

Rendered by the **host** from the schema (plugins get no settings UI surface, which keeps settings
consistent and prevents credential-phishing layouts). `secret: true` settings are stored in the
secrets vault; the plugin can reference them by name in `secretHeaders`/`secretEnv` (backend) or
call `net.fetch` with `useSecret: '<key>'` (§4.7), but the value is never readable by plugin code.

---

## 4. Host API — `@nexus/plugin-sdk`

Complete public surface. Everything is async, every call is validated against a zod schema on the
host side, and every call is subject to permission checks and per-plugin rate limits (§5.6).

### 4.1 Entry point

```ts
// plugin code
import { definePlugin, type PluginContext } from '@nexus/plugin-sdk';

export default definePlugin({
  async activate(ctx: PluginContext) { /* register handlers */ },
  async deactivate() { /* release resources; ≤ 500 ms budget */ },
});
```

```ts
export interface PluginContext {
  readonly pluginId: string;
  readonly hostVersion: string;      // semver of the host app
  readonly apiVersion: string;       // semver of the SDK the host implements
  readonly boardId: string | null;
  readonly locale: string;
  readonly theme: Readonly<Record<string, string>>;  // design tokens, name → value
  readonly permissions: readonly PluginPermission[];
  readonly settings: SettingsApi;
  readonly graph: GraphApi;
  readonly selection: SelectionApi;
  readonly commands: CommandsApi;
  readonly ui: UiApi;
  readonly storage: StorageApi;
  readonly net: NetApi;
  readonly files: FilesApi;
  readonly events: EventsApi;
  readonly runs: RunsApi;
  readonly log: LogApi;
}
```

### 4.2 Read model types

```ts
export interface ReadonlyNode {
  readonly id: string;
  readonly type: string;
  readonly entityKind: EntityKind;
  readonly title: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly tags: readonly string[];
  readonly identityKey: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenanceCount: number;     // full provenance requires graph:read.all
  readonly position: { readonly x: number; readonly y: number };
}

export interface ReadonlyEdge {
  readonly id: string;
  readonly type: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly props: Readonly<Record<string, unknown>>;
}
```

### 4.3 GraphApi — read + propose only

```ts
export interface GraphQuery {
  nodeIds?: readonly string[];
  types?: readonly string[];
  entityKinds?: readonly EntityKind[];
  tags?: readonly string[];
  text?: string;                 // FTS over indexed props
  limit?: number;                // default 100, max 1000
  cursor?: string;
}

export interface GraphApi {
  /** Requires graph:read (selection-scoped) or graph:read.all (whole board). */
  getNode(id: string): Promise<ReadonlyNode | null>;
  getNodes(q: GraphQuery): Promise<{ nodes: readonly ReadonlyNode[]; cursor?: string }>;
  getEdges(q: { nodeIds: readonly string[]; direction?: 'in'|'out'|'both' })
    : Promise<readonly ReadonlyEdge[]>;
  getNeighbors(id: string, depth?: 1 | 2): Promise<{ nodes: readonly ReadonlyNode[];
                                                     edges: readonly ReadonlyEdge[] }>;
  /** Requires graph:propose. Creates an ImportProposal the USER must accept. */
  propose(p: PluginProposal): Promise<{ proposalId: string }>;
  /** Resolve a raw value to the canonical identity key using host normalizers. */
  normalize(kind: EntityKind, value: string)
    : Promise<{ ok: boolean; value?: string; display?: string; reason?: string }>;
}

export interface PluginProposal {
  title: string;                       // shown in the diff header, ≤ 80 chars
  anchorNodeId?: string;
  nodes?: readonly PluginProposedNode[];
  edges?: readonly PluginProposedEdge[];
  enrich?: readonly PluginEnrich[];
  observedAt?: string;                 // ISO; defaults to now
}

export interface PluginProposedNode {
  ref: string;                         // plugin-local temp id
  type: string;                        // built-in type or "<pluginId>/<type>"
  entityKind: EntityKind;
  identityValue: string;               // normalized by the host
  title: string;
  props?: Readonly<Record<string, unknown>>;   // ≤ 32 KiB JSON
  tags?: readonly string[];
  confidence?: number;                 // 0..1, host clamps to ≤ 0.9 for unverified publishers
  evidence?: { url?: string; excerpt?: string; pointer?: string };  // excerpt ≤ 4 KiB
}

export interface PluginProposedEdge {
  from: { ref: string } | { nodeId: string };
  to: { ref: string } | { nodeId: string };
  type: string;                        // must exist in the edge registry
  label?: string;
  props?: Readonly<Record<string, unknown>>;
  confidence?: number;
}

export interface PluginEnrich {
  nodeId: string;
  patches: readonly { path: string; op: 'set'|'append'|'addToSet'; value: unknown }[];
  confidence?: number;
}
```

Host behaviour on `propose()`:

1. Validate against the schema; reject oversize payloads (`> 2 MiB`, `> 2,000 nodes`,
   `> 4,000 edges`) with `PROPOSAL_TOO_LARGE`.
2. Normalize identity values, compute identity keys, run the resolver (`10_INTEGRATIONS.md` §8.3)
   to classify items as new / enrich / conflict / duplicate.
3. Attach provenance with `tool = "plugin:<pluginId>"`, `toolVersion = plugin version`, and the
   plugin's `evidence` as the excerpt. A plugin cannot forge `source`, `runId`, `importedAt` or
   `actorUserId`.
4. Clamp confidence: `min(requested, verifiedPublisher ? 0.95 : 0.9)`; unverified plugin proposals
   never outrank first-party observations by default.
5. Surface the standard proposal diff UI (`10_INTEGRATIONS.md` §7.2 state 5) with the plugin's
   `title` and icon. **The user applies; the plugin is not told the applied node ids** unless it has
   `graph:read.all` (prevents cross-board fingerprinting by a read-limited plugin).

### 4.4 SelectionApi

```ts
export interface SelectionApi {
  get(): Promise<readonly ReadonlyNode[]>;
  getIds(): Promise<readonly string[]>;
  /** Selecting is a navigation action, allowed without extra permission; capped at 500 ids. */
  set(nodeIds: readonly string[]): Promise<void>;
  focus(nodeId: string, opts?: { zoom?: boolean }): Promise<void>;
  onChange(cb: (nodes: readonly ReadonlyNode[]) => void): Unsubscribe;
}
export type Unsubscribe = () => void;
```

### 4.5 CommandsApi and UiApi

```ts
export interface CommandsApi {
  register(id: string, handler: (args: CommandArgs) => Promise<void> | void): Unsubscribe;
  /** Only commands contributed by THIS plugin, plus a host allowlist of safe built-ins. */
  execute(id: string, args?: Record<string, unknown>): Promise<void>;
}
export interface CommandArgs {
  readonly selection: readonly ReadonlyNode[];
  readonly nodeId?: string;         // when invoked from a node context menu
  readonly source: 'palette' | 'contextMenu' | 'keybinding' | 'panel';
}

export interface UiApi {
  notify(n: { level: 'info'|'success'|'warn'|'error'; message: string;
              detail?: string; actions?: { id: string; label: string }[] })
    : Promise<{ actionId?: string }>;                    // max 3 per minute per plugin
  confirm(o: { title: string; body: string; confirmLabel?: string; danger?: boolean })
    : Promise<boolean>;
  prompt(o: { title: string; label: string; placeholder?: string; initial?: string })
    : Promise<string | null>;
  progress<T>(title: string, fn: (report: (p: { message?: string; percent?: number }) => void)
    => Promise<T>): Promise<T>;
  openPanel(panelId: string): Promise<void>;
  closePanel(panelId: string): Promise<void>;
  /** Host-rendered form from a JSON-schema subset; keeps plugin UIs consistent and unphishable. */
  form<T extends Record<string, unknown>>(spec: FormSpec): Promise<T | null>;
  setBadge(target: { panelId: string }, badge: { count?: number; dot?: boolean }): Promise<void>;
}
```

`ui.notify` and `ui.confirm` always render with a "from *<plugin name>*" attribution line; a plugin
can never produce a dialog that looks like the host's own (anti-phishing requirement,
`15_SECURITY.md` §8.2).

### 4.6 StorageApi and SettingsApi

```ts
export interface StorageApi {                 // requires storage:local (or storage:sync)
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;   // JSON-serializable, quota manifest.storage.maxBytes
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
  usage(): Promise<{ bytes: number; quota: number }>;
}
export interface SettingsApi {
  get<T = unknown>(key: string): Promise<T | undefined>;   // secret settings return { __secret: true }
  onChange(cb: (key: string, value: unknown) => void): Unsubscribe;
}
```

`storage:local` = IndexedDB in the host origin, namespaced `plugin:<id>:<scope>`, wiped on
uninstall per §7.6. `storage:sync` additionally replicates through the API (Postgres
`plugin_storage` table, same quota, last-write-wins per key) so settings follow the user across
devices.

### 4.7 NetApi — host-proxied fetch only

```ts
export interface NetApi {
  fetch(req: {
    url: string;
    method?: 'GET' | 'POST' | 'HEAD';
    headers?: Record<string, string>;          // hop-by-hop and auth headers filtered (§5.7)
    body?: string;                             // ≤ 256 KiB
    useSecret?: { settingKey: string; as: { header: string; template?: string } };
    timeoutMs?: number;                        // ≤ 30_000
    responseType?: 'text' | 'json' | 'arrayBuffer';
  }): Promise<{
    status: number;
    headers: Readonly<Record<string, string>>; // response headers, allowlisted subset
    body: string | unknown | ArrayBuffer;
    truncated: boolean;
    finalUrl: string;
  }>;
}
```

Rules:

* The plugin iframe has **no** network access of its own: CSP `connect-src 'none'` plus the
  sandboxed null origin. All traffic goes through `POST /v1/plugins/:id/fetch` on the API, which
  applies: host allowlist match against `manifest.network.allow`, SSRF guard (N7 — DNS pinning,
  private-range denial, redirect cap 5), rate limit `maxRequestsPerMinute`, response cap
  `maxResponseBytes` (truncated → `truncated: true`), and a 30 s hard timeout.
* `useSecret` lets the plugin authenticate without ever seeing the credential: the API injects
  `header: template.replace('{{secret}}', value)` (default template `Bearer {{secret}}`).
* Requests and denials are logged per plugin and visible in Settings → Plugins → *Network activity*
  (host, count, last used, denied count). This is a user-facing transparency requirement, not a
  debug feature.
* `net:broad` (any public host) requires an explicit runtime consent (§6.3) and is refused entirely
  for unverified publishers in orgs with `strictPluginPolicy` (default **on**).

### 4.8 FilesApi

```ts
export interface FilesApi {
  /** files:read.attachment — read an attachment already on the board. Streams are not exposed;
   *  the host returns a bounded ArrayBuffer (≤ 16 MiB) or throws FILE_TOO_LARGE. */
  readAttachment(fileId: string): Promise<{ name: string; contentType: string; bytes: ArrayBuffer }>;
  /** files:pick — opens the HOST's file picker; the plugin never touches the OS file dialog. */
  pick(o: { accept?: readonly string[]; multiple?: boolean })
    : Promise<readonly { fileId: string; name: string; size: number; contentType: string }[]>;
  /** files:write.attachment — proposes an attachment; appears in the proposal diff, not applied silently. */
  proposeAttachment(o: { name: string; contentType: string; bytes: ArrayBuffer;
                         attachToNodeId?: string }): Promise<{ proposalId: string }>;
}
```

File access rules, absolute: no local filesystem access, no OPFS access, no access to attachments
of other boards, no access to a file the current user cannot read, and every write is a proposal.
Uploaded bytes are type-sniffed server-side (`09_BACKEND.md` §5.3) — a plugin cannot smuggle an
HTML payload as `image/png`.

### 4.9 EventsApi, RunsApi, LogApi

```ts
export interface EventsApi {                    // requires events:subscribe + manifest.events
  on<E extends HostEvent>(event: E, cb: (payload: HostEventPayload[E]) => void): Unsubscribe;
}
export interface HostEventPayload {
  'selection.changed': { nodeIds: readonly string[] };
  'node.created':      { nodeId: string; type: string };
  'node.updated':      { nodeId: string; changedProps: readonly string[] };
  'node.deleted':      { nodeId: string };
  'edge.created':      { edgeId: string; from: string; to: string; type: string };
  'edge.deleted':      { edgeId: string };
  'board.opened':      { boardId: string };
  'board.closed':      { boardId: string };
  'run.finished':      { runId: string; integrationId: string; status: string };
  'proposal.applied':  { proposalId: string; counts: { nodes: number; edges: number } };
  'settings.changed':  { key: string };
}

export interface RunsApi {                      // requires runner:execute
  start(o: { integrationId: string; input: Record<string, unknown>; anchorNodeId?: string })
    : Promise<{ runId: string }>;               // integrationId must belong to THIS plugin
  get(runId: string): Promise<{ status: string; proposalId?: string; error?: { code: string } }>;
  cancel(runId: string): Promise<void>;
  onEvent(runId: string, cb: (e: { t: string; [k: string]: unknown }) => void): Unsubscribe;
}

export interface LogApi {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;     // surfaced in Settings → Plugins → Logs
}
```

Event delivery is **coalesced and throttled**: `node.updated` events are batched per 250 ms frame
and capped at 200 events/s per plugin; over the cap the host sends
`{ event: 'overflow', dropped: n }` and the plugin must re-read what it needs. Events are only
delivered for the currently open board.

---

## 5. Isolation model

### 5.1 Decision: sandboxed iframe (not Web Worker, not same-origin)

UI plugins run in `<iframe sandbox="allow-scripts" src="blob:…">` served from a **separate origin**
(`https://plugins.<host>` in hosted deployments; `null` origin via blob URL in self-host, where a
second domain may not exist).

Why not a Web Worker: plugins need DOM (panels, inspectors, custom cards). A worker cannot render.
Why not same-origin iframe: same-origin means access to `localStorage`, IndexedDB, cookies and the
host DOM through `parent` — no isolation at all.
Why not Shadow DOM in the host document: CSS is isolated, JavaScript is not; a plugin could reach
`window.parent` and the Y.Doc directly, breaking P1 and N4.
Cost accepted: ~1–2 MB per iframe and a postMessage hop (~0.1–0.3 ms per call). Mitigated by
pooling (§3.5) and by keeping the canvas itself free of plugin DOM (P4).

Sandbox attribute set exactly: `allow-scripts allow-forms allow-popups-to-escape-sandbox`.
Explicitly **not** granted: `allow-same-origin` (this is what keeps the origin opaque),
`allow-top-navigation`, `allow-modals`, `allow-downloads`, `allow-pointer-lock`.
Because `allow-same-origin` is absent, the frame cannot use IndexedDB directly — hence
`StorageApi` is host-mediated by necessity, which is also what makes quota enforcement possible.

### 5.2 Content Security Policy for the plugin frame

```text
default-src 'none';
script-src 'unsafe-inline' blob:;        # bundle is inlined into the blob document
style-src 'unsafe-inline';
img-src data: blob: <manifest.bundle.csp.imgSrc…>;
font-src data:;
connect-src 'none';                      # all network via net.fetch (§4.7)
frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';
```

`connect-src 'none'` is the load-bearing line: it makes exfiltration through `fetch`,
`XMLHttpRequest`, WebSocket, `EventSource` and beacons impossible from the frame, so all egress is
observable and attributable at the API. `img-src` allowances are reviewed (§9.2) because an
`<img src>` is a covert channel; a plugin requesting a broad `img-src` is rejected.

### 5.3 Backend plugin isolation

Backend contributions execute through the unchanged Runner (`10_INTEGRATIONS.md` §6) with two
additional restrictions:

1. **Declarative only.** A plugin may not provide custom `InputAdapter`, `EntityExtractor`,
   `NodeMapper` or `RelationshipMapper` implementations; it uses the manifest-driven defaults. Its
   only executable server-side code is the **parser**, which runs in the parse worker inside a
   dedicated `node:vm` isolate with: no `require`/`import` beyond an injected allowlist
   (`stream-json`, `zod`), no globals (`process`, `fetch`, `Buffer` are absent — a `bytes` helper is
   injected), 512 MiB heap cap, and a 60 s CPU deadline enforced by a watchdog thread.
   Justification: parsers are pure data transforms; a pure function does not need a runtime.
2. **Container execution must be `kind: 'container'` with `runtimeClass: 'gvisor'` and
   `network.mode` ∈ `{none, allowlist}`. `broad` is reserved for first-party integrations** —
   a third-party tool contacting arbitrary hosts from the operator's IP is not acceptable by
   default. An org admin can override per plugin, with the override recorded in the audit log.

### 5.4 postMessage protocol

`packages/plugin-sdk/src/rpc/protocol.ts`. All frames are JSON, all validated on both sides.

```ts
export const zEnvelope = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), protocol: z.literal(1), pluginId: z.string(),
             apiVersion: z.string() }),
  z.object({ t: z.literal('ready'), protocol: z.literal(1), context: z.unknown() }),
  z.object({ t: z.literal('call'), id: z.string().uuid(), ns: z.string(), method: z.string(),
             args: z.unknown(), deadlineMs: z.number().int().max(30_000) }),
  z.object({ t: z.literal('result'), id: z.string().uuid(), ok: z.literal(true),
             value: z.unknown() }),
  z.object({ t: z.literal('result'), id: z.string().uuid(), ok: z.literal(false),
             error: z.object({ code: z.string(), message: z.string(),
                               detail: z.unknown().optional() }) }),
  z.object({ t: z.literal('event'), event: z.string(), payload: z.unknown() }),
  z.object({ t: z.literal('invoke'), id: z.string().uuid(),
             kind: z.enum(['command','render','setTarget','deactivate']),
             args: z.unknown() }),
  z.object({ t: z.literal('log'), level: z.enum(['debug','info','warn','error']),
             message: z.string().max(2000), data: z.unknown().optional() }),
  z.object({ t: z.literal('resize'), heightPx: z.number().int().min(0).max(2000) }),
]);
```

Handshake and rules:

```text
host: create iframe (srcdoc = bootstrap + bundle blob), start 5 s activation timer
frame → host: hello        (host verifies event.source === iframe.contentWindow, event.origin is
                            'null' or the plugins origin; anything else is dropped and audited)
host  → frame: ready       (context payload: permissions, tokens are NEVER included)
frame → host: call {ns:'graph', method:'getNodes', args:{…}}
host: zod-validate → permission check → rate limit → execute → result
```

Invariants:
* Every `call` has a `deadlineMs`; the host replies with `{ok:false, code:'TIMEOUT'}` if the
  handler exceeds it, and the plugin's promise rejects — no hanging promises.
* Message size cap 4 MiB; over-cap messages are dropped with an `error` event and a strike (§5.6).
* The host never sends session cookies, JWTs, or API tokens into the frame. Every privileged action
  is performed by the host on the plugin's behalf.
* `resize` only affects the plugin's own panel/inspector viewport, clamped by manifest limits.
* The frame is destroyed on: board close, plugin disable, three consecutive protocol violations,
  or unhandled error rate > 10/min.

### 5.5 Canvas protection

Plugins may not: mount DOM inside `.canvas-layer`, register pointer handlers on the canvas, read
the render loop, or call layout APIs. `renderer: 'plugin'` node cards are rendered inside a pooled
iframe **positioned by the host** over the node's rect; the plugin receives only
`{ node, width, height, zoom }` and paints HTML. If a card iframe misses two consecutive frames of
its 8 ms budget, the host swaps in the builtin card (§3.5) — measured with
`performance.measure('plugin-card-<id>')` and reported to the perf harness (`16_PERFORMANCE.md` §7).

### 5.6 Per-plugin quotas and strikes

| Resource | Limit | Over-limit behaviour |
|---|---|---|
| RPC calls | 120/min sustained, burst 40 | `RATE_LIMITED` error to the plugin |
| `graph.getNodes` result rows | 1,000/call, 20,000/min | truncated + `truncated: true` |
| `net.fetch` | `manifest.network.maxRequestsPerMinute` | `RATE_LIMITED` |
| `ui.notify` | 3/min | dropped silently after a single warning toast |
| `propose` | 6/min, 2 MiB each | `RATE_LIMITED` |
| storage | `manifest.storage.maxBytes` | `QUOTA_EXCEEDED` on write |
| iframe memory | 128 MiB (measured via `performance.measureUserAgentSpecificMemory` where available) | frame reloaded once, then disabled with a user notice |
| protocol violations | 3 | plugin disabled, user notified, event audited |

### 5.7 Header and value filtering

`net.fetch` request headers are stripped of: `authorization` (unless via `useSecret`), `cookie`,
`host`, `content-length`, `connection`, `proxy-*`, `x-forwarded-*`, and anything matching
`/^sec-/i`. Response headers returned to the plugin are limited to `content-type`, `content-length`,
`etag`, `last-modified`, `link`, `retry-after`, `x-ratelimit-*`.

---

## 6. Permissions and consent

### 6.1 Taxonomy

| Permission | Grants | Risk | Prompt |
|---|---|---|---|
| `graph:read` | read the **current selection** and its 1-hop neighbours | low | install |
| `graph:read.all` | read every node/edge on the open board, incl. full provenance | **high** | install + explicit toggle |
| `graph:propose` | create proposals (user still applies) | low | install |
| `ui:panel` / `ui:inspector` / `ui:contextMenu` / `ui:command` | render surfaces | low | install |
| `ui:notify` | toasts and dialogs | low | install |
| `ui:nodeRenderer` | custom card rendering | medium (perf) | install |
| `storage:local` | 256 KiB per project | low | install |
| `storage:sync` | same, replicated to the server | low | install |
| `net:allowlist` | host-proxied fetch to manifest hosts | medium | install, hosts listed verbatim |
| `net:broad` | host-proxied fetch to any public host | **high** | install + runtime consent per session |
| `secrets:read` | use a secret setting via `useSecret` (never sees the value) | medium | install |
| `files:read.attachment` | read board attachments | medium | install |
| `files:pick` | host file picker | low | on first use |
| `files:write.attachment` | propose attachments | low | install |
| `runner:execute` | run its own container integrations | **high** | install + per-run consent (`10_INTEGRATIONS.md` §12.1) |
| `events:subscribe` | receive declared host events | low | install |
| `clipboard:read` | read clipboard on an explicit user paste gesture only | medium | on each use, browser-native |

High-risk permissions are rendered in the install dialog with an amber marker, a one-line
consequence sentence, and cannot be pre-checked.

### 6.2 Install consent UX

```text
Install  Wayback Snapshots  1.0.0        by  archive-tools  (unverified publisher)

This plugin will be able to
  ✓ Read the nodes you select                       graph:read
  ✓ Suggest new nodes and links for your approval    graph:propose
  ✓ Add a panel and an inspector section             ui:panel, ui:inspector
  ✓ Contact these sites on your behalf               net:allowlist
        archive.org, web.archive.org
  ✓ Store up to 256 KB of its own data in this project

It will NOT be able to
  ✗ change your board without your approval
  ✗ read boards you have not opened
  ✗ reach any other website
  ✗ see your password, session or API tokens

Publisher is unverified. Its code has not been reviewed by us.
[ ] I understand and want to install this plugin
                                       [Cancel]  [Install]
```

The "will NOT" block is generated from the *unrequested* permissions and is mandatory — users judge
risk far better when the negative space is explicit. Install is recorded in the audit log with the
exact permission set and manifest hash.

### 6.3 Runtime prompts and escalation

* Permissions absent from the manifest can never be acquired at runtime — there is no "request
  permission" API. Escalation requires a **version update** whose manifest declares the new
  permission, which re-triggers consent (§7.4).
* `net:broad` and `runner:execute` additionally prompt at use time: per session for `net:broad`,
  per run for `runner:execute`.
* A permission may be **revoked** at any time in Settings → Plugins; revocation takes effect on the
  next RPC call (the host re-reads the grant set per call, not per session) and the plugin receives
  `PERMISSION_DENIED`. A plugin that loses a permission it declared as required shows as
  "Limited — some features are off".
* Org admins can pin an allowlist of installable plugins (`org_plugin_policy.mode = 'allowlist'`)
  and forbid unverified publishers entirely (default in `strictPluginPolicy` orgs).

---

## 7. Lifecycle

### 7.1 Distribution artifact

A plugin is a signed tarball:

```text
wayback-snapshots-1.0.0.nexplug
├─ plugin.json          the manifest
├─ ui/panel.js          bundled, no external imports
├─ ui/inspector.js
├─ server/parser.js     ESM, side-effect free, single export
├─ icon.svg
├─ README.md
└─ SIGNATURE            detached signature over sha256 of the deterministic tar
```

Build output is deterministic (fixed mtimes, sorted entries) so `bundle.entryHash` is verifiable.
Signature: Ed25519 over the tar digest; the publisher's public key is registered with the registry.
Self-hosted installs of unsigned local files are allowed only with `NEXUS_ALLOW_UNSIGNED_PLUGINS=1`
and are marked "Unsigned — development only" everywhere in the UI.

### 7.2 Install

```text
1. Fetch artifact (registry or upload)
2. Verify signature + entryHash + size cap (8 MiB)
3. Parse plugin.json with zPluginManifest; reject on any issue (show the zod path)
4. Compatibility check: hostVersion ⊨ manifest.minHostVersion and hostApiVersion ⊨ apiVersion
5. Contribution conflict check: command ids, node type names, panel ids namespaced by pluginId
   (collisions across plugins are therefore impossible by construction)
6. Show consent dialog (§6.2)
7. Persist row in `plugins` + `plugin_grants`; store artifact in S3 `plugins/<id>/<version>/`
8. Expand contributes.integrations into IntegrationManifests (§2.2), validate each
9. Enable (default: enabled for the installing project only)
```

Scope: plugins are installed **per org**, enabled **per project**. Rationale: an org admin controls
what code may exist; project members control what runs in their workspace.

```sql
CREATE TABLE plugins (
  id            text NOT NULL,
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  version       text NOT NULL,
  manifest      jsonb NOT NULL,
  artifact_key  text NOT NULL,
  entry_hash    text NOT NULL,
  publisher_id  text NOT NULL,
  verified      boolean NOT NULL DEFAULT false,
  installed_by  uuid NOT NULL REFERENCES users(id),
  installed_at  timestamptz NOT NULL DEFAULT now(),
  state         text NOT NULL CHECK (state IN ('installed','disabled','deprecated','removed')),
  PRIMARY KEY (org_id, id)
);
CREATE TABLE plugin_grants (
  org_id uuid NOT NULL, plugin_id text NOT NULL,
  permission text NOT NULL, granted_by uuid NOT NULL, granted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (org_id, plugin_id, permission)
);
CREATE TABLE plugin_enablement (
  org_id uuid NOT NULL, plugin_id text NOT NULL, project_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true, PRIMARY KEY (org_id, plugin_id, project_id)
);
CREATE TABLE plugin_storage (
  org_id uuid NOT NULL, plugin_id text NOT NULL, scope_id text NOT NULL,  -- user or project id
  key text NOT NULL, value jsonb NOT NULL, bytes integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, plugin_id, scope_id, key)
);
```

### 7.3 Enable / disable

Disable stops activation, destroys frames, cancels the plugin's queued runs, unregisters
contributions, and **keeps** storage, settings and created nodes. Nodes of a disabled plugin's node
types fall back to the generic card (§3.5). Disable is instant and requires no confirmation;
re-enable is equally instant.

### 7.4 Update and compatibility

Semver rules:

| Change | Version bump | User impact |
|---|---|---|
| bug fix, no manifest change | patch | auto-update if the org opted in; no prompt |
| new optional contribution, no new permission | minor | auto-update allowed; changelog toast |
| new permission, removed contribution, changed node-type schema, or `manifestVersion` bump | major | **blocked until the user re-consents**; old version keeps running |

Host compatibility: the host implements SDK versions per `apiVersion`; a plugin whose range no
longer matches after a host upgrade is auto-disabled with
"*Wayback Snapshots* needs a newer version of NEXUS API (^1.x, this host provides 2.0). The plugin
is off until the publisher updates it." Node-type schema changes across a major require a
`migrations` map in the manifest (`{ "1.x→2.0": "server/migrate.js" }`) whose function transforms
stored node props; it runs as a **proposal**, never silently.

Rollback: the previous artifact is retained for 90 days; Settings → Plugins → *Version history*
allows reverting one version. Reverting across a major requires re-consent.

### 7.5 Uninstall

```text
1. Confirm dialog stating exactly what will happen (below)
2. Disable (7.3)
3. Delete artifact, grants, enablement rows
4. Retain: nodes/edges created via proposals (they are USER data), their provenance
5. Retain for 30 days then hard-delete: plugin storage, plugin settings (incl. secret refs)
6. Audit event plugin.uninstalled with the retained/deleted breakdown
```

Confirm copy:

```text
Remove Wayback Snapshots?
  · 47 nodes it helped you import stay on your boards.
  · Its custom cards become standard cards.
  · Its saved settings and 12 KB of plugin data are deleted in 30 days.
  · Any running job it started is cancelled.
[Cancel]  [Remove plugin]
```

### 7.6 Data retention summary

| Data | On disable | On uninstall |
|---|---|---|
| nodes/edges created through proposals | kept | kept (permanent) |
| provenance referencing the plugin | kept | kept (records history honestly) |
| plugin storage (`plugin_storage`, IndexedDB) | kept | deleted after 30 days |
| plugin settings | kept | deleted after 30 days |
| secret settings values | kept | **deleted immediately** |
| run records and artifacts of its integrations | kept | kept per `10_INTEGRATIONS.md` §6.9 |

### 7.7 Failure handling

A plugin that throws during `activate` gets 2 retries with 1 s/5 s backoff, then is marked
"Failed to start" with the error in Settings → Plugins → Logs; it does not block app startup.
Plugin errors never surface as host errors — every plugin-originating toast is attributed.

### 7.8 Deprecation policy

* An API member is marked `@deprecated` in the SDK types for **two minor versions** before removal
  and returns a `deprecation` warning in the RPC result envelope, surfaced in plugin logs.
* Removal happens only in a host **major**. The host maintains an SDK compatibility shim for the
  previous major for 12 months.
* A plugin marked `maturity: 'deprecated'` shows a banner and can no longer be installed fresh;
  existing installs keep working until the publisher removes it or a host major drops it.

---

## 8. Developer experience

### 8.1 Scaffold CLI

```bash
npx @nexus/create-plugin wayback-snapshots
# prompts: kind (ui | backend | hybrid), permissions, contributions, publisher id
```

Generates:

```text
wayback-snapshots/
├─ plugin.json           manifest with the chosen contributions
├─ src/panel.tsx         a panel using the SDK (Preact by default — 4 KB, keeps bundles small)
├─ src/inspector.tsx
├─ src/parser.ts         only for backend/hybrid
├─ src/index.ts          definePlugin({activate})
├─ test/plugin.test.ts   uses @nexus/plugin-sdk/testkit
├─ vite.config.ts        library build, IIFE, no externals, deterministic output
├─ nexus.dev.json        dev-loop config (host URL, dev token)
└─ package.json          scripts: dev, build, test, validate, package, publish
```

`npm run validate` runs the same zod schema and the review lint rules (§9.2) locally, so a plugin
never fails review for something a machine could have caught.

### 8.2 Local dev loop

```bash
npm run dev     # vite build --watch + a local dev server on :5199 serving the bundle + manifest
```

In NEXUS: Settings → Plugins → **Load dev plugin** → `http://localhost:5199`. The host then:

1. Fetches the manifest on every focus and on a `manifest-changed` SSE from the dev server.
2. Skips signature verification (dev plugins are visibly badged **DEV** in every surface).
3. Hot-reloads by destroying and recreating the iframe on bundle change (state is intentionally
   lost; plugins must be able to rebuild state from `activate`).
4. Streams `log` envelopes into the browser console with a `[plugin:<id>]` prefix and into the
   Plugin Logs panel.
5. Enforces **all** production limits (permissions, rate limits, CSP). Dev mode relaxes trust, never
   isolation — otherwise plugins would be written against a sandbox that does not exist in prod.

### 8.3 Test harness

```ts
import { createTestHost } from '@nexus/plugin-sdk/testkit';

const host = createTestHost({
  manifest: await import('../plugin.json'),
  board: {
    nodes: [{ id: 'n1', type: 'url', entityKind: 'url', title: 'example.com/a',
              props: { url: 'https://example.com/a' } }],
    edges: [],
  },
  net: {                    // deterministic fetch mocking; unmocked hosts throw
    'https://archive.org/wayback/available?url=example.com%2Fa':
      { status: 200, body: { archived_snapshots: { closest: {
          available: true, url: 'http://web.archive.org/web/20200101/https://example.com/a',
          timestamp: '20200101000000', status: '200' } } } },
  },
  permissions: ['graph:read', 'graph:propose', 'net:allowlist', 'ui:notify'],
});

await host.activate();
await host.runCommand('wayback.snapshot', { selection: ['n1'] });

const [proposal] = host.proposals;
expect(proposal.nodes).toHaveLength(1);
expect(proposal.nodes[0].entityKind).toBe('url');
expect(host.notifications).toEqual([]);
expect(host.deniedCalls).toEqual([]);          // asserts no permission was attempted illegally
```

The testkit implements the *same* RPC router and validators as the host (imported, not
re-implemented), so a passing test means the call shapes are correct in production.

### 8.4 Example plugin — "Wayback Machine snapshot"

Behaviour: for each selected `url` node, ask the Internet Archive availability API for the closest
snapshot, and propose a `snapshot` node linked with `archived_as`, plus an inspector section
showing the snapshot date. Everything below is real, complete code.

**`plugin.json`**

```json
{
  "manifestVersion": 1,
  "kind": "ui",
  "id": "wayback-snapshots",
  "name": "Wayback Snapshots",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",
  "publisher": { "id": "archive-tools", "name": "Archive Tools" },
  "icon": "icon.svg",
  "license": "MIT",
  "description": "Finds the closest Internet Archive snapshot for selected URL nodes and proposes it as a linked snapshot node.",
  "permissions": ["graph:read", "graph:propose", "net:allowlist",
                  "ui:command", "ui:contextMenu", "ui:inspector", "ui:notify", "storage:local"],
  "contributes": {
    "commands": [
      { "id": "snapshot", "title": "Find Wayback snapshot", "category": "Archive",
        "when": "'url' in selection.kinds", "showInPalette": true }
    ],
    "contextMenuItems": [
      { "id": "snapshot-ctx", "title": "Find Wayback snapshot",
        "commandId": "snapshot", "group": "tools", "order": 10,
        "when": "'url' in selection.kinds" }
    ],
    "inspectors": [
      { "id": "wb-inspector", "title": "Wayback", "entry": "ui/inspector.js",
        "appliesTo": { "nodeTypes": [], "entityKinds": ["url"] }, "order": 600,
        "maxHeightPx": 160 }
    ],
    "settings": [
      { "key": "preferredYear", "label": "Preferred snapshot year", "type": "string",
        "help": "Empty = closest available.", "scope": "project" }
    ]
  },
  "events": ["selection.changed"],
  "network": { "allow": ["archive.org", "web.archive.org"],
               "maxRequestsPerMinute": 30, "maxResponseBytes": 262144 },
  "storage": { "maxBytes": 65536, "scope": "project" },
  "maturity": "beta",
  "minHostVersion": "1.0.0",
  "bundle": { "entryHash": "sha256:…", "sizeBytes": 18342,
              "csp": { "connectSrc": [], "imgSrc": [] } }
}
```

**`src/index.ts`**

```ts
import { definePlugin, type PluginContext, type ReadonlyNode } from '@nexus/plugin-sdk';

interface AvailabilityResponse {
  archived_snapshots?: {
    closest?: { available: boolean; url: string; timestamp: string; status: string };
  };
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export default definePlugin({
  async activate(ctx: PluginContext) {
    ctx.commands.register('snapshot', async ({ selection }) => {
      const urls = selection.filter(n => n.entityKind === 'url');
      if (urls.length === 0) {
        await ctx.ui.notify({ level: 'info', message: 'Select at least one URL node first.' });
        return;
      }
      if (urls.length > 25) {
        const ok = await ctx.ui.confirm({
          title: `Look up ${urls.length} URLs?`,
          body: 'Each URL is one request to archive.org. This may take a minute.',
          confirmLabel: 'Look up',
        });
        if (!ok) return;
      }

      const year = (await ctx.settings.get<string>('preferredYear'))?.trim() || undefined;

      const found = await ctx.ui.progress('Searching the Wayback Machine', async report => {
        const acc: { node: ReadonlyNode; snap: NonNullable<
          NonNullable<AvailabilityResponse['archived_snapshots']>['closest']> }[] = [];
        for (let i = 0; i < urls.length; i++) {
          const node = urls[i];
          report({ message: node.title, percent: Math.round((i / urls.length) * 100) });
          const snap = await lookup(ctx, String(node.props.url ?? node.title), year);
          if (snap?.available) acc.push({ node, snap });
        }
        return acc;
      });

      if (found.length === 0) {
        await ctx.ui.notify({ level: 'info', message: 'No snapshots found for the selected URLs.' });
        return;
      }

      await ctx.graph.propose({
        title: `Wayback snapshots (${found.length})`,
        nodes: found.map(({ node, snap }) => ({
          ref: `snap-${node.id}`,
          type: 'url',
          entityKind: 'url' as const,
          identityValue: snap.url,
          title: `Snapshot ${formatTs(snap.timestamp)}`,
          props: {
            url: snap.url,
            capturedAt: toIso(snap.timestamp),
            httpStatus: Number(snap.status),
            originalUrl: node.props.url ?? node.title,
          },
          tags: ['wayback'],
          confidence: 0.9,
          evidence: { url: availabilityUrl(String(node.props.url ?? node.title), year) },
        })),
        edges: found.map(({ node }) => ({
          from: { nodeId: node.id },
          to: { ref: `snap-${node.id}` },
          type: 'archived_as',
          label: 'archived as',
          confidence: 0.9,
        })),
      });

      await ctx.ui.notify({
        level: 'success',
        message: `Proposed ${found.length} snapshot${found.length === 1 ? '' : 's'} for review.`,
      });
    });
  },

  async deactivate() { /* nothing to release: no timers, no listeners beyond ctx-owned ones */ },
});

function availabilityUrl(url: string, year?: string): string {
  const q = new URLSearchParams({ url });
  if (year) q.set('timestamp', `${year}0101`);
  return `https://archive.org/wayback/available?${q.toString()}`;
}

async function lookup(ctx: PluginContext, url: string, year?: string) {
  const cacheKey = `wb:${year ?? 'closest'}:${url}`;
  const cached = await ctx.storage.get<{ at: number; snap: unknown }>(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.snap as never;

  try {
    const res = await ctx.net.fetch({
      url: availabilityUrl(url, year), method: 'GET',
      responseType: 'json', timeoutMs: 10_000,
    });
    if (res.status !== 200) {
      ctx.log.warn('availability API returned non-200', { status: res.status, url });
      return undefined;
    }
    const snap = (res.body as AvailabilityResponse).archived_snapshots?.closest;
    await ctx.storage.set(cacheKey, { at: Date.now(), snap });
    return snap;
  } catch (err) {
    ctx.log.error('availability lookup failed', { url, err: String(err) });
    return undefined;    // one failed URL must not fail the whole command
  }
}

const toIso = (ts: string) =>
  `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}T${ts.slice(8,10)}:${ts.slice(10,12)}:${ts.slice(12,14)}Z`;
const formatTs = (ts: string) => `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}`;
```

**`src/inspector.tsx`** (panel/inspector entries are separate bundles loaded into the iframe)

```tsx
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { connectInspector } from '@nexus/plugin-sdk';

function Inspector() {
  const [state, setState] = useState<{ url?: string; snapshot?: string; loading: boolean }>(
    { loading: true });

  useEffect(() => connectInspector(async (node, ctx) => {
    setState({ loading: true });
    const url = String(node.props.url ?? node.title);
    const cached = await ctx.storage.get<{ snap?: { url: string; timestamp: string } }>(
      `wb:closest:${url}`);
    setState({ loading: false, url, snapshot: cached?.snap?.url });
  }), []);

  if (state.loading) return <div class="skeleton" aria-busy="true" />;
  if (!state.snapshot)
    return <p class="empty">No snapshot looked up yet. Use <b>Find Wayback snapshot</b>.</p>;
  return (
    <a class="link" href={state.snapshot} target="_blank" rel="noreferrer noopener">
      Open archived copy
    </a>
  );
}

render(<Inspector />, document.getElementById('root')!);
```

**`test/plugin.test.ts`** — as in §8.3, plus the failure path (`net` returning 503 ⇒ no proposal,
one warning log, no toast spam).

**Note on the external API.** The `archive.org/wayback/available` endpoint and its response shape
are an **adapter assumption**, not a verified fact in this specification. The plugin therefore:
(a) treats any non-200 or unexpected shape as "no snapshot", (b) never throws to the host,
(c) surfaces the raw request URL as `evidence` so a user can verify manually. If the endpoint
changes, only `lookup()` changes. This is the pattern every third-party plugin must follow, and
review checks for it (§9.2 item 7).

---

## 9. Registry, distribution and review

### 9.1 Distribution model

Three channels, all supported by the same install path (§7.2):

1. **Public registry** (`registry.nexus.*`): signed artifacts, semver index, publisher accounts with
   verified email + domain proof for the `verified` badge. Serves a static JSON index plus artifacts
   from object storage; no server-side code execution.
2. **Private/org registry**: an org can point `NEXUS_PLUGIN_REGISTRY` at its own index URL
   (same schema); useful for internal plugins in air-gapped self-host deployments.
3. **Direct artifact upload** by an org admin (`.nexplug` file). Signature still verified unless
   `NEXUS_ALLOW_UNSIGNED_PLUGINS=1`.

Registry index entry:

```ts
export interface RegistryEntry {
  id: string; latest: string;
  versions: { version: string; artifactUrl: string; sha256: string;
              apiVersion: string; minHostVersion: string; publishedAt: string;
              yanked?: { at: string; reason: string } }[];
  publisher: { id: string; name: string; verified: boolean };
  manifestPreview: Pick<PluginManifest, 'name'|'description'|'permissions'|'contributes'|'maturity'>;
  stats: { installs: number; rating?: number };
}
```

**Yanking:** a version can be yanked (security issue). Hosts poll the index every 6 h; a yanked
version that is installed is auto-disabled with the reason shown to admins. This is the only case
where the host disables a plugin without user action, and it is always explained.

### 9.2 Review criteria (public registry)

Automated (blocking):

1. Manifest parses; permissions are minimal — every declared permission is exercised by at least
   one code path found by static analysis, otherwise flagged "over-requested".
2. Bundle contains no `eval`, `new Function`, `import()` of remote URLs, or obfuscated/minified-
   beyond-recognition code without a source map.
3. No attempt to reach `window.parent` beyond the SDK, no `document.domain`, no top-navigation.
4. Bundle ≤ 8 MiB; no binaries other than declared images/fonts.
5. `network.allow` contains no wildcards broader than one label (`*.example.com` ok,
   `*` or `*.com` rejected).
6. Backend contributions: image digest pinned, `runtimeClass: gvisor`, `network.mode ≠ broad`,
   parser passes the isolate-compatibility check (no forbidden globals).
7. External-API resilience: every `net.fetch` call site has an error path (no unhandled rejection),
   and no non-200 response is treated as success. Checked by lint rule + the required test file.
8. A test suite exists and passes in the review sandbox.

Human (for `verified` publishers, high-risk permissions, or any backend contribution):

9. The description matches observed behaviour; the consent text is accurate and not misleading.
10. Data flow review: what leaves the user's deployment, to whom, and whether the privacy URL says
    so.
11. UI review: no imitation of host chrome, no dark patterns, respects tokens and reduced motion.

Rejection reasons are published to the publisher verbatim; there is no silent rejection.

### 9.3 Trust levels

| Level | Meaning | Consequences |
|---|---|---|
| `dev` | loaded from localhost | DEV badge, never auto-updates, blocked in strict orgs |
| `unverified` | signed, automated review only | max proposal confidence 0.9, `net:broad` refused in strict orgs, amber badge |
| `verified` | publisher identity + human review | full permission range, normal badge |
| `first-party` | shipped in `packages/integrations` | may use custom pipeline stages (§5.3) and `network.mode: broad` |

---

## 10. Observability and support

* Per-plugin metrics: `nexus_plugin_rpc_total{plugin,ns,method,outcome}`,
  `nexus_plugin_rpc_duration_seconds`, `nexus_plugin_fetch_total{plugin,host,decision}`,
  `nexus_plugin_frame_crashes_total{plugin}`, `nexus_plugin_card_budget_exceeded_total{plugin}`.
* Settings → Plugins → *Activity* shows, per plugin: RPC calls (24 h), hosts contacted, proposals
  created/applied, errors, storage used. This is the user-visible answer to "what is this plugin
  doing?", and it is a hard requirement, not a nicety.
* Every permission-denied call is logged with plugin id, method and reason; three denials of the
  same permission within a minute raise a notice suggesting the user check the plugin.
* Audit events: `plugin.installed`, `plugin.updated`, `plugin.enabled`, `plugin.disabled`,
  `plugin.uninstalled`, `plugin.permission.granted`, `plugin.permission.revoked`,
  `plugin.proposal.created`, `plugin.violation` (protocol/quota/CSP), `plugin.yanked.autodisabled`.

---

## 11. Testing requirements

1. **Manifest fixtures** — valid, plus 20 invalid variants asserting the exact zod issue path.
2. **RPC protocol tests** — malformed envelopes, oversize messages, wrong `event.source`, replayed
   ids, missing deadlines; each must be rejected without affecting other plugins.
3. **Permission matrix test** — for every API method × every permission set, assert allow/deny.
   Generated from a table so a new method without an entry fails the build.
4. **Isolation e2e** — a hostile fixture plugin (`e2e/fixtures/hostile-plugin/`) attempts:
   `window.parent.document`, `fetch('https://evil')`, `localStorage`, `top.location = …`,
   a 1 GB allocation, a 4 MiB/s message flood, `img src` beacon to a non-allowlisted host, a forged
   `result` envelope. Every attempt must fail and be audited.
5. **Performance** — 24 plugin card iframes on a 5,000-node board must not regress N1 by more than
   5%; card budget violations must trigger the builtin fallback.
6. **Lifecycle e2e** — install → consent → use → update with a new permission (blocked until
   consent) → disable → uninstall, asserting the data retention table in §7.6.
7. **Example plugin** is part of CI: it must build, pass `validate`, and pass its own tests on every
   SDK change — it is the canary for accidental API breakage.

---

## Open risks

1. **Iframe cost vs. custom cards.** Plugin-rendered node cards are the most likely source of
   canvas performance regressions. The 24-iframe pool + 8 ms budget + automatic fallback bound the
   damage, but a board full of plugin cards will feel heavier than one without. If telemetry shows
   frequent fallbacks, the honest fix is to remove `ui:nodeRenderer` and offer only declarative
   card templates.
2. **Null-origin sandbox limits debugging.** With `allow-same-origin` absent, plugin frames have no
   DevTools storage inspection and opaque error origins. Dev-mode logging mitigates it; publishers
   will still find debugging harder than in a normal web app. Accepted for isolation.
3. **`connect-src 'none'` can be bypassed by covert channels** (`img-src`, prefetch, navigation).
   We allowlist `img-src` narrowly and forbid top-navigation, but a determined plugin with an
   allowlisted image host can exfiltrate low-bandwidth data. Review criterion §9.2 item 5 is the
   real control; there is no purely technical fix.
4. **Parser isolates are not a security boundary of the same strength as a container.** `node:vm`
   escapes exist historically. Mitigation: parsers get no I/O, no network and a CPU deadline; if a
   stronger boundary is needed, move parse execution into the runner container (costs one more
   container per run — revisit if a real escape class appears).
5. **Registry trust bootstrap.** Publisher verification is only as good as the domain-proof
   process; an unverified plugin with an appealing name is the classic supply-chain vector. The
   install dialog's "will NOT" block and the confidence clamp reduce impact, not likelihood.
6. **Semver honesty.** Nothing forces a publisher to bump major for a behavioural change that keeps
   the manifest identical. Automated diffing of contributions catches manifest-level changes only.
7. **Permission fatigue.** Eight to ten checkboxes at install will be skimmed. We mitigate with the
   negative-space list and per-use prompts for the two high-risk permissions; if telemetry shows
   blind acceptance, reduce the taxonomy rather than adding more dialogs.
8. **Storage quota (256 KiB)** may be too small for plugins that cache large lookup tables; raising
   it is easy but interacts with `storage:sync` bandwidth. Revisit with real usage data rather than
   speculatively.
