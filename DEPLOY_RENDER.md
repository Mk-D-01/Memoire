# Deploy the collaboration backend on Render

The backend is a long-running Node service with Socket.IO. Deploy `backend/` as a Render Web Service, or use the repository `render.yaml` blueprint.

## Required environment variables

```text
FRONTEND_ORIGIN=https://your-frontend.example.com
GOOGLE_CLIENT_ID=your-production-client-id
GOOGLE_CLIENT_SECRET=your-production-client-secret
DB_PATH=/var/data/memoire.db
SESSION_TTL_MS=2592000000
```

Attach a Render persistent disk at `/var/data`. Without the disk, SQLite and persisted login sessions are lost when Render restarts or redeploys. For higher-scale production, replace SQLite with a managed PostgreSQL database.

## Frontend connection

Set the API base before loading `collaborative.js`:

```html
<script>window.MEMOIRE_API_BASE = 'https://your-backend.onrender.com';</script>
```

The same HTTPS origin is used by Socket.IO for WebSocket upgrades. Add the exact frontend origin to `FRONTEND_ORIGIN`; comma-separated origins are supported for preview and production URLs.

## Verification

```text
GET https://your-backend.onrender.com/health
GET https://your-backend.onrender.com/ready
```

Then test sign-in, lobby creation, two browser windows, photo upload, caption editing, deletion, and a Render restart. A restart should preserve users, lobbies, photos, and sessions when the persistent disk is mounted.