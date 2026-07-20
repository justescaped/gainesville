// hooks.js — inbound Node-RED → Hub endpoints.
// Every endpoint requires the shared token in the X-Prism-Token header
// (Settings → Inbound token, default "prism"). Every request is logged to the
// Node-RED diagnostics panel, including rejected ones.
const express = require('express');
const router = express.Router();
const { getSetting, activeSession, resolveTeam, logNodeRed } = require('../db');
const actions = require('../actions');
const { pushBanner } = require('../state');

router.use((req, res, next) => {
  const ok = req.get('X-Prism-Token') === getSetting('inbound_token');
  logNodeRed('in', req.path.replace(/^\//, ''), req.originalUrl, req.body, ok ? 'accepted' : '401 bad token');
  if (!ok) return res.status(401).json({ error: 'invalid or missing X-Prism-Token header' });
  next();
});

function handle(fn) {
  return (req, res) => {
    try { res.json({ ok: true, ...(fn(req) || {}) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  };
}

// POST /api/hook/chroma  { team, amount, reason, minigame_id }
router.post('/chroma', handle((req) => {
  const session = activeSession();
  if (!session) throw new Error('no active session');
  const team = resolveTeam(session.id, req.body.team);
  if (!team) throw new Error(`unknown team: ${req.body.team}`);
  const entry = actions.writeChroma({
    sessionId: session.id, teamId: team.id, amount: req.body.amount,
    source: 'nodered', reason: req.body.reason || 'Node-RED',
    minigameId: req.body.minigame_id || null
  });
  return { entry_id: entry.id };
}));

// POST /api/hook/territory  { territory_id, owner }
router.post('/territory', handle((req) => {
  const { territory_id, owner } = req.body;
  if (!['red', 'blue', 'green', 'yellow', 'none'].includes(owner)) throw new Error(`invalid owner: ${owner}`);
  actions.setTerritoryOwner(territory_id, owner);
}));

// POST /api/hook/minigame/start  { minigame_id, mode }
router.post('/minigame/start', handle((req) => {
  return actions.startMinigame(req.app.locals.timer, req.body.minigame_id, req.body.mode || null);
}));

// POST /api/hook/minigame/end  { minigame_id }
router.post('/minigame/end', handle((req) => {
  actions.endMinigame(req.app.locals.timer, req.app.locals.onEndGuard);
}));

// POST /api/hook/timer  { action, seconds }   action: start|pause|reset|add
router.post('/timer', handle((req) => {
  actions.timerAction(req.app.locals.timer, req.body.action, req.body.seconds);
}));

// POST /api/hook/banner  { text, duration }
router.post('/banner', handle((req) => {
  if (!req.body.text) throw new Error('text is required');
  pushBanner(req.body.text, req.body.duration || 8);
}));

// ---------- Phase 3: Color Grid RFID input ----------
// row/col are zero-indexed from the TOP-LEFT as players face the shelves.
// See docs/COLOR_GRID.md for the addressing diagram before wiring a Pi.
const gridEngine = require('../grid');

// POST /api/hook/grid/placement  { row, col, color, tag_id, team }
router.post('/grid/placement', handle((req) => {
  gridEngine.recordPlacement({
    row: req.body.row, col: req.body.col, color: req.body.color,
    tagId: req.body.tag_id || null, teamRef: req.body.team ?? null
  });
}));

// POST /api/hook/grid/state  { cells: [[...]] } — full shelf resync
router.post('/grid/state', handle((req) => {
  gridEngine.setFullState(req.body.cells);
}));

// POST /api/hook/grid/score  {} — force immediate scoring
router.post('/grid/score', handle(() => gridEngine.score('nodered_score')));

module.exports = router;
