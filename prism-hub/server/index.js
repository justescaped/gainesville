// index.js — Prism Dilemma Hub entry point.
// One process, one port. Serves the API, the Socket.IO stream, the uploaded
// images, and the built front end (Admin / Stage / Player are all routes of
// the same SPA). `npm start` runs this file.
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { db, activeSession, getSetting, setSetting } = require('./db');
const { createTimer, fireNodeRed, getManifest } = require('./core');
const state = require('./state');
const quizEngine = require('./quiz');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '2mb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
state.setIO(io);

// ---------- server-authoritative timer ----------
// Broadcast at ~10Hz while running; clients only render what they receive.
let onEndFiredForActive = false; // prevents double-firing the per-minigame on_end webhook
const timer = createTimer(
  (snap) => io.emit('timer', snap),
  () => {
    // Timer expired: fire the active minigame's on_end webhook. Stage flashes
    // the timer red via the `expired` flag in the snapshot. Audio is out of scope.
    const session = activeSession();
    const manifest = session && session.active_minigame_id ? getManifest(session.active_minigame_id) : null;
    fireNodeRed('timer_expired', {
      minigame_id: session ? session.active_minigame_id : null,
      session_id: session ? session.id : null
    });
    if (manifest) {
      fireNodeRed('minigame_end', { minigame_id: manifest.id, cause: 'timer_expired' }, manifest.nodered?.on_end);
      onEndFiredForActive = true;
    }
    quizEngine.onTimerExpired(); // ends a running quiz naturally
  }
);

// ---------- physical button input pipeline ----------
// The Stage page forwards RAW event.code values from the USB button box over
// Socket.IO. Mapping (Settings → Input), debounce, and meaning all live HERE —
// the Stage never decides anything. Admin fallback buttons enter through the
// same pressAction() so behavior is identical.
quizEngine.setEmitter((snap) => io.emit('quiz', snap));

const inputState = { learnArm: null, recent: [], lastPress: {} };

function pressAction(action) {
  const now = Date.now();
  if (now - (inputState.lastPress[action] || 0) < 200) return; // server-side debounce
  inputState.lastPress[action] = now;
  quizEngine.input(action);
}

function handleRawCode(code) {
  const now = Date.now();
  let map;
  try { map = JSON.parse(getSetting('button_map')); } catch { map = {}; }

  // Learn mode: the next physical press binds to the armed action.
  if (inputState.learnArm) {
    map[inputState.learnArm] = code;
    setSetting('button_map', JSON.stringify(map));
    io.emit('input_learned', { action: inputState.learnArm, code, map });
    inputState.learnArm = null;
    inputState.recent.unshift({ code, ts: now, action: '(learned)' });
    inputState.recent = inputState.recent.slice(0, 10);
    io.emit('input_code', inputState.recent[0]);
    return;
  }

  const action = Object.keys(map).find((k) => map[k] === code) || null;
  inputState.recent.unshift({ code, ts: now, action });
  inputState.recent = inputState.recent.slice(0, 10);
  io.emit('input_code', inputState.recent[0]); // Test panel feed
  if (action) pressAction(action);
}

// Routes get access to the timer, the double-fire guard, and the input pipeline.
app.locals.timer = timer;
app.locals.onEndGuard = {
  fired: () => onEndFiredForActive,
  set: (v) => { onEndFiredForActive = v; }
};
app.locals.input = { state: inputState, pressAction };

// ---------- API routes ----------
app.use('/api/hook', require('./routes/hooks')); // inbound Node-RED (token-gated)
app.use('/api', require('./routes/quizapi'));    // Phase 2: question banks + quiz control + input
app.use('/api', require('./routes/api'));        // admin API

// ---------- static: uploads + built front end ----------
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

const DIST = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA fallback so /admin, /stage, /player all resolve to the app
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.send('Front end not built yet. Run: npm run build'));
}

// ---------- sockets ----------
io.on('connection', (socket) => {
  // Every new screen gets the full picture immediately.
  socket.emit('state', state.buildState());
  socket.emit('timer', timer.snapshot());
  socket.emit('quiz', quizEngine.snapshot());
  // Raw keystrokes from the Stage machine's USB button box.
  socket.on('raw_button', (d) => {
    if (d && typeof d.code === 'string' && d.code.length > 0 && d.code.length <= 40) handleRawCode(d.code);
  });
});

server.listen(PORT, () => {
  console.log(`Prism Dilemma Hub listening on http://0.0.0.0:${PORT}`);
  console.log(`  Admin:  http://localhost:${PORT}/admin`);
  console.log(`  Stage:  http://localhost:${PORT}/stage`);
  console.log(`  Player: http://localhost:${PORT}/player`);
});
