# Trello Dev Infrastructure

One private Dev stack: React/Nginx, Node.js API, PostgreSQL, and Redis. MinIO is an optional `media` profile for the later attachments milestone. Next.js and the admin interface remain later roadmap work.

Place the frontend, backend, and infrastructure repositories beside each other. On the Dev VPS, use a dedicated account with Docker access. Inspect existing ports before starting services.

## Configure

Copy `.env.example` to `.env`. Replace the password and JWT placeholders with independent random values (hex values avoid URL escaping in `DATABASE_URL`). Do not commit `.env`. The API uses the newer authentication reference: short-lived bearer JWTs in browser memory, rotating opaque refresh cookies, and CSRF checks. This supersedes the earlier opaque-session proposal in the MVP plan.

The default browser origin is `http://localhost:8080` through SSH. For this loopback-only tunnel setup, `COOKIE_SECURE=false`; public HTTPS deployments must use secure cookies and their exact origin. Database, Redis, API, and mailbox are not published to public ports. Set `RELEASE_TAG` to the checked-out release candidate; built images and application containers carry that version.

## Build and Run on Dev

Follow the project release workflow: tag the release candidate before building a release. Build services sequentially on the 1 GB VPS:

```sh
make config
make services
make build
make dev
make health
```

Do not create a stable tag or Prod deployment automatically. `make stop` preserves data. Do not use `docker compose down -v` unless you intend to erase the database and other named volumes.

From the Mac, keep this tunnel open:

```sh
ssh -N -L 8080:127.0.0.1:8080 trello-vps-dev
```

Open http://localhost:8080. If that Mac port is occupied, choose another local port and set `APP_ORIGIN` to match before restarting the API. The server port is controlled by `HTTP_PORT`.

## Development Password Recovery

Reset links are delivered to files in the API's private `/app/dev-mail` volume. Inspect these through SSH/Docker as the server operator, not a public HTTP endpoint. Use throwaway learning accounts. Raw passwords are never delivered or logged.

## Tests and Storage

Backend integration tests require a separate PostgreSQL database through `TEST_DATABASE_URL`; never point tests at the application database. Redis is used for authentication rate limits and revocation. Tests use uniquely named records in that disposable database and clean up temporary mailbox files.

After starting the stack, run `node scripts/smoke.mjs http://localhost:8080` with Node 24 to verify the compiled frontend, Nginx proxy, and API journey together. This creates a disposable learning account and workspace in the application database; it does not delete existing records.

Named volumes preserve PostgreSQL data, Redis state, Dev reset mail, and optional MinIO objects across service replacement. Keep the database and media volumes when updating code.

Enable MinIO only when implementing attachments, after setting a strong `MINIO_ROOT_PASSWORD` and selecting a reviewed image tag through `MINIO_IMAGE`. It consumes additional memory. Its console is loopback-only; API integration and bucket authorization belong to that future milestone.

## Temporary Acceptance Preview

The initial implementation was tested using source-mounted containers named `trello-api-check` and `trello-web-check`, with the same private PostgreSQL/Redis services. These are temporary checks, not tagged release images. If they are running, stop them before starting the Compose application on the same port:

```sh
docker stop trello-web-check trello-api-check
```

They remove themselves when stopped. Database volumes remain intact. Before promoting a release candidate, finish interactive browser acceptance of the board UI. Backend integration, API-client, proxy smoke, frontend compilation, and database restart checks passed during initial Dev validation.
