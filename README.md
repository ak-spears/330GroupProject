# TrailBuddy

Skeleton full-stack app: vanilla **Bootstrap + JS** frontend, **ASP.NET Core Web API** in `api/`, and **MySQL** (schema in `database/schema.sql`). No ORMs — data access uses hand-written SQL via **MySqlConnector** in `api/Data/`.

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- MySQL (optional for this smoke test; required once you add real queries)

## Run the API (serves REST + static frontend)

From the repo root:

```bash
cd api
dotnet run
```

Open **http://localhost:5286/** (or the URL printed in the terminal). The API hosts files from `../frontend`, so `fetch('/api/...')` hits the same origin.

**Do not** open `frontend/index.html` via **File → Open** (`file://`) unless the API is already running: `app.js` will call **http://localhost:5286** for API routes in that case. If your API uses another host/port, set `window.TRAILBUDDY_API_BASE` in `index.html` before loading `app.js`.

- Health check: `GET /api/health` → `{ "status": "ok" }`
- Database check: `GET /api/health/database` → `{ "status": "ok", "database": true }` when `.env` `Connection_String` reaches MySQL (or503 with a message)

## Run the frontend alone (optional)

If you open `frontend/index.html` via `file://` or a static server **without** this API, relative `fetch('/api/health')` will not reach the server. Prefer `cd api && dotnet run`, or use a dev proxy / full URL to the API port.

## Database

1. Create a MySQL database and user.
2. Apply `database/schema.sql` when tables exist.
3. **Recommended:** put your MySQL URL in a **repo root** `.env` file as `Connection_String=...` (see `.gitignore`). The API loads the first file found among: `../.env` and `.env` next to the project folder, plus the same two relative to the process current directory (so it still works when the IDE sets cwd to the repo root). Values are merged into `Configuration` (not only environment variables). If the DB is unreachable, list endpoints return **503** JSON `{ "error": "database_unavailable", "message": "..." }` instead of a generic 500.

## Project layout

- `frontend/` — `index.html`, `styles.css`, `app.js`
- `api/` — ASP.NET Core Web API (`TrailBuddy.Api`, run with `dotnet run`)
- `database/` — SQL scripts
