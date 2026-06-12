# Observability

## API Structured Logging (Pino)

The API uses [Pino](https://getpino.io/) for structured JSON logging.

**Log format** — every log line is a JSON object:
```json
{"level":30,"time":1716300000000,"pid":1234,"msg":"API server running on http://localhost:3001"}
```

**Request logging** — every HTTP request is logged via `pino-http` with method, URL, status code, and response time.

**Log level** — set via the `LOG_LEVEL` env var (default: `info`).

| Level | Value | Usage |
|-------|-------|-------|
| `trace` | 10 | Very verbose |
| `debug` | 20 | Dev debugging |
| `info`  | 30 | Normal operations (default) |
| `warn`  | 40 | Degraded state |
| `error` | 50 | Errors with stack traces |

### Pretty-printing in development

```bash
npm run dev -w packages/api | npx pino-pretty
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Minimum log level |

---

## Frontend Error Tracking (Sentry)

Sentry is **optional** and activates only when `VITE_SENTRY_DSN` is set.

When enabled:
- The app root is wrapped in a Sentry error boundary
- Unhandled React errors are reported to your Sentry project
- Production builds include source maps for readable stack traces

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SENTRY_DSN` | No | Sentry DSN from your project settings. Omit to disable Sentry entirely. |

### Enabling Sentry

1. Create a project at [sentry.io](https://sentry.io).
2. Copy the DSN from **Project Settings → Client Keys**.
3. Add it to your frontend `.env`:
   ```
   VITE_SENTRY_DSN=https://your-dsn@sentry.io/project-id
   ```
4. Rebuild the frontend — source maps will be included automatically.
