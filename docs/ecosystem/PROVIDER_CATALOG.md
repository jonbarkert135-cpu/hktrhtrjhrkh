# Provider catalogue

Every external or local data source Raven may call, with its **credential class**, licence and
status. The machine-readable copy of this table lives in
`packages/transforms/src/catalog/providers.ts` and is validated against the same schema the
runtime uses; this document is the human-readable rationale. **They must stay in sync — the test
`catalog.contract.test.ts` fails if a provider exists in code but not here.**

## Credential classes (from the brief, §17)

| Class | Meaning                                                                                  |
| ----- | ---------------------------------------------------------------------------------------- |
| **A** | Free / open / local. Runs on the analyst's machine or a public endpoint with no account. |
| **B** | Public API, free, but a registration/token is required.                                  |
| **C** | Free tier of a commercial service: works without paying, with quotas that will run out.  |
| **D** | Paid only.                                                                               |
| **E** | External only. Raven can link out or open the source; no integration.                    |
| **F** | Unsupported. Technically, legally or ethically out of scope.                             |

**Rule (brief §18): "no API key" never means "free".** A source is class A only when its own
documentation says an anonymous endpoint exists. Where a limit below is marked _(unconfirmed)_, the
number was not found in official documentation during this pass and must be verified before the
transform that depends on it is enabled by default.

**Last verified: 2026-08-19** unless a row says otherwise.

## A — Free / open / local

| Provider              | Capability                      | Licence / terms                      | Notes                                                                                                                                                                                             |
| --------------------- | ------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sherlock              | username → public profiles      | MIT                                  | v0.16.0 (2025-09-16), actively maintained, 280+ contributors [GitHub]                                                                                                                             |
| subfinder             | domain → subdomains (passive)   | MIT                                  | ProjectDiscovery; some of its own sources need keys, Raven runs it keyless by default                                                                                                             |
| OWASP Amass           | domain → infrastructure         | Apache-2.0                           | Heavier than subfinder; "deep" execution class only                                                                                                                                               |
| theHarvester          | domain → emails/hosts           | GPL-2.0 _(unconfirmed)_              | Verify licence and per-source keys before bundling                                                                                                                                                |
| SpiderFoot            | broad automated recon           | MIT _(maintenance unconfirmed)_      | Already specced in `12_SPIDERFOOT.md`; check upstream activity before Core status                                                                                                                 |
| DNS over HTTPS        | domain → DNS records            | Public endpoints (Google/Cloudflare) | `dns.google/resolve` JSON API, RFC 8484 endpoints; no key [Google Public DNS docs]                                                                                                                |
| RDAP (IANA bootstrap) | domain/IP/ASN → registration    | Open protocol, RFC 9224              | Replaced WHOIS for gTLDs on 2025-01-28 [ICANN announcement]                                                                                                                                       |
| crt.sh                | domain → certificates           | Public service, courtesy use         | No key; unmetered but unofficial — Raven throttles and falls back to CT Search                                                                                                                    |
| Wayback CDX           | URL → archived snapshots        | Internet Archive terms               | Public CDX server; heavy use should be throttled                                                                                                                                                  |
| Common Crawl index    | URL/domain → crawl records      | Open data                            | CDXJ index free to query or download [commoncrawl.org]                                                                                                                                            |
| Wikidata SPARQL       | entity enrichment               | CC0 data                             | User-Agent policy applies                                                                                                                                                                         |
| Nominatim (OSM)       | place → coordinates             | ODbL, strict usage policy            | Max 1 req/s, identifying User-Agent, attribution required; policy forbids generic embedding in no-code platforms — Raven's use is a deliberate developer choice and stays within it [OSMF policy] |
| mempool.space         | bitcoin address/tx              | Public API                           | Self-hostable; preferred over key-gated chain APIs                                                                                                                                                |
| Local file analysis   | file → metadata, hashes         | own code / permissive libs           | Always local, always available, no network permission                                                                                                                                             |
| Git clone + analysis  | repository → structure, history | own code                             | Local alternative to the GitHub API when a repo is public and cloning is acceptable                                                                                                               |

## B — Public API, free, token required

| Provider            | Capability                 | Free limits                                                                                    | Notes                                                          |
| ------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| VirusTotal          | file/URL/domain reputation | Public API: 500 requests/day, 4/minute [VT docs]                                               | Free key; commercial use requires premium                      |
| AbuseIPDB           | IP abuse reports           | Free plan, daily check quota _(exact number unconfirmed)_                                      | Vendor states free plans will remain available [AbuseIPDB FAQ] |
| GreyNoise Community | IP noise classification    | Unauthenticated 10 lookups/day; free key 50 lookups/week, business email only [GreyNoise docs] | Very small budget — treat as a spot-check, never bulk          |
| AlienVault OTX      | indicators, pulses         | Free key _(limits unconfirmed)_                                                                |                                                                |
| urlscan.io          | URL scans and search       | Unauthenticated "minor quotas"; per-action minute/hour/day limits with a key [urlscan docs]    | Respect `X-Rate-Limit-*` headers                               |
| SSLMate CT Search   | domain → certificates      | Free: 100 single-hostname queries/hour, 10 full-domain/hour [sslmate.com]                      | Structured alternative to crt.sh                               |
| IPinfo Lite         | IP → ASN/country           | Free tier with key                                                                             | Lightweight geo/ASN enrichment                                 |
| Etherscan           | ethereum address/tx        | Free key tier _(exact limits unconfirmed)_                                                     | Per-chain explorers behave similarly                           |
| GitHub REST         | repos, users, code         | 60 req/h unauthenticated, 5,000 req/h with a token                                             | Already specced in `11_GITHUB.md`                              |

## C — Free tier of a commercial service

| Provider         | Capability       | Free tier                                                                                             | Notes                                                   |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Shodan           | IP/host exposure | Free account gets an API key; search and filtered queries consume query credits [developer.shodan.io] | Host lookups are the usable free part                   |
| Censys Platform  | host/cert search | Censys Free: 100 credits/month, expiring monthly [Censys docs]                                        | Credit-metered; show remaining budget before running    |
| Blockchair       | multi-chain data | Free tier, key for higher limits _(limits unconfirmed)_                                               |                                                         |
| Brave Search API | web search       | $5 of credits per month on the free plan; credit card required to register [brave.com]                | Not credential-free: this is class C, not B             |
| OpenSanctions    | sanctions / PEP  | Free for non-commercial use, key required; businesses need a licence [opensanctions.org]              | Bulk dataset can be self-hosted → class A for local use |
| Hunter.io        | email discovery  | Small free tier _(limits unconfirmed)_                                                                | Low priority for Raven                                  |

## D — Paid only

| Provider          | Capability                    | Why it stays out of the default build                                                     |
| ----------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| Have I Been Pwned | email → breaches              | Email search requires a paid subscription key; only Pwned Passwords is free [HIBP API v3] |
| OpenCorporates    | company registry              | Self-serve plans start at £2,250/year [pricing analysis, 2026-02]                         |
| SecurityTrails    | historical DNS/WHOIS          | Paid tiers                                                                                |
| Pipl, BvD Orbis   | identity / company resolution | Enterprise contracts, distributed via Maltego's own hub                                   |
| Maltego Data      | metered third-party data      | Deliberately not a Raven backend (brief §47)                                              |

Class D providers may still be _declared_ in the registry so the UI can say "requires a paid
provider" and offer a free alternative — they are never enabled by default and never bundled.

## E — External only

Sources Raven links to instead of integrating: archive.today (no stable public API), most social
networks (platform terms prohibit automated collection), court and land registries with captchas or
per-jurisdiction paywalls, LinkedIn. The transform for these opens the source with a prefilled
query and records an evidence entry when the analyst pastes something back.

## F — Unsupported

Credential dumps and combolists, dark-web market scraping, services whose terms prohibit automated
access, anything requiring authentication bypass, and paid "people search" aggregators of unclear
provenance. This is a product decision, recorded here so it is not revisited by accident:
`RAVEN-SPEC/15_SECURITY.md` §9 is the governing rule.

## Maintenance rules

1. Every provider entry carries `lastVerified`. The ecosystem health check (Layer 4 phase L4.6)
   flags anything older than 180 days.
2. A provider that is archived, deprecated or whose API disappeared is marked `deprecated`, removed
   from recommendations, and given an `alternatives` list — historical results stay in the graph.
3. Never infer a limit. If official documentation does not state it, mark it _(unconfirmed)_ and
   let the runtime discover it through rate-limit headers.

## Registry ids

The id each provider carries in `packages/transforms/src/catalog/providers.ts`. Engines reference
these, never the display name.

| Id                      | Provider                                       | Class |
| ----------------------- | ---------------------------------------------- | ----- |
| `local-runtime`         | Raven local runtime (parsers, hashing, probes) | A     |
| `manual`                | Manual entry by the analyst                    | A     |
| `sherlock`              | Sherlock                                       | A     |
| `subfinder`             | ProjectDiscovery subfinder                     | A     |
| `amass`                 | OWASP Amass                                    | A     |
| `dns-google`            | Google Public DNS (DoH)                        | A     |
| `rdap`                  | RDAP via the IANA bootstrap                    | A     |
| `crtsh`                 | crt.sh                                         | A     |
| `wayback`               | Internet Archive Wayback CDX                   | A     |
| `common-crawl`          | Common Crawl CDXJ index                        | A     |
| `wikidata`              | Wikidata SPARQL                                | A     |
| `nominatim`             | OpenStreetMap Nominatim                        | A     |
| `mempool-space`         | mempool.space                                  | A     |
| `opensanctions-dataset` | OpenSanctions bulk dataset, self-hosted        | A     |
| `github`                | GitHub REST API                                | B     |
| `virustotal`            | VirusTotal public API                          | B     |
| `abuseipdb`             | AbuseIPDB                                      | B     |
| `greynoise`             | GreyNoise Community API                        | B     |
| `otx`                   | AlienVault OTX                                 | B     |
| `urlscan`               | urlscan.io                                     | B     |
| `sslmate`               | SSLMate CT Search                              | B     |
| `ipinfo`                | IPinfo Lite                                    | B     |
| `etherscan`             | Etherscan                                      | B     |
| `shodan`                | Shodan                                         | C     |
| `censys`                | Censys Platform                                | C     |
| `blockchair`            | Blockchair                                     | C     |
| `brave-search`          | Brave Search API                               | C     |
| `opensanctions`         | OpenSanctions API                              | C     |
| `hibp`                  | Have I Been Pwned                              | D     |
| `opencorporates`        | OpenCorporates                                 | D     |
| `external-source`       | External source opened in the browser          | E     |
