# GridWar 🗺️

A real-time shared grid where anyone who opens the site can claim tiles — and everyone sees it happen instantly.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
# → http://localhost:3000

# For development with auto-reload:
npm run dev
```

Open `http://localhost:3000` in multiple browser tabs to test multi-user behaviour.

---

## Project Structure

```
gridwar/
├── frontend/
│   ├── index.html     # UI shell
│   ├── style.css      # Dark-mode grid styles
│   └── app.js         # WebSocket client + grid logic
├── backend/
│   └── server.js      # Express + WebSocket server
├── package.json
└── README.md
```

---

## Architecture

### Real-time Layer — WebSocket (ws library)

Every browser connects via a persistent WebSocket. When a player claims a tile:

1. The client sends a `claim` message over WebSocket
2. The server validates it (cooldown, bounds check, ownership)
3. If valid, the server updates its in-memory grid and **broadcasts a `cell_update` diff to every connected client**
4. Each client applies the diff instantly — no polling, no full reload

Diffs are tiny (one cell at a time), keeping bandwidth minimal even with hundreds of players.

### Conflict Resolution

- The **server is the single source of truth** — it arbitrates all claims
- Clients do an **optimistic update** (paint the cell immediately) for snappy UX
- If the server rejects the claim (e.g. someone else got there first during the same millisecond), it sends back an `error` message and the client re-syncs
- Cooldown is enforced **server-side** to prevent abuse, not just in the UI

### REST Fallback

If WebSocket is unavailable, `POST /api/claim` handles claims via HTTP. The server's `processClaim()` function is shared between both paths.

### State Management

| Layer | Storage | Notes |
|---|---|---|
| Runtime | In-memory JS object | O(1) reads/writes, zero latency |
| Persistence (optional) | Redis | Survives server restarts; see comments in `server.js` |

The grid is a flat `{ [cellIndex]: { id, name, color, ts } }` object. With 40×30 = 1,200 cells and ~100 bytes per owned cell, the full grid is < 120 KB.

---

## WebSocket Message Protocol

### Client → Server
| Message | Fields | Description |
|---|---|---|
| `hello` | `id, name, color` | Register on connect; server replies with full state |
| `claim` | `idx, id, name, color` | Claim cell at index `idx` |

### Server → Client
| Message | Fields | Description |
|---|---|---|
| `full_state` | `grid, playerCount` | Sent once on connect |
| `cell_update` | `idx, info` | Broadcast on every successful claim |
| `player_count` | `count` | Broadcast when players join/leave |
| `error` | `message` | Sent to requester when claim is rejected |

---

## Features

- **40×30 grid** — 1,200 claimable tiles
- **Real-time sync** — all clients see updates via WebSocket broadcast
- **Cooldown system** — 800ms server-side cooldown per player (prevents spamming)
- **Conflict-safe** — server arbitrates simultaneous claims
- **Optimistic UI** — instant local feedback, rolls back on rejection
- **Live leaderboard** — top 10 players by tiles owned
- **Activity log** — shows recent claims/takeovers
- **Player count** — live active player count
- **Reconnect logic** — auto-reconnects if WebSocket drops

---

## Scaling Notes

For production with many concurrent users:

- **Redis pub/sub** — replace in-memory broadcast with Redis channels so multiple server instances stay in sync
- **Sticky sessions** or Redis-backed session storage for player state
- **Rate limiting** — add `express-rate-limit` on the REST endpoint
- **Cell locking** — use Redis `SET NX` (atomic set-if-not-exists) for stricter conflict resolution under high contention

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Server | Node.js + Express | Async I/O fits high-concurrency WebSocket workload |
| Real-time | `ws` library | Lightweight, battle-tested, no protocol overhead |
| Frontend | Vanilla JS | No build step; direct DOM for grid performance |
| State | In-memory object | Zero-latency; Redis hook provided for persistence |
| Styling | Custom CSS | Full control over grid cell animations + dark theme |
