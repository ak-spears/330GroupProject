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

Open **http://localhost:5286/** (or the URL printed in the terminal). The API hosts files from `../frontend`, so `fetch('/api/health')` in `app.js` matches the same origin.

- Health check: `GET /api/health` → `{ "status": "ok" }`

## Run the frontend alone (optional)

If you open `frontend/index.html` via `file://` or a static server **without** this API, relative `fetch('/api/health')` will not reach the server. Prefer `cd api && dotnet run`, or use a dev proxy / full URL to the API port.

## Database

1. Create a MySQL database and user.
2. Apply `database/schema.sql` when tables exist.
3. **Recommended:** put your MySQL URL in a **repo root** `.env` file as `Connection_String=...` (see `.gitignore`). When you `cd api && dotnet run`, the host loads that file and maps it to `ConnectionStrings:Default` for `MySqlConnectionFactory` and raw SQL. Alternatively set `ConnectionStrings:Default` in user secrets or environment variables; avoid committing real passwords.

## Project layout

- `frontend/` — `index.html`, `styles.css`, `app.js`
- `api/` — ASP.NET Core Web API (`TrailBuddy.Api`, run with `dotnet run`)
- `database/` — SQL scripts
