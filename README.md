# Trello Dev Infrastructure

One private Dev stack: React/Nginx with lazy-loaded administrator and session screens, Node.js API, PostgreSQL, and Redis, plus an optional statically exported Next.js landing page. MinIO is an optional `media` profile for the later attachments milestone. Application administration shares the private SPA endpoint at `/admin` and does not add a runtime service.

The frontend repository now also contains a standalone Next.js static landing page in `landing/`. Its optional Compose `landing` profile serves the exported HTML through Nginx at loopback port 8081, with a 32 MB runtime limit. Build sequentially after tagging the matching RC: `docker compose --profile landing build landing`, then `docker compose --profile landing up -d --no-deps landing`. Tunnel with `ssh -N -L 8081:127.0.0.1:8081 trello-vps-dev`. `LANDING_ORIGIN` and `APP_ORIGIN` are build-time values for this static page; keep them aligned with the browser's tunnel URLs. Public DNS/HTTPS and production routing remain separately gated.

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

## Application Administrator Setup

Application administrators manage accounts and metadata through `/admin`. They are separate from workspace owners and do not gain private board/card access through that role. Initial administrator access must be granted by the Dev server operator to an already registered account; public registration never accepts an administrator role:

```sh
docker compose exec -T api npm run admin:grant -- administrator@example.com
```

Use a dedicated Dev testing account. Sign in again after a role change, since existing sessions can be invalidated. User suspension, administrator changes, and workspace/board archive changes require confirmations and are audited. Keep at least one active application administrator. The admin route is served by the same private web endpoint; it does not require another frontend container.

After bootstrapping, run `scripts/admin-smoke.mjs` with `SMOKE_ADMIN_EMAIL` and `SMOKE_ADMIN_PASSWORD` supplied privately in the environment. With Node 24, `node scripts/admin-smoke.mjs http://localhost:8080` verifies admin authentication, counts, paginated metadata/audit, session metadata, and logout. It does not suspend accounts, change roles, or archive existing workspaces/boards. Avoid printing environment values or storing test credentials in Git. Run these checks only on Dev.

## Development Password Recovery

When `RESEND_API_KEY` and `MAIL_FROM` are configured in the private Dev environment, password resets use Resend's HTTPS API. Use a verified sending domain and a Sending access key scoped to that domain. Keep the key in server secrets, never in Git, frontend code, or Docker build arguments. Provider errors return the same generic reset response and are logged without credentials, recipient addresses, or reset tokens.

Without a Resend key, non-production reset links are delivered to the API's private `/app/dev-mail` volume. Inspect these through SSH/Docker as the operator, not a public HTTP endpoint. Tests use this private mailbox or a mocked HTTPS transport and never send real emails. Raw passwords are never delivered or logged.

Reset links use `APP_ORIGIN`. Dev currently uses `http://localhost:8080`, so open the SSH tunnel before following a link. A future approved public deployment must set its real HTTPS application origin. Adding password-reset delivery does not implement reminder scheduling, email invitations, or broadcasts.

## Tests and Storage

Backend integration tests require a separate PostgreSQL database through `TEST_DATABASE_URL`; never point tests at the application database. Redis is used for authentication rate limits and revocation. Tests use uniquely named records in that disposable database and clean up temporary mailbox files.

After starting the stack, run `node scripts/smoke.mjs http://localhost:8080` with Node 24 to verify the compiled frontend, Nginx proxy, and API journey together. This creates a disposable learning account and workspace in the application database; it does not delete existing records.

Named volumes preserve PostgreSQL data, Redis state, Dev reset mail, and optional MinIO objects across service replacement. Keep the database and media volumes when updating code.

Enable MinIO only when implementing attachments, after setting a strong `MINIO_ROOT_PASSWORD` and selecting a reviewed image tag through `MINIO_IMAGE`. It consumes additional memory. Its console is loopback-only; API integration and bucket authorization belong to that future milestone.

## Temporary Acceptance Preview

For source changes before a tagged release, run isolated verification on the existing Dev VPS:

```sh
TRELLO_VERIFY_ENV=dev \
BACKEND_DIR=/absolute/path/to/Trello-Clone-Backend \
FRONTEND_DIR=/absolute/path/to/Trello-Clone-Frontend \
sh scripts/verify-dev.sh
```

The script requires Docker access and Python 3 on the Dev host. It verifies that the existing network is available, creates a uniquely named disposable PostgreSQL database and private temporary Redis container, installs dependencies into temporary source copies, and runs backend integration tests, frontend tests, and compilation sequentially with memory limits. It reads the running Dev API's database connection privately; credentials are not printed. It removes its temporary database, Redis container, and workspace when finished. Do not run it on Prod. It does not replace browser acceptance, deploy a release, or recreate existing services/volumes. Input directories should be source snapshots without `node_modules` or build output to avoid copying unnecessary data.

The initial implementation was tested using source-mounted containers named `trello-api-check` and `trello-web-check`, with the same private PostgreSQL/Redis services. These are temporary checks, not tagged release images. If they are running, stop them before starting the Compose application on the same port:

```sh
docker stop trello-web-check trello-api-check
```

They remove themselves when stopped. Database volumes remain intact. Before promoting a release candidate, finish interactive browser acceptance of the board UI. Backend integration, API-client, proxy smoke, frontend compilation, and database restart checks passed during initial Dev validation.
