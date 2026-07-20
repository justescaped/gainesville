// phase3.js — Phase 3 endpoints: mole objective library + assignment controls,
// Color Grid puzzles + round controls, and run history / leaderboards.
// Mounted at /api alongside the Phase 1/2 routers.
const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();

const { db, activeSession } = require('../db');
const { allManifests } = require('../core');
const { broadcastState } = require('../state');
const mole = require('../mole');
const gridEngine = require('../grid');

function handle(fn) {
  return (req, res) => {
    try {
      const out = fn(req);
      res.json(out === undefined ? { ok: true } : out);
    } catch (err) { res.status(400).json({ error: err.message }); }
  };
}

// ============================================================
// mole objective library
// ============================================================
router.get('/mole/objectives', handle(() => ({
  objectives: mole.listObjectives(),
  warnings: mole.libraryWarnings(allManifests())
})));

router.post('/mole/objectives', handle((req) => {
  const text = String(req.body.text || '').trim();
  if (!text) throw new Error('objective text is required');
  const id = randomUUID();
  db.prepare('INSERT INTO mole_objectives (id, text, minigame_ids, reward, weight, active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, text,
      JSON.stringify(req.body.minigame_ids || []),
      req.body.reward == null || req.body.reward === '' ? null : Math.trunc(Number(req.body.reward)),
      Math.max(1, Math.trunc(Number(req.body.weight)) || 1),
      req.body.active === false ? 0 : 1);
  return { id };
}));

router.put('/mole/objectives/:id', handle((req) => {
  const o = db.prepare('SELECT * FROM mole_objectives WHERE id = ?').get(req.params.id);
  if (!o) throw new Error('objective not found');
  const b = req.body;
  db.prepare('UPDATE mole_objectives SET text = ?, minigame_ids = ?, reward = ?, weight = ?, active = ? WHERE id = ?')
    .run(
      String(b.text ?? o.text).trim() || o.text,
      JSON.stringify(b.minigame_ids ?? JSON.parse(o.minigame_ids)),
      b.reward === undefined ? o.reward : (b.reward == null || b.reward === '' ? null : Math.trunc(Number(b.reward))),
      b.weight === undefined ? o.weight : Math.max(1, Math.trunc(Number(b.weight)) || 1),
      b.active === undefined ? o.active : (b.active ? 1 : 0),
      o.id);
}));

router.post('/mole/objectives/:id/duplicate', handle((req) => {
  const o = db.prepare('SELECT * FROM mole_objectives WHERE id = ?').get(req.params.id);
  if (!o) throw new Error('objective not found');
  const id = randomUUID();
  db.prepare('INSERT INTO mole_objectives (id, text, minigame_ids, reward, weight, active) VALUES (?, ?, ?, ?, ?, 0)')
    .run(id, o.text + ' (copy)', o.minigame_ids, o.reward, o.weight);
  return { id };
}));

// Soft delete: past assignments keep their snapshotted text either way.
router.delete('/mole/objectives/:id', handle((req) => {
  const referenced = db.prepare('SELECT 1 FROM mole_assignments WHERE objective_id = ? LIMIT 1').get(req.params.id);
  if (referenced) {
    db.prepare('UPDATE mole_objectives SET active = 0 WHERE id = ?').run(req.params.id);
    return { soft_deleted: true };
  }
  db.prepare('DELETE FROM mole_objectives WHERE id = ?').run(req.params.id);
  return { soft_deleted: false };
}));

// ============================================================
// mole assignment controls (the Admin "MOLE — DO NOT SHOW" panel)
// ============================================================
// Manual assign, for randomize_mole_team=false or a cleared mole.
router.post('/mole/assign', handle((req) => {
  const session = activeSession();
  if (!session || !session.active_minigame_id) throw new Error('no active minigame');
  const manifest = allManifests().find((m) => m.id === session.active_minigame_id);
  const a = mole.assign({
    sessionId: session.id,
    minigameId: session.active_minigame_id,
    roundNumber: manifest?.round_number ?? null,
    teamId: req.body.team_id || null,
    settings: manifest?.[session.active_minigame_mode] || {}
  });
  if (gridEngine.isActive()) gridEngine.setMoleAssignment(a.id);
  return { assignment_id: a.id };
}));

router.post('/mole/assignment/:id/reroll', handle((req) => ({ assignment: mole.reroll(req.params.id) })));
router.post('/mole/assignment/:id/reassign', handle((req) => ({ assignment: mole.reassign(req.params.id, req.body.team_id) })));
router.post('/mole/assignment/:id/resend', (req, res) => {
  mole.resend(req.params.id)
    .then((delivered) => res.json({ ok: true, delivered }))
    .catch((err) => res.status(400).json({ error: err.message }));
});
router.post('/mole/assignment/:id/clear', handle((req) => mole.clear(req.params.id)));
router.post('/mole/assignment/:id/resolve', handle((req) => ({ assignment: mole.resolve(req.params.id, req.body.outcome) })));

// ============================================================
// grid puzzles (Admin puzzle builder)
// ============================================================
const COLORS = ['red', 'blue', 'green', 'yellow', 'empty'];

function validatePattern(pattern, rows, cols) {
  if (!Array.isArray(pattern) || pattern.length !== rows) throw new Error(`pattern must have ${rows} rows`);
  for (const row of pattern) {
    if (!Array.isArray(row) || row.length !== cols) throw new Error(`every row must have ${cols} cells`);
    for (const cell of row) if (!COLORS.includes(cell)) throw new Error(`invalid cell value: ${cell}`);
  }
}

router.get('/grid/puzzles', handle(() => ({
  puzzles: db.prepare('SELECT * FROM grid_puzzles ORDER BY created_at').all()
    .map((p) => ({ ...p, pattern: JSON.parse(p.pattern), modes: JSON.parse(p.modes) }))
})));

router.post('/grid/puzzles', handle((req) => {
  const { name, rows, cols, pattern, difficulty = 'medium', modes = ['gameshow', 'escaperoom'] } = req.body;
  const R = Math.trunc(Number(rows)), C = Math.trunc(Number(cols));
  if (!(R >= 2 && R <= 8 && C >= 2 && C <= 8)) throw new Error('grid size must be between 2×2 and 8×8');
  if (!String(name || '').trim()) throw new Error('name is required');
  if (!['easy', 'medium', 'hard'].includes(difficulty)) throw new Error('difficulty must be easy, medium or hard');
  validatePattern(pattern, R, C);
  const id = randomUUID();
  db.prepare('INSERT INTO grid_puzzles (id, name, rows, cols, pattern, difficulty, modes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, String(name).trim(), R, C, JSON.stringify(pattern), difficulty, JSON.stringify(modes));
  return { id };
}));

router.put('/grid/puzzles/:id', handle((req) => {
  const p = db.prepare('SELECT * FROM grid_puzzles WHERE id = ?').get(req.params.id);
  if (!p) throw new Error('puzzle not found');
  const b = req.body;
  const R = b.rows === undefined ? p.rows : Math.trunc(Number(b.rows));
  const C = b.cols === undefined ? p.cols : Math.trunc(Number(b.cols));
  if (!(R >= 2 && R <= 8 && C >= 2 && C <= 8)) throw new Error('grid size must be between 2×2 and 8×8');
  const pattern = b.pattern ?? JSON.parse(p.pattern);
  validatePattern(pattern, R, C);
  if (b.difficulty !== undefined && !['easy', 'medium', 'hard'].includes(b.difficulty)) throw new Error('bad difficulty');
  db.prepare('UPDATE grid_puzzles SET name = ?, rows = ?, cols = ?, pattern = ?, difficulty = ?, modes = ?, active = ? WHERE id = ?')
    .run(
      String(b.name ?? p.name).trim() || p.name, R, C, JSON.stringify(pattern),
      b.difficulty ?? p.difficulty,
      JSON.stringify(b.modes ?? JSON.parse(p.modes)),
      b.active === undefined ? p.active : (b.active ? 1 : 0),
      p.id);
}));

router.post('/grid/puzzles/:id/duplicate', handle((req) => {
  const p = db.prepare('SELECT * FROM grid_puzzles WHERE id = ?').get(req.params.id);
  if (!p) throw new Error('puzzle not found');
  const id = randomUUID();
  db.prepare('INSERT INTO grid_puzzles (id, name, rows, cols, pattern, difficulty, modes, active) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
    .run(id, p.name + ' (copy)', p.rows, p.cols, p.pattern, p.difficulty, p.modes);
  return { id };
}));

router.delete('/grid/puzzles/:id', handle((req) => {
  const referenced = db.prepare('SELECT 1 FROM grid_rounds WHERE puzzle_id = ? LIMIT 1').get(req.params.id);
  if (referenced) {
    db.prepare('UPDATE grid_puzzles SET active = 0 WHERE id = ?').run(req.params.id);
    return { soft_deleted: true };
  }
  db.prepare('DELETE FROM grid_puzzles WHERE id = ?').run(req.params.id);
  return { soft_deleted: false };
}));

// ============================================================
// grid round controls (Admin, during a live round)
// ============================================================
router.get('/grid', handle(() => gridEngine.snapshot()));

// Manual fallback: if RFID dies mid-show, the host taps the shelf state in by
// hand. Same append-only pipeline as the hardware.
router.post('/grid/cell', handle((req) =>
  gridEngine.recordPlacement({ row: req.body.row, col: req.body.col, color: req.body.color })));

router.post('/grid/score', handle(() => gridEngine.score('admin_score_now')));
router.post('/grid/reveal_again', handle(() => gridEngine.revealAgain()));

// ============================================================
// run history / leaderboards
// ============================================================
function runRow(r) {
  return { ...r, player_names: r.player_names ? JSON.parse(r.player_names) : null, minigames_played: JSON.parse(r.minigames_played || '[]') };
}

// Top 25 escape-room runs, ties broken by shorter duration.
router.get('/history/alltime', handle(() => ({
  runs: db.prepare(`
    SELECT * FROM run_history WHERE mode = 'escaperoom' AND visible = 1
    ORDER BY final_chroma DESC, duration_seconds ASC LIMIT 25`).all().map(runRow)
})));

router.get('/history/monthly', handle((req) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null;
  const rows = month
    ? db.prepare(`
        SELECT * FROM run_history WHERE mode = 'escaperoom' AND visible = 1 AND strftime('%Y-%m', ended_at) = ?
        ORDER BY final_chroma DESC, duration_seconds ASC LIMIT 25`).all(month)
    : db.prepare(`
        SELECT * FROM run_history WHERE mode = 'escaperoom' AND visible = 1 AND strftime('%Y-%m', ended_at) = strftime('%Y-%m', 'now')
        ORDER BY final_chroma DESC, duration_seconds ASC LIMIT 25`).all();
  const months = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', ended_at) AS m FROM run_history WHERE mode = 'escaperoom' ORDER BY m DESC`).all().map((x) => x.m);
  return { runs: rows.map(runRow), months };
}));

// Every run, newest first. Includes hidden rows (flagged) — this is the
// Admin's working list, not the public board.
router.get('/history/recent', handle((req) => {
  const clauses = [], params = [];
  if (req.query.mode && ['gameshow', 'escaperoom'].includes(req.query.mode)) { clauses.push('mode = ?'); params.push(req.query.mode); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) { clauses.push('date(ended_at) >= ?'); params.push(req.query.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) { clauses.push('date(ended_at) <= ?'); params.push(req.query.to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { runs: db.prepare(`SELECT * FROM run_history ${where} ORDER BY ended_at DESC, id DESC LIMIT 200`).all(...params).map(runRow) };
}));

// Session archive: the record you pull up when someone disputes a score on
// stream. Full ledger, mole assignments, quiz runs, grid rounds.
router.get('/history/:id/archive', handle((req) => {
  const run = db.prepare('SELECT * FROM run_history WHERE id = ?').get(req.params.id);
  if (!run) throw new Error('run not found');
  const sid = run.session_id;
  return {
    run: runRow(run),
    ledger: db.prepare(`
      SELECT cl.*, t.name AS team_name, t.color AS team_color
      FROM chroma_ledger cl LEFT JOIN teams t ON t.id = cl.team_id
      WHERE cl.session_id = ? ORDER BY cl.id`).all(sid),
    mole_assignments: db.prepare(`
      SELECT ma.*, t.name AS team_name, t.color AS team_color
      FROM mole_assignments ma LEFT JOIN teams t ON t.id = ma.team_id
      WHERE ma.session_id = ? ORDER BY ma.assigned_at`).all(sid),
    launches: db.prepare('SELECT * FROM minigame_launches WHERE session_id = ? ORDER BY id').all(sid),
    quiz_runs: db.prepare('SELECT * FROM quiz_runs WHERE session_id = ? ORDER BY started_at').all(sid),
    grid_rounds: db.prepare(`
      SELECT gr.*, gp.name AS puzzle_name FROM grid_rounds gr
      LEFT JOIN grid_puzzles gp ON gp.id = gr.puzzle_id
      WHERE gr.session_id = ? ORDER BY gr.started_at`).all(sid)
      .map((g) => ({ ...g, final_state: g.final_state ? JSON.parse(g.final_state) : null, scores: g.scores ? JSON.parse(g.scores) : null }))
  };
}));

// Post-run edits: names, notes, and visibility only — never the score.
router.put('/history/:id', handle((req) => {
  const run = db.prepare('SELECT * FROM run_history WHERE id = ?').get(req.params.id);
  if (!run) throw new Error('run not found');
  const b = req.body;
  db.prepare('UPDATE run_history SET team_name = ?, player_names = ?, notes = ?, visible = ? WHERE id = ?')
    .run(
      String(b.team_name ?? run.team_name).trim() || run.team_name,
      b.player_names === undefined ? run.player_names : (b.player_names ? JSON.stringify(b.player_names) : null),
      b.notes === undefined ? run.notes : (b.notes || null),
      b.visible === undefined ? run.visible : (b.visible ? 1 : 0),
      run.id);
  broadcastState(); // bests may have changed if visibility flipped
}));

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

router.get('/history/export.csv', (_req, res) => {
  const rows = db.prepare('SELECT * FROM run_history ORDER BY ended_at DESC, id DESC').all().map(runRow);
  const lines = ['id,session_id,mode,team_name,player_names,final_chroma,duration_seconds,minigames_played,ended_at,notes,visible'];
  for (const r of rows) {
    lines.push([
      r.id, r.session_id, r.mode, r.team_name,
      (r.player_names || []).join('; '), r.final_chroma, r.duration_seconds,
      r.minigames_played.join('; '), r.ended_at, r.notes || '', r.visible
    ].map(csvEscape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="prism-run-history.csv"');
  res.send(lines.join('\n'));
});

module.exports = router;
