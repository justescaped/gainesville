// api.js — the Admin surface's REST API. Everything here also broadcasts the
// fresh state snapshot over Socket.IO so Stage updates instantly.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();

const { db, getSetting, setSetting, activeSession, chromaForTeam } = require('../db');
const { allManifests, getManifest, saveManifest, fireNodeRed } = require('../core');
const { buildState, broadcastState, pushBanner } = require('../state');
const actions = require('../actions');

function handle(fn) {
  return (req, res) => {
    try {
      const out = fn(req);
      res.json(out === undefined ? { ok: true } : out);
    } catch (err) { res.status(400).json({ error: err.message }); }
  };
}

// ---------- auth (simple PIN gate; closed network) ----------
router.post('/auth', handle((req) => {
  if (String(req.body.pin) !== getSetting('admin_pin')) throw new Error('wrong PIN');
  return { ok: true };
}));

// ---------- state ----------
router.get('/state', (req, res) => res.json({ ...buildState(), timer: req.app.locals.timer.snapshot() }));

// ---------- sessions ----------
router.post('/sessions', handle((req) => {
  if (activeSession()) throw new Error('a session is already active — end it first');
  const mode = req.body.mode;
  if (!['gameshow', 'escaperoom'].includes(mode)) throw new Error('mode must be gameshow or escaperoom');

  const create = db.transaction(() => {
    const sid = db.prepare("INSERT INTO sessions (mode, status) VALUES (?, 'active')").run(mode).lastInsertRowid;
    const insTeam = db.prepare('INSERT INTO teams (session_id, color, name) VALUES (?, ?, ?)');
    if (mode === 'gameshow') {
      insTeam.run(sid, 'red', 'Team Red');
      insTeam.run(sid, 'blue', 'Team Blue');
      insTeam.run(sid, 'green', 'Team Green');
      insTeam.run(sid, 'yellow', 'Team Yellow');
    } else {
      insTeam.run(sid, 'solo', 'Team');
    }
    // New playthrough: the room starts drained. Reset all territories.
    db.prepare("UPDATE territories SET owner = 'none', locked = 0").run();
    return sid;
  });
  const sid = create();
  fireNodeRed('session_started', { session_id: sid, mode });
  broadcastState();
  return { session_id: sid };
}));

router.post('/sessions/end', handle((req) => {
  const session = activeSession();
  if (!session) throw new Error('no active session');
  const duration = Math.round((Date.now() - new Date(session.started_at + 'Z').getTime()) / 1000);
  const insHist = db.prepare('INSERT INTO run_history (session_id, mode, team_name, final_chroma, duration_seconds) VALUES (?, ?, ?, ?, ?)');
  for (const t of db.prepare('SELECT * FROM teams WHERE session_id = ?').all(session.id)) {
    insHist.run(session.id, session.mode, t.name, chromaForTeam(t.id), Math.max(0, duration));
  }
  db.prepare("UPDATE sessions SET status = 'complete', ended_at = datetime('now'), active_minigame_id = NULL, active_minigame_mode = NULL WHERE id = ?").run(session.id);
  req.app.locals.timer.load(0);
  fireNodeRed('session_ended', { session_id: session.id, mode: session.mode });
  broadcastState();
}));

router.post('/sessions/status', handle((req) => {
  const session = activeSession();
  if (!session) throw new Error('no active session');
  if (!['active', 'paused'].includes(req.body.status)) throw new Error('status must be active or paused');
  db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(req.body.status, session.id);
  broadcastState();
}));

router.post('/sessions/round', handle((req) => {
  const session = activeSession();
  if (!session) throw new Error('no active session');
  const round = Math.max(1, Math.trunc(Number(req.body.round)));
  db.prepare('UPDATE sessions SET current_round = ? WHERE id = ?').run(round, session.id);
  broadcastState();
}));

// ---------- teams ----------
router.put('/teams/:id', handle((req) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new Error('name is required');
  db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, req.params.id);
  broadcastState();
}));

// ---------- chroma ledger ----------
router.post('/chroma', handle((req) => {
  const session = activeSession();
  if (!session) throw new Error('no active session');
  const entry = actions.writeChroma({
    sessionId: session.id, teamId: req.body.team_id, amount: req.body.amount,
    source: 'manual', reason: req.body.reason || 'Manual adjustment',
    minigameId: session.active_minigame_id || null
  });
  return { entry_id: entry.id };
}));

router.get('/ledger', handle(() => {
  const session = activeSession();
  if (!session) return { entries: [] };
  return {
    entries: db.prepare(`
      SELECT cl.*, t.name AS team_name, t.color AS team_color
      FROM chroma_ledger cl JOIN teams t ON t.id = cl.team_id
      WHERE cl.session_id = ? ORDER BY cl.id DESC LIMIT 200`).all(session.id)
  };
}));

router.post('/ledger/:id/void', handle((req) => actions.setVoided(req.params.id, true)));
router.post('/ledger/:id/unvoid', handle((req) => actions.setVoided(req.params.id, false)));

// ---------- territories ----------
router.post('/territories', handle((req) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new Error('name is required');
  const id = db.prepare('INSERT INTO territories (name, nodered_id) VALUES (?, ?)')
    .run(name, req.body.nodered_id || name.toLowerCase().replace(/\s+/g, '_')).lastInsertRowid;
  broadcastState();
  return { id };
}));

router.put('/territories/:id', handle((req) => {
  const terr = db.prepare('SELECT * FROM territories WHERE id = ?').get(req.params.id);
  if (!terr) throw new Error('territory not found');
  const { name, nodered_id, locked, owner } = req.body;
  if (name !== undefined) db.prepare('UPDATE territories SET name = ? WHERE id = ?').run(String(name), terr.id);
  if (nodered_id !== undefined) db.prepare('UPDATE territories SET nodered_id = ? WHERE id = ?').run(String(nodered_id), terr.id);
  if (locked !== undefined) db.prepare('UPDATE territories SET locked = ? WHERE id = ?').run(locked ? 1 : 0, terr.id);
  if (owner !== undefined) {
    // Admin reassignment overrides locks; locks only block steals.
    actions.setTerritoryOwner(terr.id, owner, { ignoreLock: true });
  }
  broadcastState();
}));

router.delete('/territories/:id', handle((req) => {
  db.prepare('DELETE FROM territories WHERE id = ?').run(req.params.id);
  broadcastState();
}));

// ---------- power-ups ----------
router.post('/powerups/defs', handle((req) => {
  const { id, name, description = '', icon = null, modes = ['gameshow', 'escaperoom'], effect_type, config = {} } = req.body;
  if (!id || !name || !effect_type) throw new Error('id, name and effect_type are required');
  db.prepare(`INSERT INTO powerup_defs (id, name, description, icon, modes, effect_type, config)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
                icon=excluded.icon, modes=excluded.modes, effect_type=excluded.effect_type, config=excluded.config`)
    .run(id, name, description, icon, JSON.stringify(modes), effect_type, JSON.stringify(config));
  broadcastState();
}));

router.delete('/powerups/defs/:id', handle((req) => {
  db.prepare('DELETE FROM powerup_instances WHERE def_id = ?').run(req.params.id);
  db.prepare('DELETE FROM powerup_defs WHERE id = ?').run(req.params.id);
  broadcastState();
}));

router.post('/powerups/grant', handle((req) => {
  const session = activeSession();
  if (!session) throw new Error('no active session');
  const { team_id, def_id } = req.body;
  if (!db.prepare('SELECT 1 FROM powerup_defs WHERE id = ?').get(def_id)) throw new Error('unknown power-up');
  const id = db.prepare('INSERT INTO powerup_instances (session_id, team_id, def_id) VALUES (?, ?, ?)')
    .run(session.id, team_id, def_id).lastInsertRowid;
  broadcastState();
  return { instance_id: id };
}));

router.post('/powerups/instances/:id/use', handle((req) => {
  actions.usePowerup(Number(req.params.id), {
    territoryId: req.body.territory_id || null,
    targetTeamId: req.body.target_team_id || null
  });
}));

router.delete('/powerups/instances/:id', handle((req) => {
  db.prepare('DELETE FROM powerup_instances WHERE id = ?').run(req.params.id);
  broadcastState();
}));

// ---------- minigames ----------
router.get('/minigames', handle(() => ({ minigames: allManifests() })));

router.put('/minigames/:id', handle((req) => {
  const existing = getManifest(req.params.id);
  if (!existing) throw new Error('unknown minigame');
  // Merge editable fields only; id is immutable.
  const m = { ...existing, ...req.body, id: existing.id };
  saveManifest(m);
  // Push the updated config to Node-RED so the Pi hosting this minigame can pick it up.
  const pushUrl = getSetting('manifest_push_url').trim();
  if (pushUrl) fireNodeRed('minigame_config', { manifest: m }, pushUrl);
  broadcastState();
  return { minigame: m };
}));

// Reorder rounds: body { ids: [...] } in desired order → round_number = position.
router.post('/minigames/order', handle((req) => {
  const ids = req.body.ids || [];
  ids.forEach((id, i) => {
    const m = getManifest(id);
    if (m) saveManifest({ ...m, round_number: i + 1 });
  });
  broadcastState();
}));

router.post('/minigames/:id/start', handle((req) =>
  actions.startMinigame(req.app.locals.timer, req.params.id, req.body.mode || null)));

router.post('/minigames/end', handle((req) =>
  actions.endMinigame(req.app.locals.timer, req.app.locals.onEndGuard)));

// Flip the ACTIVE minigame between rulesets without changing the session mode.
router.post('/minigames/active/mode', handle((req) => {
  const session = activeSession();
  if (!session || !session.active_minigame_id) throw new Error('no active minigame');
  const mode = req.body.mode;
  const manifest = getManifest(session.active_minigame_id);
  if (!manifest.enabled_modes.includes(mode)) throw new Error(`${manifest.name} is not enabled for ${mode}`);
  db.prepare('UPDATE sessions SET active_minigame_mode = ? WHERE id = ?').run(mode, session.id);
  req.app.locals.timer.load(manifest[mode]?.timer_seconds ?? 300);
  broadcastState();
}));

// ---------- timer ----------
router.post('/timer', handle((req) => actions.timerAction(req.app.locals.timer, req.body.action, req.body.seconds)));

// ---------- banner (admin test / manual announcements) ----------
router.post('/banner', handle((req) => pushBanner(req.body.text, req.body.duration || 8)));

// ---------- uploads ----------
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(png|jpe?g|gif|webp)$/i.test(file.originalname);
    cb(ok ? null : new Error('only png, jpg, jpeg, gif, webp are accepted'), ok);
  }
});
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no image received' });
  res.json({ path: `/uploads/${req.file.filename}` });
});

// ---------- settings ----------
router.get('/settings', handle(() => ({
  admin_pin: getSetting('admin_pin'),
  inbound_token: getSetting('inbound_token'),
  nodered_base_url: getSetting('nodered_base_url'),
  manifest_push_url: getSetting('manifest_push_url')
})));

router.put('/settings', handle((req) => {
  for (const key of ['admin_pin', 'inbound_token', 'nodered_base_url', 'manifest_push_url']) {
    if (req.body[key] !== undefined) setSetting(key, String(req.body[key]));
  }
}));

// ---------- Node-RED diagnostics ----------
router.get('/nodered/log', handle(() => ({
  inbound: db.prepare("SELECT * FROM nodered_log WHERE direction = 'in' ORDER BY id DESC LIMIT 50").all(),
  outbound: db.prepare("SELECT * FROM nodered_log WHERE direction = 'out' ORDER BY id DESC LIMIT 50").all()
})));

router.post('/nodered/test', handle((req) => {
  const event = req.body.event || 'test';
  fireNodeRed(event, { test: true, note: 'fired from the Node-RED diagnostics panel' });
}));

// ---------- run history ----------
router.get('/history', handle(() => ({
  runs: db.prepare('SELECT * FROM run_history ORDER BY id DESC LIMIT 100').all()
})));

module.exports = router;
