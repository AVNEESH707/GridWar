# GridWar 🗺️

A real-time multiplayer territory-capture game where players compete to claim tiles on a shared grid. Every action is synchronized instantly across all connected users using WebSockets.

## Live Demo

**Frontend:** https://grid-war-beta.vercel.app

**Backend API:** https://gridwar-iprl.onrender.com

---

## Features

* Real-time tile claiming using WebSockets
* 40×30 grid (1,200 claimable tiles)
* Live leaderboard
* Activity feed with ownership updates
* Active player count
* Optimistic UI updates
* Automatic WebSocket reconnection
* Server-side cooldown protection
* Conflict-safe claim processing
* REST API fallback support

---

## Tech Stack

| Layer                   | Technology                    |
| ----------------------- | ----------------------------- |
| Frontend                | HTML, CSS, Vanilla JavaScript |
| Backend                 | Node.js, Express              |
| Real-time Communication | WebSocket (`ws`)              |
| Deployment              | Vercel + Render               |
| State Management        | In-memory object store        |

---

## Project Structure

```text
gridwar/
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── backend/
│   └── server.js
├── package.json
└── README.md
```

---

## Local Setup

```bash
# Install dependencies
npm install

# Start server
npm start

# Development mode
npm run dev
```

Open:

http://localhost:3000

in multiple browser tabs to simulate multiple players.

---

## Architecture

### Real-Time Synchronization

Each client establishes a persistent WebSocket connection with the server.

Claim flow:

1. Player clicks a tile
2. Client sends a `claim` event
3. Server validates ownership and cooldown
4. Server updates grid state
5. Server broadcasts a `cell_update` message
6. All connected clients update instantly

This diff-based approach minimizes bandwidth usage and keeps updates extremely fast.

### Conflict Resolution

The server acts as the single source of truth.

* Optimistic client updates for responsiveness
* Server-side validation
* Automatic rollback on rejected claims
* Cooldown enforcement to prevent spam

### REST Fallback

If WebSocket communication is unavailable, tile claims are processed through REST endpoints.

---

## WebSocket Protocol

### Client → Server

| Message | Purpose         |
| ------- | --------------- |
| hello   | Register player |
| claim   | Claim a tile    |

### Server → Client

| Message      | Purpose               |
| ------------ | --------------------- |
| full_state   | Send current grid     |
| cell_update  | Broadcast tile update |
| player_count | Active player count   |
| error        | Claim rejection       |

---

## Scaling Considerations

For larger deployments:

* Redis Pub/Sub for multi-instance synchronization
* Redis persistence for server recovery
* Rate limiting on public endpoints
* Horizontal scaling with load balancing
* Distributed cell-locking mechanisms

---

## Deployment

Frontend deployed on Vercel.

Backend deployed on Render.

The application supports real-time communication over secure WebSockets (WSS) in production.

---

## Future Improvements

* User authentication
* Persistent player profiles
* Tile history tracking
* Global chat system
* Team-based territory wars
* Database persistence
* Mobile-first UI enhancements
