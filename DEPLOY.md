# Green Desk — Deployment Guide

This guide covers deploying Green Desk via Docker Compose. You need [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed.

## Quick start

```bash
# 1. Clone the repo
git clone <repo-url>
cd green-desk

# 2. Create your environment file
cp .env.example .env

# 3. Edit .env — set required values (see below)
# At minimum: POSTGRES_PASSWORD and JWT_SECRET

# 4. Build and start all services
docker-compose up --build -d

# 5. Verify the deployment
curl http://localhost/api/health
# → {"status":"ok"}
```

The app is now available at **http://localhost**.

---

## Environment variables

Copy `.env.example` to `.env` and fill in the values before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_PASSWORD` | **yes** | — | Password for the PostgreSQL database |
| `JWT_SECRET` | **yes** | — | Secret used to sign auth tokens — use a long random string |
| `DATABASE_URL` | no | auto-set by compose | PostgreSQL connection string |
| `JWT_EXPIRES_IN` | no | `7d` | How long access tokens are valid |
| `SMTP_HOST` | no | — | SMTP server for outgoing email (omit to log emails to console) |
| `SMTP_PORT` | no | `587` | SMTP port |
| `SMTP_USER` | no | — | SMTP username |
| `SMTP_PASS` | no | — | SMTP password |
| `EMAIL_FROM` | no | `Green Desk <noreply@greendesk.local>` | Sender address for emails |
| `CORS_ORIGIN` | no | — | Allowed cross-origin for the API (not needed when using the bundled nginx) |
| `PORT` | no | `80` | Host port to expose the web frontend on |
| `NODE_ENV` | no | `production` | Node environment |

### Generate a JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Database migrations

Migrations run automatically when the API container starts — no manual step needed. They are applied in filename order and are idempotent (already-applied migrations are skipped).

To run migrations manually (e.g. after updating the schema):

```bash
docker-compose exec api node dist/migrate.js
```

---

## Service overview

| Service | Internal port | External port |
|---|---|---|
| `web` (nginx + React) | 80 | `${PORT:-80}` |
| `api` (Node.js) | 3001 | not exposed externally |
| `db` (PostgreSQL 16) | 5432 | not exposed externally |

The `web` nginx container proxies all `/api/*` requests to the `api` service, so the browser only ever talks to one origin.

---

## Common operations

### View logs

```bash
docker-compose logs -f          # all services
docker-compose logs -f api      # API only
docker-compose logs -f web      # web/nginx only
```

### Stop and restart

```bash
docker-compose down             # stop containers (data preserved)
docker-compose up -d            # restart
docker-compose down -v          # stop and delete database volume (data lost)
```

### Rebuild after code changes

```bash
docker-compose up --build -d
```

---

## Health check

```bash
curl http://localhost/api/health
# → {"status":"ok"}
```

A `200 OK` with `{"status":"ok"}` confirms the API is running and reachable.

---

## Troubleshooting

**API fails to start with "DATABASE_URL not set" or connection error**
- Confirm `POSTGRES_PASSWORD` is set in `.env` and the `db` container is healthy:
  ```bash
  docker-compose ps
  docker-compose logs db
  ```

**Port 80 already in use**
- Set `PORT=8080` (or any free port) in `.env` and restart.

**Migration fails on first boot**
- Check `docker-compose logs api` for the error message. If it's a connectivity issue the API will exit — run `docker-compose up -d` again once the database is healthy.
