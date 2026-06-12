# Green Desk — Fly.io Deployment Guide

This guide covers deploying Green Desk to [Fly.io](https://fly.io) with two separate apps (API + Web) and a managed PostgreSQL database.

## Architecture

```
Internet
  └─► green-desk-web (nginx, public, HTTPS)
        └─► green-desk-api.internal:3001 (private network)
              └─► Fly Postgres (private network)
```

The web app is public-facing. The API is only reachable via Fly.io's private network — the web nginx proxy forwards `/api/*` to it. The database is never exposed externally.

---

## Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated (`flyctl auth login`)
- A Fly.io account (free tier works for staging; paid for production)
- The repo cloned locally

---

## 1. Create the Fly.io apps

Run these once from the repo root. The `--no-deploy` flag creates the app config without deploying yet.

```bash
# Create API app
flyctl launch --config fly.api.toml --no-deploy

# Create web app
flyctl launch --config fly.web.toml --no-deploy
```

If you want different app names, update the `app` field in both `fly.*.toml` files **and** update `API_HOST` in `fly.web.toml` to match.

---

## 2. Provision the database

### Option A: Fly Postgres (recommended)

```bash
# Create a Fly Postgres cluster (single node for staging, HA for production)
flyctl postgres create --name green-desk-db --region iad --vm-size shared-cpu-1x --volume-size 10

# Attach it to the API app (sets DATABASE_URL secret automatically)
flyctl postgres attach green-desk-db --app green-desk-api
```

> The `attach` command sets `DATABASE_URL` as a Fly secret on `green-desk-api` automatically.

### Option B: Neon (serverless Postgres)

If you prefer serverless Postgres:

1. Create a project at [neon.tech](https://neon.tech)
2. Copy the connection string
3. Set it as a secret (see Step 3 below)

---

## 2b. Provision Redis (optional, recommended for production)

Redis is used for rate-limit state sharing across multiple API instances and for caching hot reads (floor lists, desk layouts, tenant plan limits). The API degrades gracefully without it — all features work, just without shared rate-limiting or caching.

```bash
# Create an Upstash Redis instance on Fly.io
flyctl redis create --name green-desk-redis --region iad

# Get the private URL and set it as a secret
flyctl secrets set REDIS_URL="$(flyctl redis status green-desk-redis --json | python -c 'import sys,json; print(json.load(sys.stdin)["privateUrl"])')" --app green-desk-api
```

> Upstash Redis is billed per request — no idle cost. The private URL keeps traffic on Fly's internal network.

After deployment, the `/ready` endpoint reports Redis status:
```bash
curl https://green-desk-api.fly.dev/ready
# With Redis:    {"status":"ready","redis":"ok"}
# Without Redis: {"status":"ready","redis":"unavailable"}
```

---

## 3. Set secrets

Secrets are encrypted at rest and injected as environment variables. **Never commit secrets to source control.**

```bash
# Required
flyctl secrets set \
  JWT_SECRET="$(openssl rand -hex 48)" \
  --app green-desk-api

# If using Neon instead of Fly Postgres:
# flyctl secrets set DATABASE_URL="postgresql://..." --app green-desk-api

# Stripe (if billing is enabled)
flyctl secrets set \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  STRIPE_STARTER_PRICE_ID="price_..." \
  STRIPE_PRO_PRICE_ID="price_..." \
  APP_URL="https://app.greendesk.example.com" \
  --app green-desk-api

# Email / SMTP (optional — omit to log emails to console)
flyctl secrets set \
  SMTP_HOST="smtp.sendgrid.net" \
  SMTP_PORT="587" \
  SMTP_USER="apikey" \
  SMTP_PASS="SG...." \
  EMAIL_FROM="Green Desk <noreply@greendesk.example.com>" \
  --app green-desk-api
```

Verify secrets are set (values hidden):
```bash
flyctl secrets list --app green-desk-api
```

---

## 4. First deployment

```bash
# Deploy API first (runs DB migrations via release_command)
flyctl deploy --config fly.api.toml --remote-only

# Deploy Web
flyctl deploy --config fly.web.toml --remote-only
```

The API's `release_command = 'node dist/migrate.js'` runs all pending database migrations **before** any new API instances start taking traffic — safe for zero-downtime deploys.

Verify the API is healthy:
```bash
flyctl status --app green-desk-api
curl https://green-desk-api.fly.dev/health
# → {"status":"ok"}

# Readiness check (verifies DB connectivity)
curl https://green-desk-api.fly.dev/ready
# → {"status":"ready"}
```

Verify the web frontend:
```bash
flyctl status --app green-desk-web
curl https://green-desk-web.fly.dev
# → 200 OK (React app HTML)

# API proxy through web app
curl https://green-desk-web.fly.dev/api/health
# → {"status":"ok"}
```

---

## 5. CI/CD — GitHub Actions

The `deploy` job in `.github/workflows/ci.yml` automatically deploys to Fly.io on every push to `main` **after all tests pass**.

### Set up the GitHub secret

1. Generate a Fly.io deploy token:
   ```bash
   flyctl tokens create deploy --name "github-actions"
   ```
2. In your GitHub repo → **Settings → Secrets and variables → Actions**, add:
   - Name: `FLY_API_TOKEN`
   - Value: the token from step 1

After that, every `git push origin main` triggers:
1. Unit tests + integration tests
2. E2E Playwright tests
3. Deploy API to Fly.io (with DB migrations)
4. Deploy Web to Fly.io

---

## 6. Custom domain setup

### 6a. Add a certificate for your domain

```bash
# For the web app (the user-facing domain)
flyctl certs add app.greendesk.example.com --app green-desk-web

# Check certificate status
flyctl certs show app.greendesk.example.com --app green-desk-web
```

Fly.io provisions a TLS certificate via Let's Encrypt automatically.

### 6b. Configure DNS

Fly.io gives you two options for DNS:

**Option 1: CNAME (simplest, works for most)**

Add a CNAME record in your DNS provider:
```
Type:  CNAME
Name:  app          (or @ for apex)
Value: green-desk-web.fly.dev
TTL:   300
```

> Note: CNAME on apex (`@`) is not supported by all DNS providers. Use ALIAS/ANAME if your provider supports it, or use the A/AAAA option below.

**Option 2: A + AAAA records (apex domain)**

Get the Fly.io IP addresses:
```bash
flyctl ips list --app green-desk-web
```

Add records:
```
Type:  A
Name:  @
Value: <IPv4 from flyctl ips list>

Type:  AAAA
Name:  @
Value: <IPv6 from flyctl ips list>
```

### 6c. Update APP_URL secret

Once DNS is propagated and the cert is issued, update the app URL secret:
```bash
flyctl secrets set APP_URL="https://app.greendesk.example.com" --app green-desk-api
```

### 6d. Update CORS if needed

If your API is accessed from a different domain:
```bash
flyctl secrets set CORS_ORIGIN="https://app.greendesk.example.com" --app green-desk-api
```

---

## 7. Scaling

```bash
# Scale to 2 instances (HA)
flyctl scale count 2 --app green-desk-api
flyctl scale count 2 --app green-desk-web

# Scale up VM size
flyctl scale vm shared-cpu-2x --app green-desk-api
```

---

## 8. Common operations

```bash
# View live logs
flyctl logs --app green-desk-api
flyctl logs --app green-desk-web

# SSH into a running machine
flyctl ssh console --app green-desk-api

# Run migrations manually
flyctl ssh console --app green-desk-api -C "node dist/migrate.js"

# List secrets
flyctl secrets list --app green-desk-api

# Restart all machines
flyctl machines restart --app green-desk-api
```

---

## Environment variables reference

| Variable | Where | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | API | **yes** | PostgreSQL connection string |
| `JWT_SECRET` | API | **yes** | JWT signing secret (generate with `openssl rand -hex 48`) |
| `JWT_EXPIRES_IN` | API | no | Token lifetime (default: `7d`) |
| `STRIPE_SECRET_KEY` | API | for billing | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | API | for billing | Stripe webhook signing secret |
| `STRIPE_STARTER_PRICE_ID` | API | for billing | Stripe price ID for Starter plan |
| `STRIPE_PRO_PRICE_ID` | API | for billing | Stripe price ID for Pro plan |
| `APP_URL` | API | for billing | Public URL (used for Stripe redirects) |
| `SMTP_HOST` | API | no | SMTP server (omit to log emails to console) |
| `SMTP_PORT` | API | no | SMTP port (default: `587`) |
| `SMTP_USER` | API | no | SMTP username |
| `SMTP_PASS` | API | no | SMTP password |
| `EMAIL_FROM` | API | no | Sender address |
| `CORS_ORIGIN` | API | no | Allowed CORS origin |
| `REDIS_URL` | API | no | Upstash Redis private URL — enables Redis rate-limiting and caching |
| `API_HOST` | Web | auto | Set in `fly.web.toml` — points nginx to API via private network |
| `FLY_API_TOKEN` | GitHub | **yes** | GitHub Actions deploy token |
