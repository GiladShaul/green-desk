import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DOCS_HTML);
});

const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Green Desk API Documentation</title>
  <style>
    :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --green: #4ade80; --code-bg: #0f172a; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; padding: 2rem 1rem; }
    .container { max-width: 860px; margin: 0 auto; }
    h1 { font-size: 2rem; font-weight: 700; color: var(--green); margin-bottom: 0.25rem; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; }
    h2 { font-size: 1.3rem; font-weight: 600; color: var(--green); margin: 2rem 0 0.75rem; }
    h3 { font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
    p { color: var(--muted); margin-bottom: 0.75rem; }
    ul, ol { color: var(--muted); padding-left: 1.5rem; margin-bottom: 0.75rem; }
    li { margin-bottom: 0.3rem; }
    code { background: var(--code-bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.15rem 0.4rem; font-size: 0.85rem; font-family: "Fira Code", "Consolas", monospace; color: #f8fafc; }
    pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 1rem 1.25rem; margin: 0.75rem 0; overflow-x: auto; }
    pre code { border: none; padding: 0; background: none; font-size: 0.875rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; }
    .endpoint { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.5rem; }
    .method { font-weight: 700; font-size: 0.85rem; padding: 0.2rem 0.5rem; border-radius: 4px; font-family: monospace; }
    .method.get  { background: #1d4ed8; color: #fff; }
    .method.post { background: #15803d; color: #fff; }
    .method.delete { background: #b91c1c; color: #fff; }
    .path { font-family: monospace; font-size: 0.95rem; color: #f8fafc; }
    .scope-badge { background: #4a044e; color: #f0abfc; font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 10px; margin-left: 0.5rem; }
    table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.875rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); color: var(--muted); font-weight: 600; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); color: var(--text); }
    .required { color: #f87171; font-size: 0.75rem; margin-left: 0.25rem; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
  </style>
</head>
<body>
<div class="container">
  <h1>Green Desk API</h1>
  <p class="subtitle">REST API for programmatic integration with Green Desk. Version: v1</p>

  <h2>Authentication</h2>
  <div class="card">
    <p>All API v1 requests require an API key passed in the <code>Authorization</code> header:</p>
    <pre><code>Authorization: Bearer gd_a1b2c3d4e5f6...</code></pre>
    <p>API keys are prefixed with <code>gd_</code> followed by 32 hex characters. You can create and manage API keys from the Admin panel under <strong>API Keys</strong>.</p>
    <p>The full key is shown <strong>once</strong> at creation time. Store it securely — it cannot be retrieved again.</p>
  </div>

  <h2>Base URL</h2>
  <pre><code>https://your-greendesk-instance.com/api/v1</code></pre>

  <h2>Rate Limiting</h2>
  <div class="card">
    <p>Each API key is limited to <strong>100 requests per minute</strong>. Exceeding this limit returns:</p>
    <pre><code>HTTP 429 Too Many Requests
{ "error": "Rate limit exceeded (100 req/min)", "code": "RATE_LIMIT_EXCEEDED" }</code></pre>
  </div>

  <h2>Scopes</h2>
  <div class="card">
    <p>API keys are scoped to specific capabilities. Assign only the scopes your integration needs.</p>
    <table>
      <thead><tr><th>Scope</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td><code>read:bookings</code></td><td>List and view bookings</td></tr>
        <tr><td><code>write:bookings</code></td><td>Create and cancel bookings</td></tr>
        <tr><td><code>read:floors</code></td><td>List floor plans</td></tr>
        <tr><td><code>read:desks</code></td><td>List desks</td></tr>
        <tr><td><code>read:rooms</code></td><td>List meeting rooms</td></tr>
        <tr><td><code>read:analytics</code></td><td>Utilization analytics</td></tr>
        <tr><td><code>read:users</code></td><td>List users in the tenant</td></tr>
      </tbody>
    </table>
  </div>

  <h2>Pagination</h2>
  <p>Paginated endpoints accept <code>page</code> (default: 1) and <code>pageSize</code> (default: 50, max: 200) query parameters and return:</p>
  <pre><code>{ "data": [...], "total": 123, "page": 1, "pageSize": 50 }</code></pre>

  <h2>Error Responses</h2>
  <p>All errors follow a consistent shape:</p>
  <pre><code>{ "error": "Human-readable message", "code": "MACHINE_CODE", "details": {} }</code></pre>
  <table>
    <thead><tr><th>HTTP Status</th><th>Code</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td>400</td><td><code>VALIDATION_ERROR</code></td><td>Invalid request parameters</td></tr>
      <tr><td>401</td><td><code>UNAUTHORIZED</code></td><td>Missing or malformed API key</td></tr>
      <tr><td>401</td><td><code>INVALID_API_KEY</code></td><td>Key not found or hash mismatch</td></tr>
      <tr><td>401</td><td><code>REVOKED_API_KEY</code></td><td>Key has been revoked</td></tr>
      <tr><td>401</td><td><code>EXPIRED_API_KEY</code></td><td>Key has passed its expiry date</td></tr>
      <tr><td>403</td><td><code>INSUFFICIENT_SCOPE</code></td><td>Key lacks the required scope</td></tr>
      <tr><td>404</td><td><code>NOT_FOUND</code></td><td>Resource not found</td></tr>
      <tr><td>409</td><td><code>CONFLICT</code></td><td>Conflicting state (e.g. double booking)</td></tr>
      <tr><td>429</td><td><code>RATE_LIMIT_EXCEEDED</code></td><td>Too many requests</td></tr>
      <tr><td>500</td><td>—</td><td>Internal server error</td></tr>
    </tbody>
  </table>

  <hr />

  <h2>Endpoints</h2>

  <h3>Bookings</h3>

  <div class="card">
    <div class="endpoint">
      <span class="method get">GET</span>
      <span class="path">/api/v1/bookings</span>
      <span class="scope-badge">read:bookings</span>
    </div>
    <p>List bookings for the tenant. Supports filtering and pagination.</p>
    <table>
      <thead><tr><th>Query param</th><th>Type</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td><code>date</code></td><td>string</td><td>Filter by date (YYYY-MM-DD)</td></tr>
        <tr><td><code>floorId</code></td><td>UUID</td><td>Filter by floor</td></tr>
        <tr><td><code>page</code></td><td>integer</td><td>Page number (default: 1)</td></tr>
        <tr><td><code>pageSize</code></td><td>integer</td><td>Items per page (default: 50, max: 200)</td></tr>
      </tbody>
    </table>
    <pre><code>GET /api/v1/bookings?date=2025-03-15&floorId=uuid&page=1&pageSize=50
Authorization: Bearer gd_...

200 OK
{
  "data": [
    {
      "id": "uuid",
      "desk_id": "uuid",
      "user_id": "uuid",
      "date": "2025-03-15",
      "start_time": "09:00",
      "end_time": "17:00",
      "status": "confirmed",
      "created_at": "2025-03-10T12:00:00Z",
      "desk_label": "A-01",
      "floor_id": "uuid",
      "floor_name": "Floor 2"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 50
}</code></pre>
  </div>

  <div class="card">
    <div class="endpoint">
      <span class="method post">POST</span>
      <span class="path">/api/v1/bookings</span>
      <span class="scope-badge">write:bookings</span>
    </div>
    <p>Create a booking. Conflict detection prevents double-booking.</p>
    <pre><code>POST /api/v1/bookings
Authorization: Bearer gd_...
Content-Type: application/json

{
  "desk_id": "uuid",
  "user_id": "uuid",
  "date": "2025-03-15",
  "start_time": "09:00",
  "end_time": "17:00"
}

201 Created
{ "id": "uuid", "desk_id": "uuid", "user_id": "uuid", "date": "2025-03-15", ... }</code></pre>
  </div>

  <div class="card">
    <div class="endpoint">
      <span class="method delete">DELETE</span>
      <span class="path">/api/v1/bookings/:id</span>
      <span class="scope-badge">write:bookings</span>
    </div>
    <p>Cancel a booking.</p>
    <pre><code>DELETE /api/v1/bookings/uuid
Authorization: Bearer gd_...

204 No Content</code></pre>
  </div>

  <h3>Floors</h3>

  <div class="card">
    <div class="endpoint">
      <span class="method get">GET</span>
      <span class="path">/api/v1/floors</span>
      <span class="scope-badge">read:floors</span>
    </div>
    <p>List all floors for the tenant.</p>
    <pre><code>GET /api/v1/floors
Authorization: Bearer gd_...

200 OK
{
  "data": [
    { "id": "uuid", "name": "Floor 2", "building": "HQ", "floor_number": 2, "created_at": "..." }
  ]
}</code></pre>
  </div>

  <h3>Desks</h3>

  <div class="card">
    <div class="endpoint">
      <span class="method get">GET</span>
      <span class="path">/api/v1/desks</span>
      <span class="scope-badge">read:desks</span>
    </div>
    <p>List desks. Filter by floor with the <code>floorId</code> query param.</p>
    <pre><code>GET /api/v1/desks?floorId=uuid
Authorization: Bearer gd_...

200 OK
{
  "data": [
    { "id": "uuid", "label": "A-01", "floor_id": "uuid", "floor_name": "Floor 2", "status": "active" }
  ]
}</code></pre>
  </div>

  <h3>Rooms</h3>

  <div class="card">
    <div class="endpoint">
      <span class="method get">GET</span>
      <span class="path">/api/v1/rooms</span>
      <span class="scope-badge">read:rooms</span>
    </div>
    <p>List meeting rooms. Filter by floor with <code>floorId</code>.</p>
    <pre><code>200 OK
{ "data": [{ "id": "uuid", "name": "Boardroom A", "floor_id": "uuid", "capacity": 10, "amenities": ["projector"] }] }</code></pre>
  </div>

  <h3>Analytics</h3>

  <div class="card">
    <div class="endpoint">
      <span class="method get">GET</span>
      <span class="path">/api/v1/analytics</span>
      <span class="scope-badge">read:analytics</span>
    </div>
    <p>Utilization analytics for the last 7, 30, or 90 days.</p>
    <pre><code>GET /api/v1/analytics?days=30
Authorization: Bearer gd_...

200 OK
{
  "days": 30,
  "totalBookings": 420,
  "avgDailyBookings": 14.0,
  "utilizationRate": 58.3,
  "bookingsByFloor": [
    { "floorName": "Floor 2", "bookings": 220, "activeDesks": 20 }
  ]
}</code></pre>
  </div>

  <h3>Users</h3>

  <div class="card">
    <div class="endpoint">
      <span class="method get">GET</span>
      <span class="path">/api/v1/users</span>
      <span class="scope-badge">read:users</span>
    </div>
    <p>List all users in the tenant.</p>
    <pre><code>200 OK
{ "data": [{ "id": "uuid", "email": "alice@example.com", "name": "Alice", "role": "admin", "created_at": "..." }] }</code></pre>
  </div>

  <hr />

  <h2>Key Management (Admin Only)</h2>
  <p>These endpoints require a valid JWT session with admin role, not an API key.</p>

  <div class="card">
    <div class="endpoint"><span class="method post">POST</span><span class="path">/api/admin/api-keys</span></div>
    <p>Create a new API key. The full key value is returned <strong>once</strong> in the response.</p>
    <pre><code>{ "name": "HRIS Integration", "scopes": ["read:bookings", "read:users"], "expires_at": "2026-01-01T00:00:00Z" }</code></pre>
  </div>

  <div class="card">
    <div class="endpoint"><span class="method get">GET</span><span class="path">/api/admin/api-keys</span></div>
    <p>List all API keys for the tenant. Returns prefix, name, scopes, last_used_at, status.</p>
  </div>

  <div class="card">
    <div class="endpoint"><span class="method delete">DELETE</span><span class="path">/api/admin/api-keys/:id</span></div>
    <p>Revoke an API key. Revocation is permanent and immediate.</p>
  </div>

  <hr />
  <p style="text-align:center; color: var(--muted); font-size: 0.8rem;">Green Desk API &bull; Need help? Contact your system administrator.</p>
</div>
</body>
</html>`;

export default router;
