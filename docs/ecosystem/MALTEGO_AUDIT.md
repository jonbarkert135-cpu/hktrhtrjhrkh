# Maltego ecosystem audit

**Purpose.** Layer 4 of the product brief (`prompts/PROMPT_4_MALTEGO_ECOSYSTEM_RU.md`) asks for a
current audit of the Maltego ecosystem, used as an _architectural reference point_ for Raven's own
transform layer — explicitly not as something to clone. This document is the audit: what Maltego is
today, what it does well, what it does badly, and a per-feature decision for Raven.

**Method.** Public sources only: maltego.com, the Maltego knowledge base (docs.maltego.com /
support.maltego.com), the Data Hub listing page, and public commentary. No Maltego code, no
proprietary transform implementations, no private APIs and no reverse engineering were involved,
and none may be used in the implementation either (§2 of the brief).

**Last verified: 2026-08-19.** Every claim below is dated. Vendor plans change; re-verify before a
statement from this file is used to make a build decision, and update the date when you do.

---

## 1. What Maltego is in 2026

Maltego is no longer "the Java graph tool". It is a platform sold in four plan families — **Basic**
(free), **Entry**, **Professional**, **Enterprise** — bundling a set of products
[maltego.com/pricing + KB article 15000036759, verified 2026-08-19]:

| Product                    | What it is                                                               |
| -------------------------- | ------------------------------------------------------------------------ |
| **Graph (Desktop)**        | The classic desktop link-analysis client. Transforms, entities, layouts. |
| **Graph (Browser)**        | Browser link analysis with map/histogram views and an AI assistant.      |
| **Search**                 | Browser product for quick preliminary OSINT lookups on a selector.       |
| **Cases**                  | Web app for storing and collaborating on investigations.                 |
| **Data** (Data Pass + Hub) | Access to third-party data through credits and 100+ prebuilt connectors. |
| **Monitor**                | Real-time social-media monitoring.                                       |
| **Evidence**               | Capture and local preservation of social-media evidence.                 |
| **Hunchly**                | Browser extension that captures and preserves pages during research.     |

Commercially the important detail is that **data access is metered in credits**, not included:
Basic gets 200 credits/month (Basic+ 1,000 for verified government/organisational email),
Professional 20,000–40,000, and the Basic plan caps a transform run at **24 results**
[maltego.com/pricing, KB 15000036759, verified 2026-08-19].

### 1.1 The transform model

A **Transform** takes one or more entities and returns entities, links and properties. Transforms
are served by a _transform server_, discovered through a **seed URL**, and distributed either
locally (local transforms executed on the analyst's machine), through the legacy TDS/iTDS, or
through Hub items. The current developer path is the Python SDK package `maltego-transforms`,
which replaced `maltego-trx`; TRX, TDS and iTDS are documented as legacy
[support.maltego.com "Maltego Transforms SDK Overview", verified 2026-08-19].

### 1.2 The Data Hub

The Hub (formerly Transform Hub, now presented as the Data Hub) is a catalogue of integrations
filterable by **data category** (Infrastructure, Cryptocurrency, Deep & Dark Web, Social Media,
company data, personal identifiers, vulnerabilities, and others), by **use case / team**, and by
pricing. Most listings are commercial providers requiring their own subscription and API key; a
minority are free or included [maltego.com/transform-hub + Maltego blog "Maltego Data Integrations
Just Got Bigger and Better", verified 2026-08-19].

---

## 2. What Maltego does well (and Raven should learn from)

1. **Entity → operation → new entities.** One conceptual loop that an analyst can hold in their
   head, applied uniformly to every data source. This is the single most valuable idea in the
   product and the core of Layer 4.
2. **The transform is a stable user-facing contract**, decoupled from whichever server implements
   it. Adding a data source does not change how the graph works.
3. **Set-based execution.** Selecting 40 entities and running one transform over all of them is
   normal, not a power-user trick.
4. **Machine/macro concept** — chaining transforms into a reusable investigation routine.
5. **Provenance is visible**: which transform produced a node, with detail views per entity.
6. **A real ecosystem contract** — a documented SDK, a seed/hub distribution mechanism, and a
   review process for published items. Third parties can extend the tool without forking it.
7. **Category-based discovery** of data sources instead of an alphabetical list of 100+ vendors.

## 3. What Maltego does badly (and Raven must not copy)

| Observed problem                                                                                                                            | Why it is bad                                                                                              | Raven's answer                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop client is heavy; users publicly complain about graph performance on large graphs [public commentary, e.g. LinkedIn post 2024-07-31] | Investigations stall at exactly the graph size where they get interesting                                  | Raven's canvas engine already holds 5,000 nodes at p95 1.7 ms/frame headless and is budgeted at 16.6 ms in-browser (`RAVEN-SPEC/16`)    |
| Value is gated behind **credits**; the free plan truncates a run to 24 results                                                              | Silent truncation corrupts an investigation: the analyst cannot tell "no more data" from "no more credits" | Raven never truncates silently. Budgets are explicit, shown before the run, and a truncated result carries a `budget-exhausted` warning |
| Data-source status is a marketing surface: "free", "included", "requires subscription" are mixed in one catalogue                           | Analysts discover mid-investigation that a transform needs a purchase                                      | Credential class is a first-class, machine-readable field (`docs/ecosystem/PROVIDER_CATALOG.md`) with a verification date               |
| Choosing transforms is manual — long context menus organised by vendor, not by intent                                                       | The analyst must know the vendor catalogue to do their job                                                 | Capability-first routing: the user picks an intent, Raven picks engines (`RAVEN-SPEC/21` §5)                                            |
| Results are dumped onto the graph                                                                                                           | 200 new nodes destroy the mental model and the layout                                                      | Proposal → review → apply, with result clusters and density control (`RAVEN-SPEC/21` §9)                                                |
| Local transforms execute arbitrary code on the analyst's machine with the analyst's privileges                                              | A supply-chain problem dressed as an extensibility feature                                                 | Every engine runs in the Runner sandbox with declared permissions and allowlisted egress (`RAVEN-SPEC/10` §5, `15_SECURITY.md`)         |
| Data leaves the machine as soon as a transform runs, with no per-run disclosure                                                             | Unacceptable for local-first, and often unacceptable legally                                               | Each transform declares `dataFlow` (local / network / external API); Strict Local Mode blocks the rest (`RAVEN-SPEC/21` §7)             |
| Java desktop distribution                                                                                                                   | Install friction, slow start, platform bugs                                                                | Browser-first, local-first, no runtime install                                                                                          |

## 4. Feature-by-feature decision table

Verdicts: **Keep** (adopt the idea as-is), **Adapt** (adopt with a Raven-native design),
**Improve** (adopt and fix a known weakness), **Replace** (Raven does something different that
covers the same need), **Reject** (do not build).

| Maltego feature              | Verdict  | Raven's version                                                                                               |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| Entity model                 | Adapt    | `EntityKind` already exists in `packages/integrations`; Layer 4 adds only the transform-facing selector types |
| Transform concept            | Keep     | `TransformManifest` (`RAVEN-SPEC/21` §3)                                                                      |
| Transform sets               | Improve  | Capability bundles chosen by the planner, not hand-maintained sets                                            |
| Machines (macros)            | Adapt    | Expand plans and saved plans (`RAVEN-SPEC/21` §8); a DAG, not a scripting language                            |
| Hub / catalogue              | Adapt    | Transform Library with credential-class filters and honest status                                             |
| Local transforms             | Improve  | Same idea, executed in the sandbox with declared permissions                                                  |
| TDS / iTDS servers           | Reject   | Raven is local-first; a central distribution server is not needed for v1                                      |
| Credit metering              | Reject   | Raven meters _its own_ budgets (time, nodes, requests); provider credits are the provider's business          |
| Detail view / provenance     | Improve  | Evidence layer + traceability chain per entity (`RAVEN-SPEC/21` §10)                                          |
| Graph layouts                | Keep     | Already in the canvas engine roadmap                                                                          |
| Cases / collaboration        | Adapt    | Projects (P7) and sync (P8), already specced                                                                  |
| Monitor (real-time)          | Future   | Out of Layer 4; revisit after the transform runtime exists                                                    |
| Evidence (social capture)    | Adapt    | Capture (P6) + evidence records; no platform-ToS-violating scraping                                           |
| Search product               | Adapt    | Universal query bar over transforms and entities (`RAVEN-SPEC/21` §11)                                        |
| AI assistant                 | Improve  | Research agent plans transform DAGs under hard budgets (`14_AI_AGENT.md` + `RAVEN-SPEC/21` §8.4)              |
| Hunchly-style page capture   | Future   | Overlaps with P6 capture; separate decision                                                                   |
| Commercial connector library | Reject/E | Raven links out to providers instead of reselling them; users bring their own keys                            |

## 5. Capability matrix

"Raven need" is this project's own judgement of how much the capability matters for a local-first
research canvas, independent of whether Maltego has it.

| Capability                       | In Maltego | Raven need | Free option                        | Local option          | API key | Priority    |
| -------------------------------- | ---------- | ---------- | ---------------------------------- | --------------------- | ------- | ----------- |
| Username → profile discovery     | yes        | high       | yes (Sherlock, MIT)                | yes                   | no      | Core        |
| Domain → DNS records             | yes        | high       | yes (DoH resolvers)                | yes (system resolver) | no      | Core        |
| Domain → subdomains              | yes        | high       | yes (CT logs, subfinder)           | yes                   | no      | Core        |
| Domain → certificates            | yes        | high       | yes (crt.sh, CT search free tier)  | no                    | mixed   | Core        |
| Domain/IP → registration (RDAP)  | yes        | high       | yes (RDAP, ICANN bootstrap)        | no                    | no      | Core        |
| URL/domain → archived snapshots  | partial    | high       | yes (Wayback CDX, Common Crawl)    | no                    | no      | Core        |
| Repository/user → code intel     | partial    | high       | yes (GitHub REST, 60 req/h anon)   | yes (git clone)       | opt.    | Core        |
| Web mentions / search            | yes        | high       | limited (Brave API free credits)   | no                    | yes     | Recommended |
| IP → scan/exposure data          | yes        | medium     | limited (Shodan/Censys free tiers) | no                    | yes     | Recommended |
| IP/domain → reputation           | yes        | medium     | yes (AbuseIPDB, GreyNoise, OTX)    | no                    | yes     | Recommended |
| File/URL → malware verdicts      | yes        | medium     | yes (VirusTotal public API)        | yes (hashing locally) | yes     | Recommended |
| Email → breach exposure          | yes        | medium     | passwords only (HIBP free range)   | no                    | paid    | Optional    |
| Company registry data            | yes        | medium     | partial (OpenSanctions non-comm.)  | no                    | mixed   | Optional    |
| Sanctions / PEP screening        | yes        | medium     | yes for non-commercial             | yes (bulk dataset)    | yes     | Optional    |
| Blockchain address analytics     | yes        | medium     | yes (mempool.space, Blockchair)    | yes (own node)        | mixed   | Optional    |
| Geocoding / place resolution     | partial    | low        | yes (Nominatim, strict policy)     | yes (self-hosted)     | no      | Optional    |
| Knowledge-base enrichment        | partial    | medium     | yes (Wikidata SPARQL)              | yes (dump)            | no      | Recommended |
| File metadata extraction         | partial    | high       | yes (open-source parsers)          | yes                   | no      | Core        |
| Social-media monitoring          | yes        | low        | no                                 | no                    | paid    | External    |
| Identity resolution (Pipl-class) | yes        | low        | no                                 | no                    | paid    | External    |
| Dark-web market data             | yes        | none       | no                                 | no                    | paid    | Never       |
| Credential-dump lookups          | partial    | none       | no                                 | no                    | paid    | Never       |

The last two rows are deliberate: "never" means Raven does not integrate them at all, on legal and
ethical grounds (`RAVEN-SPEC/15_SECURITY.md` §9), not because they are technically hard.

## 6. What Raven wins on

Not the count of integrations. The brief is explicit and this audit agrees: 100+ connectors is a
sales number, and most of them are unusable without a separate purchase. Raven's advantages are
graph UX and performance, a planner that picks engines so the analyst does not have to, honest
credential and privacy disclosure, local-first execution, an open plugin contract, and results that
arrive as reviewable proposals instead of graph dumps.

## 7. Licensing and legal notes

- Maltego names, entity icons, hub listings and documentation are the vendor's. This audit cites
  them; nothing is copied into the product.
- Every engine Raven bundles must carry a permissive licence recorded in the provider catalogue
  (Sherlock MIT, subfinder MIT, Amass Apache-2.0 — [GitHub, verified 2026-08-19]).
- Data licences travel with the data: OpenStreetMap/Nominatim results are ODbL and require
  attribution [OSMF Nominatim usage policy, verified 2026-08-19]; OpenSanctions is free for
  non-commercial use only [opensanctions.org/docs/api, verified 2026-08-19]. The transform manifest
  records `dataLicense`, and the export path carries it (`RAVEN-SPEC/21` §3.4).
- Provider terms are not a suggestion: rate limits and attribution requirements are encoded in the
  provider registry, not left to the runtime to discover through 429s.

## 8. Open questions for a later pass

1. Whether Raven should publish a hub-like distribution channel at all, or stay at "install a
   signed plugin package" (decide with `17_PLUGIN_SDK.md` in P15).
2. Whether the research agent may spend a provider's paid quota without a per-run confirmation.
3. Bulk datasets (Common Crawl, OpenSanctions dumps) need a storage story before they become
   transforms; they are catalogued but not scheduled.
