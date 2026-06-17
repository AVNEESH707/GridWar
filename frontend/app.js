/**
 * GridWar — Frontend Client
 *
 * Connects to the Node.js/WebSocket backend.
 * On load it fetches the full grid state via REST, then
 * subscribes to real-time diffs via WebSocket.
 */

const GRID_COLS   = 40;
const GRID_ROWS   = 30;
const TOTAL_CELLS = GRID_COLS * GRID_ROWS;
const COOLDOWN_MS = 800;

const PLAYER_COLORS = [
  '#a78bfa','#60a5fa','#34d399','#f87171','#fbbf24',
  '#e879f9','#38bdf8','#4ade80','#fb923c','#f472b6',
  '#818cf8','#2dd4bf','#facc15','#f43f5e','#22d3ee',
  '#c084fc','#86efac','#fca5a5','#93c5fd','#6ee7b7',
];

// ── State ─────────────────────────────────────────────────────────────────────
let myId    = sessionStorage.getItem('gridwar-id')   || genId();
let myName  = sessionStorage.getItem('gridwar-name') || '';
let myColor = sessionStorage.getItem('gridwar-color')|| '';

let gridData    = {};   // { cellIndex: { id, name, color, ts } }
let activityLog = [];
let lastClick   = 0;
let ws          = null;

sessionStorage.setItem('gridwar-id', myId);

// ── Utils ─────────────────────────────────────────────────────────────────────
function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function hashColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return PLAYER_COLORS[Math.abs(h) % PLAYER_COLORS.length];
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function showModal() {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('name-input').value = myName || '';
  setTimeout(() => document.getElementById('name-input').focus(), 50);
}

function submitName() {
  const val = document.getElementById('name-input').value.trim();
  if (!val) return;
  myName  = val.slice(0, 18);
  myColor = hashColor(myId);
  sessionStorage.setItem('gridwar-name',  myName);
  sessionStorage.setItem('gridwar-color', myColor);
  document.getElementById('modal-overlay').style.display = 'none';
  updateUserBar();
  if (!ws) connectWS();
}

document.getElementById('name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitName();
});

// ── Grid DOM ──────────────────────────────────────────────────────────────────
function buildGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (let i = 0; i < TOTAL_CELLS; i++) {
    const cell = document.createElement('div');
    cell.className  = 'cell';
    cell.dataset.idx = i;
    cell.addEventListener('click', () => handleClaim(i));
    grid.appendChild(cell);
  }
}

function applyCell(idx, info) {
  const cell = document.getElementById('grid').children[idx];
  if (!cell) return;
  if (info) {
    cell.style.background = info.color;
    cell.classList.add('owned');
    cell.title = info.name;
    cell.classList.toggle('mine', info.id === myId);
  } else {
    cell.style.background = '';
    cell.classList.remove('owned', 'mine');
    cell.title = '';
  }
}

function renderAllCells() {
  for (let i = 0; i < TOTAL_CELLS; i++) {
    applyCell(i, gridData[i] || null);
  }
  updateStats();
}

// ── Claim ─────────────────────────────────────────────────────────────────────
function handleClaim(idx) {
  if (!myName) { showModal(); return; }

  const now = Date.now();
  if (now - lastClick < COOLDOWN_MS) {
    const wait = ((COOLDOWN_MS - (now - lastClick)) / 1000).toFixed(1);
    showToast(`Cooldown — wait ${wait}s`);
    return;
  }
  if (gridData[idx] && gridData[idx].id === myId) {
    showToast('Already yours!'); return;
  }
  lastClick = now;

  // Optimistic update
  const prev = gridData[idx];
  gridData[idx] = { id: myId, name: myName, color: myColor, ts: now };
  applyCell(idx, gridData[idx]);
  animateCell(idx);
  updateStats();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'claim', idx, id: myId, name: myName, color: myColor }));
  } else {
    // Fallback: REST claim
    fetch('https://gridwar-iprl.onrender.com/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idx, id: myId, name: myName, color: myColor }),
    }).then(r => r.json()).then(res => {
      if (!res.ok) {
        // Roll back optimistic update
        gridData[idx] = prev || undefined;
        if (!prev) delete gridData[idx];
        applyCell(idx, prev || null);
        showToast(res.error || 'Claim failed');
      }
    }).catch(() => showToast('Network error'));
  }
}

function animateCell(idx) {
  const cell = document.getElementById('grid').children[idx];
  if (!cell) return;
  cell.classList.add('just-claimed');
  setTimeout(() => cell.classList.remove('just-claimed'), 400);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
 ws = new WebSocket('wss://gridwar-iprl.onrender.com');

  ws.onopen = () => {
    console.log('[WS] connected');
    ws.send(JSON.stringify({ type: 'hello', id: myId, name: myName, color: myColor }));
    fetchFullState();
  };

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    handleServerMessage(msg);
  };

  ws.onclose = () => {
    console.log('[WS] disconnected — reconnecting in 2s');
    setTimeout(connectWS, 2000);
  };

  ws.onerror = (err) => {
    console.error('[WS] error', err);
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'full_state': {
      gridData = msg.grid;
      renderAllCells();
      renderLeaderboard();
      document.getElementById('stat-players').textContent = msg.playerCount || 1;
      break;
    }
    case 'cell_update': {
      const { idx, info } = msg;
      const prev = gridData[idx];
      if (info) gridData[idx] = info;
      else delete gridData[idx];
      applyCell(idx, info || null);
      updateStats();
      renderLeaderboard();

      if (info && info.id !== myId) {
        animateCell(idx);
        const logMsg = prev && prev.name !== info.name
          ? `${info.name} took from ${prev.name}`
          : `${info.name} claimed a tile`;
        pushLog(logMsg, info.color);
      }
      break;
    }
    case 'player_count': {
      document.getElementById('stat-players').textContent = msg.count;
      break;
    }
    case 'error': {
      // Server rejected our optimistic update — roll back handled by re-render
      showToast(msg.message || 'Action rejected');
      fetchFullState();
      break;
    }
  }
}

// ── REST Fallback ─────────────────────────────────────────────────────────────
function fetchFullState() {
  fetch('https://gridwar-iprl.onrender.com/api/grid')
    .then(r => r.json())
    .then(data => {
      gridData = data.grid;
      renderAllCells();
      renderLeaderboard();
      document.getElementById('stat-players').textContent = data.playerCount || 1;
    })
    .catch(console.error);
}

// ── UI Updates ────────────────────────────────────────────────────────────────
function updateStats() {
  const claimed = Object.keys(gridData).length;
  document.getElementById('stat-claimed').textContent = claimed;
  document.getElementById('stat-free').textContent   = TOTAL_CELLS - claimed;
}

function updateUserBar() {
  document.getElementById('username-display').textContent = myName;
  document.getElementById('user-dot').style.background   = myColor;
}

function renderLeaderboard() {
  const counts = {};
  for (const info of Object.values(gridData)) {
    if (!info) continue;
    counts[info.id] = counts[info.id] || { name: info.name, color: info.color, count: 0 };
    counts[info.id].count++;
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  const lb = document.getElementById('leaderboard');
  lb.innerHTML = '';
  sorted.forEach(([id, info], i) => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    if (id === myId) row.style.background = '#1e1e30';
    row.innerHTML = `
      <div class="lb-rank">${i + 1}</div>
      <div class="lb-dot" style="background:${info.color}"></div>
      <div class="lb-name" title="${info.name}">${info.name}</div>
      <div class="lb-count">${info.count}</div>
    `;
    lb.appendChild(row);
  });
}

function pushLog(msg, color) {
  activityLog.unshift({ msg, color });
  activityLog = activityLog.slice(0, 30);
  const act = document.getElementById('activity');
  act.innerHTML = activityLog
    .map(e => `<div class="log-entry"><span style="color:${e.color}">${e.msg}</span></div>`)
    .join('');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.showModal   = showModal;
window.submitName  = submitName;

buildGrid();

if (myName) {
  updateUserBar();
  connectWS();
} else {
  showModal();
}
