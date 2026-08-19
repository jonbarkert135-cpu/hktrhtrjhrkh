# Raven — 23 — COMPETITOR & ADJACENT-PRODUCT MATRIX

## Scope

Where Raven sits among the products an analyst could use instead: commercial intelligence platforms,
open-source investigation stacks, canvas/knowledge tools, and AI research agents. The purpose is to
decide what to copy, what to do better, what to deliberately not build, and which gap Raven is
actually filling — not to produce a sales battlecard.

Non-goals: the open-source engines Raven builds **on** (`22_ECOSYSTEM_AUDIT.md`), the Maltego
transform ecosystem specifically (`docs/ecosystem/MALTEGO_AUDIT.md`), and the design of our own
query layer (`24_UNIFIED_QUERY.md`).

> **Provenance, read this first.** Dated 2026-08-19. This document is a **qualitative positioning
> analysis** based on domain knowledge of these products. Unlike `22_ECOSYSTEM_AUDIT.md`, its rows
> were **not** verified against primary sources in this pass. Therefore it deliberately contains
> **no version numbers, no prices, no release dates and no licence assertions** that a decision
> could be hung on. Treat every cell as a hypothesis about product shape, useful for direction,
> unusable as evidence. §7 lists exactly what must be verified before any of this informs a
> commitment (licences and pricing above all).

---

## 1. What is table stakes in 2026

A product in this space that lacks these is not considered serious by buyers. None of them is a
differentiator; all of them are the entry ticket.

1. An entity/link graph with expandable nodes, plus timeline and map views over the same data.
2. A connector/transform catalog rather than hard-coded sources, with per-source credentials.
3. Full-text and semantic search over ingested documents, OCR for scans, transcription for media.
4. LLM assistance: summarize a document set, draft a dossier, natural language to query. Expected
   everywhere, good almost nowhere.
5. Provenance and an audit trail — who collected what, when, from where.
6. Collaboration: cases, comments, roles. SaaS by default, self-hosting for government buyers.
7. Report export with figures and citations.
8. In the canvas tier specifically: real-time multiplayer.
9. In the notes tier specifically: local-first storage with offline editing and CRDT sync.

Raven's non-negotiable additions on top of that list: local-first as the **default** shape, and
provenance an analyst can actually click through to the raw response.

---

## 2. The matrix

Columns follow the brief. "Relevance" means relevance to Raven's design decisions, not market
threat. All rows unverified (see the banner).

### 2.1 Commercial intelligence platforms

| Product                                             | Category                | Best features                                                              | Weaknesses                                                                        | OSS    | Self-host | API     | Plugin-friendly  | Architecture                       | UX lesson                                                    | Relevance                       |
| --------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ | --------- | ------- | ---------------- | ---------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| Maltego                                             | Intel platform          | Transform ecosystem; expand-on-node is the genre's reference gesture       | Desktop-Java feel; per-transform data costs stack; graphs get unreadable at scale | No     | Partly    | Yes     | Yes (transforms) | Desktop client + transform servers | Right-click an entity → pick an engine → results attach      | **High**                        |
| Palantir Gotham / Foundry                           | Intel platform          | Ontology layer, lineage, scale                                             | Cost; depends on forward-deployed engineers; unbuyable by small teams             | No     | Yes       | Yes     | Limited          | Ontology + pipelines               | Ontology-first modelling (conceptually)                      | Medium                          |
| IBM i2 Analyst's Notebook                           | Intel platform          | Link-chart semantics and timeline analysis; the LE standard                | Legacy Windows UI; weak collaboration                                             | No     | Yes       | Limited | Some             | Thick desktop client               | Its chart conventions are worth mirroring                    | Medium                          |
| Blackdot Videris                                    | OSINT platform          | The cleanest modern graph UI in the commercial tier; collection into chart | Closed; limited extensibility                                                     | No     | Some      | Yes     | No               | SaaS + collectors                  | Collection results flow straight into the chart              | **High**                        |
| Skopenow / Liferaft Navigator                       | OSINT SaaS              | Fast person/company dossiers                                               | Shallow past the dossier; brittle when platforms change                           | No     | No        | Some    | No               | SaaS collectors                    | One-click dossier as an entry point                          | High                            |
| ShadowDragon Horizon                                | OSINT                   | Broad social/dark-web collection                                           | Ethics criticism; uneven UI                                                       | No     | Some      | Yes     | Some             | Collector suite                    | —                                                            | Medium                          |
| Recorded Future / Babel Street / Fivecast / Cognyte | Data-feed intel         | Curated feeds, alerting, risk scoring                                      | You rent data, not tooling; opaque sourcing; ethics exposure                      | No     | Rarely    | Yes     | No               | SaaS feed + analytics              | Alerting UX only                                             | Medium (as sources, not rivals) |
| Nuix Investigate                                    | eDiscovery/forensics    | Huge-corpus processing; forensic formats                                   | Heavy, expensive, forensic rather than OSINT                                      | No     | Yes       | Yes     | Some             | Distributed processing             | Avoid its interface density                                  | Low                             |
| Linkurious Enterprise                               | Graph analytics         | Investigation UI over an existing graph DB; alerting                       | Requires you to already have the graph                                            | No     | Yes       | Yes     | Some             | On top of Neo4j                    | Graph filtering UX                                           | Medium                          |
| Siren                                               | Investigative analytics | Graph + search + timeline, federated queries                               | Real data-engineering effort to stand up                                          | Partly | Yes       | Yes     | Yes              | Elasticsearch-backed federation    | "Query where the data lives" instead of ingesting everything | High                            |

### 2.2 Open-source investigation stacks

| Product           | Category            | Best features                                                                 | Weaknesses                                                | OSS      | Self-host | API           | Plugin-friendly | Architecture              | UX lesson                                    | Relevance              |
| ----------------- | ------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- | -------- | --------- | ------------- | --------------- | ------------------------- | -------------------------------------------- | ---------------------- |
| OpenCTI           | OSS threat intel    | STIX2 data model; a real connector contract; active community                 | CTI-shaped rather than general investigation; heavy stack | Yes      | Yes       | Yes (GraphQL) | Yes             | GraphQL + search + queue  | Its connector contract is a model to copy    | **High**               |
| OCCRP Aleph       | OSS investigation   | Cross-dataset entity matching; the FollowTheMoney ontology; leak-scale ingest | Ops-heavy; search-centric, no canvas                      | Yes      | Yes       | Yes           | Some            | FtM + relational + search | Adopt FtM rather than inventing a schema     | **High**               |
| SpiderFoot        | OSS/SaaS recon      | Very many modules; automated scans                                            | Noisy output; weak correlation                            | Core OSS | Yes       | Yes           | Yes (modules)   | Scan engine + modules     | The module model; the noise is the lesson    | **High** (already P12) |
| ICIJ Datashare    | OSS documents       | Local document analysis, NER, batch search                                    | Documents only; no graph canvas                           | Yes      | Yes       | Some          | Some            | Local service + search    | Local-first stance matches ours              | High                   |
| Timesketch        | OSS timeline        | Collaborative timeline analysis; sketches as artifacts                        | Forensics-shaped; dated UI                                | Yes      | Yes       | Yes           | Yes             | Search-backed             | The timeline is a saved object, not a toggle | Medium                 |
| Gephi / Cytoscape | OSS graph           | Layout algorithms and network metrics                                         | Desktop, static, no investigation workflow                | Yes      | Yes       | Partly        | Yes             | Desktop + plugins         | The metrics menu                             | Low                    |
| Graphistry        | Graph visualization | GPU rendering of very large graphs                                            | Visualization layer only                                  | Partly   | Yes       | Yes           | Yes             | GPU rendering             | Scale-rendering lessons                      | Medium                 |

### 2.3 Canvas, notes and knowledge tools

| Product                           | Category           | Best features                                                              | Weaknesses                                        | OSS                       | Self-host  | API       | Plugin-friendly | Architecture                | UX lesson                                                   | Relevance |
| --------------------------------- | ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------- | ---------- | --------- | --------------- | --------------------------- | ----------------------------------------------------------- | --------- |
| Obsidian (+ Canvas, Excalidraw)   | Knowledge          | Local plain files; the strongest plugin ecosystem; open canvas file format | Canvas weak at scale; no data layer               | App is free, not OSS      | Local      | Local-ish | Best-in-class   | Markdown vault + plugin API | Plain, diffable case files; canvas-file interop             | **High**  |
| Affine                            | Knowledge / canvas | Document ↔ whiteboard duality over one content model; local-first         | Younger; performance                              | Yes                       | Yes        | Some      | Some            | CRDT block model            | One keystroke between page and edgeless mode                | **High**  |
| Milanote / Miro / FigJam          | Canvas             | Multiplayer, polish, performance                                           | No data model beneath the rectangles              | No                        | No         | Yes       | Some            | SaaS canvas                 | Multiplayer feel; nothing structural                        | Medium    |
| tldraw                            | Canvas SDK         | Embeddable, excellent interaction model                                    | **Licence terms must be verified** before any use | Source-available (verify) | Yes        | Yes       | Yes             | React canvas SDK            | Interaction model reference only — we render our own canvas | Medium    |
| Heptabase / Scrintal / Kosmik     | Visual research    | Cards on a canvas tied to reading and notes                                | Cloud, closed, small teams                        | No                        | No         | Limited   | No              | SaaS canvas                 | Card-on-canvas reading workflow                             | High      |
| Notion                            | Knowledge          | Databases + docs, polish                                                   | Cloud-only; no real canvas                        | No                        | No         | Yes       | Yes             | SaaS blocks                 | Database views over the same objects                        | Medium    |
| Tana / Capacities / Logseq / Roam | Outliner / PKM     | Typed objects and supertags                                                | Learning curve; ecosystem churn                   | Logseq yes                | Logseq yes | Some      | Some            | Block graph                 | Typed objects, not free text                                | Medium    |
| Kumu                              | Relationship maps  | Beautiful stakeholder maps                                                 | Manual data; no collection                        | No                        | No         | Some      | No              | SaaS                        | Map styling                                                 | Low       |

### 2.4 AI research and agent products

| Product                                         | Category       | Best features                                          | Weaknesses                                    | OSS    | Self-host | API  | Plugin-friendly | Architecture                 | UX lesson                              | Relevance |
| ----------------------------------------------- | -------------- | ------------------------------------------------------ | --------------------------------------------- | ------ | --------- | ---- | --------------- | ---------------------------- | -------------------------------------- | --------- |
| NotebookLM                                      | AI research    | Answers grounded in your own sources, with citations   | Cloud; closed corpus; no graph                | No     | No        | No   | No              | Hosted model + grounding     | Every sentence anchored to a source    | High      |
| Deep-research products / GPT Researcher / STORM | AI agents      | Multi-step planning; outline-then-write; cited reports | Slow; hallucinated citations; output is prose | Partly | Yes       | Yes  | Yes             | planner → retriever → writer | **Show the plan while it runs**        | **High**  |
| Perplexity Spaces                               | AI research    | Fast sourced answers; shared spaces                    | Shallow; no durable artifact                  | No     | No        | Yes  | No              | Search + LLM                 | Inline citation chips                  | Medium    |
| Elicit / Consensus                              | AI research    | Structured extraction across papers                    | Academic corpus only                          | No     | No        | Some | No              | Paper pipelines              | Extraction straight into a table       | Medium    |
| Reor / Khoj                                     | Local AI notes | Local models over your own notes                       | Rough edges; small projects                   | Yes    | Yes       | Some | Some            | Local embeddings             | Local RAG plumbing                     | Medium    |
| Hunchly                                         | Capture        | Automatic, hashed capture of everything you browse     | Platform-bound; capture only, no analysis     | No     | Local app | No   | No              | Extension + local store      | **Passive capture into the open case** | **High**  |

---

## 3. Best ideas to adopt

1. **Expand-on-node (Maltego).** Right-click an entity, choose a capability, results attach as
   connected nodes. This is the single most important borrowed gesture; `24_UNIFIED_QUERY.md` §3
   makes the query bar the second entry point to the same machinery.
2. **A documented connector contract (OpenCTI).** Declared inputs, outputs, rate limits and
   confidence, so third parties can ship engines. Already our manifest direction — the lesson is to
   document and version it as a public contract, not an internal shape.
3. **FollowTheMoney (Aleph).** Strongly consider adopting FtM as the entity ontology, or at minimum
   guaranteeing a lossless FtM import/export. It is the closest thing to a shared standard in
   investigative journalism, and adopting it makes Raven interoperable on day one instead of being
   another silo. **Decision to be taken in P17 planning, with the FtM spec actually read.**
4. **Passive capture (Hunchly).** A browser companion that archives, hashes and timestamps every
   page visited during a case. Cheap to build on top of the P6 capture pipeline, and it is the
   feature working investigators reliably rave about.
5. **Page ↔ edgeless duality (Affine).** The same content as a document or as canvas objects, one
   keystroke apart.
6. **Plain, diffable case files (Obsidian).** A case is a folder you can put in git, not a blob in
   someone's cloud — the natural expression of our local-first ADR.
7. **Show the plan while it runs (STORM / deep-research agents).** Our plan review surface
   (`24` §5) is exactly this, one step further: the plan is editable before it executes.
8. **Citation anchoring (NotebookLM).** Any generated sentence links to the exact node and the exact
   raw response that supports it.
9. **The timeline as a saved artifact (Timesketch)**, not a view toggle.

## 4. Ideas to improve on

| Their failure                                                  | Raven's answer                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Graphs become hairballs past a few hundred nodes (Maltego, i2) | auto-clustering and "collapse to group" by default; spatial layout the analyst controls |
| One-click dossiers are shallow and locked (Skopenow, Liferaft) | a dossier is an editable canvas subgraph, not a PDF                                     |
| Module output is noise (SpiderFoot)                            | ranked, deduplicated, confidence-scored results; raw hits behind a drawer (`24` §7)     |
| Deep-research agents produce a wall of prose                   | agents produce typed entities and claims on the canvas; prose is optional output        |
| Canvases have no data layer (Obsidian Canvas, Miro)            | every node is a typed entity with properties and provenance                             |
| Excellent link semantics trapped in a 2005 UI (i2)             | keep the semantics, modern rendering (`07_EDGE_SYSTEM.md`)                              |
| "Audit log" that you cannot actually inspect (everyone)        | click a fact → see the run, the request and the raw response                            |

## 5. Ideas to reject, deliberately

- **Ontology modelling before value (Palantir).** Raven must be useful within ten minutes of first
  launch, with zero configuration.
- **Selling data feeds.** A licensing trap and an ethics exposure; Raven sells tooling, and paid
  data stays BYOK (`22_ECOSYSTEM_AUDIT.md` §7).
- **Cloud-only multiplayer as the default (Miro, Notion).** It breaks the local-first guarantee that
  is our whole positioning.
- **Automated "risk scores" on people (Fivecast/Cognyte flavour).** Impressive in a demo,
  indefensible in real casework, legally and ethically toxic. Confidence in Raven describes _how
  well a fact is sourced_, never _how dangerous a person is_.
- **Auto-layout as the primary interaction (Gephi).** Investigators rely on spatial memory; a graph
  that re-shuffles itself destroys it.
- **Forensic chain-of-custody certification (Nuix).** Large scope, small market, not our first act.

## 6. Ideas to build ourselves — where Raven wins

Five gaps nobody currently serves; together they are Raven's actual product thesis:

1. **Local-first _plus_ serious collection.** Intelligence platforms are SaaS; local-first tools do
   not collect. Nothing does both. This is the primary gap.
2. **A canvas with a real entity model beneath it.** Canvas tools are dumb rectangles; graph tools
   deny spatial freedom.
3. **An affordable middle tier** between free-but-noisy open-source recon and enterprise platforms
   priced for governments — the three-person team, the newsroom, the fraud analyst.
4. **Agents that produce artifacts, not essays** — verified entities dropped into a workspace you
   keep working in.
5. **Provenance you can actually inspect** — click a fact, see the HTTP response that produced it.

Concretely, this implies building: the engine-orchestration plan as canvas objects; a single
file-backed case bundle holding graph, vectors and documents; provenance as a first-class visual;
time-travel and run-diff over the case's CRDT history; BYO-model routing with a per-case budget; and
importers for Maltego `.mtgx`, Obsidian `.canvas`, Aleph FtM and OpenCTI STIX, so Raven is a
migration target rather than another silo.

## 7. Verification backlog (must be done before any of this drives a commitment)

1. **tldraw's licence terms** — asserted nowhere in this file; verify before even prototyping with it.
2. **FollowTheMoney** — read the spec and Aleph's import/export surface before deciding on adoption.
3. **OpenCTI's connector contract** — read the actual interface docs before copying it.
4. **The Obsidian `.canvas` format spec** — verify before promising interop.
5. **Affine's project status and licence.**
6. **STORM / GPT Researcher licences** if any code is reused rather than only the idea.
7. **All pricing claims** — none are made here; if any enter a deck or a positioning statement they
   must be sourced first.
8. **User complaints** should be sourced from real forums (r/OSINT, product communities, review
   sites) rather than recollection, before §4 hardens into product decisions.
