# TrailBuddy

Skeleton full-stack app: vanilla **Bootstrap + JS** frontend, **ASP.NET Core Web API** backend, and **MySQL** (schema in `database/schema.sql`). No ORMs — data access will use hand-written SQL via **MySqlConnector** in `backend/Data/`.

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- MySQL (optional for this smoke test; required once you add real queries)

## Run the backend (serves API + static frontend)

From the repo root:

```bash
cd backend
dotnet run
```

Open **http://localhost:5286/** (or the URL printed in the terminal). The API hosts files from `../frontend`, so `fetch('/api/health')` in `app.js` matches the same origin.

- Health check: `GET /api/health` → `{ "status": "ok" }`

## Run the frontend alone (optional)

If you open `frontend/index.html` via `file://` or a static server **without** the backend, relative `fetch('/api/health')` will not reach the API. Prefer running `dotnet run` as above, or use a dev proxy / full URL to the API port.

## Database

1. Create a MySQL database and user.
2. Apply `database/schema.sql` when tables exist.
3. **Recommended:** put your MySQL URL in a **repo root** `.env` file as `Connection_String=...` (see `.gitignore`). On startup the API loads that file and maps it to `ConnectionStrings:Default` for `MySqlConnectionFactory` and raw SQL. Alternatively set `ConnectionStrings:Default` in user secrets or environment variables; avoid committing real passwords.

## Project layout

- `frontend/` — `index.html`, `styles.css`, `app.js`
- `backend/` — ASP.NET Core Web API (`TrailBuddy.Api`)
- `database/` — SQL scripts
