# PartyMaker

Plan parties, manage guest lists, and track RSVPs. PartyMaker is a small
full-stack TypeScript app:

- **`server/`** — an Express + SQLite (better-sqlite3) REST API.
- **`client/`** — a React + Vite single-page UI.

The repository is an npm-workspaces monorepo.

## Prerequisites

- Node.js 20+ (Node 22 recommended)
- A C toolchain (`gcc`/`g++`/`make`) so `better-sqlite3` can compile

## Getting started

```bash
npm install        # install all workspace dependencies
npm run dev        # run the API (port 4000) and the web UI (port 5173) together
```

Then open http://localhost:5173. The Vite dev server proxies `/api` requests
to the API on port 4000.

### Running the pieces individually

```bash
npm run dev:api    # Express API on http://localhost:4000
npm run dev:web    # Vite dev server on http://localhost:5173
```

## Useful scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run API + web together (development) |
| `npm run build` | Type-check and build both workspaces |
| `npm run typecheck` | Type-check both workspaces |
| `npm test` | Run the API test suite |

## API overview

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/parties` | List parties with guest summaries |
| `POST` | `/api/parties` | Create a party |
| `GET` | `/api/parties/:id` | Party detail + guest list |
| `DELETE` | `/api/parties/:id` | Delete a party |
| `POST` | `/api/parties/:id/guests` | Add a guest |
| `PATCH` | `/api/guests/:id` | Update a guest's RSVP |
| `DELETE` | `/api/guests/:id` | Remove a guest |

## Configuration

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | `4000` | API server |
| `PARTYMAKER_DB` | `server/data/partymaker.db` | API server (SQLite file path) |
| `VITE_API_TARGET` | `http://localhost:4000` | Vite dev proxy |
