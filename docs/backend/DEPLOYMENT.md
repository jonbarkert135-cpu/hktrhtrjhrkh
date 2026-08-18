# Deployment

## Local mode — static files

```bash
pnpm --filter @nexus/web build      # → apps/web/dist
```

Serve `apps/web/dist` with anything (Caddy, nginx, `python -m http.server`, GitHub Pages). No
environment variables are required; the defaults are local mode. Two rules:

- serve it over **HTTPS or localhost** — OPFS and IndexedDB behave differently in insecure contexts;
- route unknown paths to `index.html` (it is a single-page app).

Data lives in the browser profile that opened the page. Different browser, different data — that is
what local mode means.

## Server mode — one VPS, Docker Compose, no Kubernetes

```bash
cp .env.example .env      # APP_MODE=server, VITE_APP_MODE=server, secrets, PUBLIC_HOSTNAME
docker compose -f infra/docker-compose.yml up -d
```

Brings up Caddy (automatic TLS), the API, the built web bundle, Postgres, Redis, MinIO and the egress
proxy on a single machine. Deliberately **no Kubernetes, no privileged containers, no host network
mode** — a 2 vCPU box is enough to start, and the whole thing is one `docker compose down` away from
gone.

Images are built by CI (`.github/workflows/ci.yml`, jobs `docker (api)` / `docker (web)`) and pushed
to GHCR; `NEXUS_VERSION` selects the tag.

## CI and remote infrastructure

CI must never depend on infrastructure that only exists in a deployment. Postgres and Redis are
GitHub service containers inside the `unit` and `e2e` jobs; there is no shared staging database, no
cloud credentials in the workflow, and the local-mode acceptance suite runs in `unit` with no
services at all.
