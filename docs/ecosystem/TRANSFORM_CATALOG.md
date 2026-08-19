# Transform catalogue

The transforms Raven ships or plans to ship, each mapped to a capability, the engines that can
satisfy it and the providers those engines call. The machine-readable copy lives in
`packages/transforms/src/catalog/transforms.ts`; `catalog.contract.test.ts` fails if the two drift.

**A transform is not an engine** (brief §4): the transform is the analyst-facing operation and
stays stable; the engine behind it is chosen at run time by the capability router
(`RAVEN-SPEC/21_TRANSFORM_SYSTEM.md` §5) and may change without changing the graph.

## Columns

- **Priority** — `core` / `recommended` / `optional` / `experimental` / `external` / `deprecated`
  (brief §21).
- **Class** — the _best_ credential class among its engines (A–F, see `PROVIDER_CATALOG.md`). A
  transform is usable in Zero-Credential Mode only if it has an A-class engine.
- **Cost** — execution class: `fast` (local, sub-second), `standard` (one network round trip),
  `deep` (expensive/long), `optional` (low-priority enrichment) — brief §12.

## Identity & people

| Transform                  | In → Out                           | Capability            | Engines (in fallback order)                     | Priority    | Class | Cost     |
| -------------------------- | ---------------------------------- | --------------------- | ----------------------------------------------- | ----------- | ----- | -------- |
| `username-to-profiles`     | username → profile, url            | `profile-discovery`   | sherlock (local) → manual                       | core        | A     | deep     |
| `username-to-repositories` | username → repo                    | `repo-discovery`      | github-api → git-clone                          | core        | B     | standard |
| `email-to-breaches`        | email → breach                     | `breach-exposure`     | hibp (paid) → external link                     | optional    | D     | standard |
| `person-to-sanctions`      | person, organization → sanction    | `sanctions-screening` | opensanctions-api → opensanctions-local-dataset | optional    | C     | standard |
| `entity-to-knowledge-base` | person, organization, place → fact | `kb-enrichment`       | wikidata-sparql                                 | recommended | A     | standard |

## Infrastructure

| Transform                | In → Out                            | Capability              | Engines                                  | Priority    | Class | Cost     |
| ------------------------ | ----------------------------------- | ----------------------- | ---------------------------------------- | ----------- | ----- | -------- |
| `domain-to-dns`          | domain, hostname → dns_record, ip   | `dns-discovery`         | doh-resolver → system-resolver           | core        | A     | fast     |
| `domain-to-subdomains`   | domain → hostname                   | `subdomain-discovery`   | ct-log-search → subfinder → amass (deep) | core        | A     | deep     |
| `domain-to-certificates` | domain → certificate, hostname      | `certificate-discovery` | crtsh → sslmate-ct → local-tls-probe     | core        | A     | standard |
| `domain-to-registration` | domain → registration, organization | `registration-lookup`   | rdap → external whois link               | core        | A     | fast     |
| `ip-to-registration`     | ip, asn → registration, asn         | `registration-lookup`   | rdap                                     | core        | A     | fast     |
| `ip-to-reputation`       | ip → reputation                     | `ip-reputation`         | abuseipdb → greynoise-community → otx    | recommended | B     | standard |
| `ip-to-exposure`         | ip → service                        | `host-exposure`         | shodan-host → censys-host                | recommended | C     | standard |
| `ip-to-network-context`  | ip → asn, place                     | `ip-geolocation`        | ipinfo-lite → rdap                       | recommended | B     | fast     |

## Web & content

| Transform                  | In → Out                                    | Capability       | Engines                             | Priority     | Class | Cost     |
| -------------------------- | ------------------------------------------- | ---------------- | ----------------------------------- | ------------ | ----- | -------- |
| `url-to-archive-snapshots` | url, domain → snapshot                      | `archive-lookup` | wayback-cdx → common-crawl-index    | core         | A     | standard |
| `url-to-scan`              | url → scan, ip, domain                      | `url-scan`       | urlscan-io                          | recommended  | B     | deep     |
| `selector-to-web-mentions` | username, email, domain, organization → url | `web-mentions`   | brave-search → external search link | recommended  | C     | standard |
| `url-to-page-capture`      | url → file, note                            | `page-capture`   | local-fetch (sandboxed)             | experimental | A     | standard |

## Files & artefacts

| Transform            | In → Out                               | Capability        | Engines               | Priority    | Class | Cost     |
| -------------------- | -------------------------------------- | ----------------- | --------------------- | ----------- | ----- | -------- |
| `file-to-metadata`   | file → metadata, person, place, device | `file-metadata`   | local-metadata-parser | core        | A     | fast     |
| `file-to-hashes`     | file → hash                            | `file-hashing`    | local-hasher          | core        | A     | fast     |
| `hash-to-reputation` | hash → verdict                         | `file-reputation` | virustotal            | recommended | B     | standard |

## Repositories

| Transform                    | In → Out                                     | Capability       | Engines                | Priority    | Class | Cost     |
| ---------------------------- | -------------------------------------------- | ---------------- | ---------------------- | ----------- | ----- | -------- |
| `repository-to-analysis`     | repo → language, dependency, person, release | `repo-analysis`  | github-api → git-clone | core        | B     | deep     |
| `repository-to-contributors` | repo → person, username                      | `repo-analysis`  | github-api → git-clone | recommended | B     | standard |
| `repository-to-related`      | repo → repo                                  | `repo-discovery` | github-api             | optional    | B     | standard |

## Financial / public records

| Transform                    | In → Out                                     | Capability       | Engines                                | Priority | Class | Cost     |
| ---------------------------- | -------------------------------------------- | ---------------- | -------------------------------------- | -------- | ----- | -------- |
| `crypto-address-to-activity` | crypto_address → transaction, crypto_address | `chain-activity` | mempool-space → blockchair → etherscan | optional | A     | standard |
| `organization-to-registry`   | organization → company                       | `company-lookup` | opencorporates (paid) → external link  | external | D     | standard |
| `place-to-coordinates`       | place → coordinates                          | `geocode`        | nominatim (1 req/s)                    | optional | A     | standard |

## Rules that apply to every entry

1. **Manual is always the last fallback.** Every capability ends in either an external link or a
   "record what you found by hand" step, so the chain never dead-ends in an error (brief §20).
2. **No mock results, ever.** A transform with no available engine reports
   `requires-configuration` or `unavailable`, never a fabricated entity (brief §100).
3. **Deep transforms need a budget.** Anything in the `deep` class must declare
   `expectedRuntimeMs` and `maxResults`, and the planner shows both in the expand preview.
4. **Every produced entity carries provenance**: transform id, engine id, provider id, source URL,
   observation time and confidence (`RAVEN-SPEC/10_INTEGRATIONS.md` §8.5).
5. **Priority is a decision, not a wish.** `core` transforms must ship with the transform runtime;
   `optional`/`experimental` ones may ship disabled; `external` ones never execute inside Raven.
