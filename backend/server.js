/**
 * GridWar — Backend Server
 *
 * Stack: Node.js, Express, ws (WebSocket library)
 * Optional: Redis for persistence (falls back to in-memory)
 *
 * Endpoints:
 *   GET  /api/grid          → full grid state snapshot
 *   POST /api/claim         → REST fallback for claiming a cell
 *
 * WebSocket messages (client → server):
 *   { type: "hello",  id, name, color }   → register player
 *   { type: "claim",  idx, id, name, color } → claim a cell
 *
 * WebSocket messages (server → client):
 *   { type: "full_state", grid, playerCount } → sent on connect
 *   { type: "cell_update", idx, info }         → broadcast on every claim
 *   { type: "player_count", count }            → broadcast when players join/leave
 *   { type: "error", message }                 → sent to requester on conflict
 */

const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const path       = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const GRID_COLS   = 40;
const GRID_ROWS   = 30;
const TOTAL_CELLS = GRID_COLS * GRID_ROWS;
const COOLDOWN_MS = 800;  // per-player server-side cooldown

// ── In-memory State ───────────────────────────────────────────────────────────
/**
 * grid: { [cellIndex]: { id, name, color, ts } }
 * players: { [playerId]: { name, color, lastClaim: timestamp, ws } }
 */
const grid    = {};
const players = {};

// ── Express App ───────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Full grid snapshot (REST fallback / initial load)
app.get('/api/grid', (req, res) => {
  res.json({
    grid,
    playerCount: countActivePlayers(),
    cols: GRID_COLS,
    rows: GRID_ROWS,
  });
});

// REST claim (used when WebSocket is unavailable)
app.post('/api/claim', (req, res) => {
  const { idx, id, name, color } = req.body;
  const result = processClaim(idx, id, name, color, null);
  res.json(result);
});

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] new connection from ${ip}`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return; }

    switch (msg.type) {
      case 'hello': {
        const { id, name, color } = msg;
        if (!id || !name) return;
        players[id] = { id, name, color: color || '#a78bfa', lastClaim: 0, ws };
        ws._playerId = id;

        // Send full state to the new player
        ws.send(JSON.stringify({
          type: 'full_state',
          grid,
          playerCount: countActivePlayers(),
        }));

        // Broadcast updated player count
        broadcast({ type: 'player_count', count: countActivePlayers() });
        console.log(`[WS] player joined: ${name} (${id})`);
        break;
      }

      case 'claim': {
        const { idx, id, name, color } = msg;
        const result = processClaim(idx, id, name, color, ws);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'error', message: result.error }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const id = ws._playerId;
    if (id && players[id]) {
      console.log(`[WS] player left: ${players[id].name}`);
      delete players[id];
      broadcast({ type: 'player_count', count: countActivePlayers() });
    }
  });

  ws.on('error', (err) => console.error('[WS] socket error:', err.message));
});

// ── Core Claim Logic ──────────────────────────────────────────────────────────
/**
 * processClaim — validate and apply a cell claim.
 * Handles cooldown enforcement, conflict detection, and broadcasting.
 *
 * @param {number} idx      - cell index (0..TOTAL_CELLS-1)
 * @param {string} id       - player id
 * @param {string} name     - player display name
 * @param {string} color    - player hex color
 * @param {object|null} ws  - WebSocket connection (null for REST)
 * @returns {{ ok: boolean, error?: string }}
 */
function processClaim(idx, id, name, color, ws) {
  // Validate index
  if (idx < 0 || idx >= TOTAL_CELLS || !Number.isInteger(Number(idx))) {
    return { ok: false, error: 'Invalid cell index' };
  }
  idx = Number(idx);

  // Validate identity
  if (!id || !name) return { ok: false, error: 'Missing player info' };

  // Cooldown check
  const player = players[id];
  if (player) {
    const elapsed = Date.now() - player.lastClaim;
    if (elapsed < COOLDOWN_MS) {
      const wait = ((COOLDOWN_MS - elapsed) / 1000).toFixed(1);
      return { ok: false, error: `Cooldown active — wait ${wait}s` };
    }
    player.lastClaim = Date.now();
  } else {
    // Player not registered via WS (REST fallback) — register minimally
    players[id] = { id, name, color, lastClaim: Date.now(), ws: null };
  }

  // Already own it?
  if (grid[idx] && grid[idx].id === id) {
    return { ok: false, error: 'Already yours' };
  }

  // Apply the claim
  const info = { id, name, color, ts: Date.now() };
  grid[idx] = info;

  // Broadcast to everyone
  broadcast({ type: 'cell_update', idx, info });

  return { ok: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function countActivePlayers() {
  // Count WS-connected players
  let count = 0;
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) count++; });
  return count;
}

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`GridWar running at http://localhost:${PORT}`);
});

// ── Optional Redis Persistence ────────────────────────────────────────────────
// Uncomment and install `ioredis` to persist grid across restarts.
//
// const Redis = require('ioredis');
// const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
//
// async function loadFromRedis() {
//   const raw = await redis.get('gridwar:grid');
//   if (raw) Object.assign(grid, JSON.parse(raw));
//   console.log('[Redis] loaded', Object.keys(grid).length, 'cells');
// }
//
// async function saveToRedis() {
//   await redis.set('gridwar:grid', JSON.stringify(grid));
// }
//
// // Save every 5 seconds
// setInterval(saveToRedis, 5000);
// loadFromRedis();
