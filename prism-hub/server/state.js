// state.js — builds the single state snapshot every surface renders from,
// and broadcasts it over Socket.IO whenever anything changes.
// Stage, Admin, and Player all render this same object. Stage never polls.
const { db, activeSession, teamsForSession, chromaForTeam, bests } = require('./db');
const { allManifests } = require('./core');

let io = null;
function setIO(socketServer) { io = socketServer; }

// Phase 3: end-of-run summary for the Stage. Set when an escape-room session
// ends, cleared when the next session starts. In-memory only — the permanent
// record lives in run_history.
let lastRun = null;
function setLastRun(summary) { lastRun = summary; }

function buildState() {
  const session = activeSession();
  let teams = [];
  if (session) {
    teams = teamsForSession(session.id).map((t) => ({
      ...t,
      chroma: chromaForTeam(t.id), // DERIVED — see db.js
      territory_count: db.prepare('SELECT COUNT(*) AS c FROM territories WHERE owner = ?').get(t.color).c,
      powerups: db.prepare(`
        SELECT pi.id, pi.used, pd.id AS def_id, pd.name, pd.icon, pd.effect_type, pd.config
        FROM powerup_instances pi JOIN powerup_defs pd ON pd.id = pi.def_id
        WHERE pi.team_id = ? ORDER BY pi.id`).all(t.id)
        .map((p) => ({ ...p, config: JSON.parse(p.config || '{}') }))
    }));
  }
  // Phase 2: escape-room attempt tracking per quiz minigame, so the Admin can
  // grey out an exhausted launch tile and show "Attempt N of M".
  const quiz_attempts = {};
  if (session) {
    for (const m of allManifests()) {
      if (m.ui_component !== 'quiz') continue;
      const runs = db.prepare(
        'SELECT attempt_no, final_score, counted FROM quiz_runs WHERE session_id = ? AND minigame_id = ? ORDER BY started_at')
        .all(session.id, m.id);
      quiz_attempts[m.id] = {
        used: runs.length,
        max: m.escaperoom?.max_attempts ?? 3,
        scores: runs.map((r) => r.final_score),
        counted_score: runs.find((r) => r.counted)?.final_score ?? null
      };
    }
  }

  // Phase 3: the newest unresolved mole assignment, for the Admin-only
  // collapsed panel. The Stage NEVER renders this before the scoring reveal.
  let mole = null;
  if (session) {
    const a = db.prepare(
      "SELECT * FROM mole_assignments WHERE session_id = ? AND outcome = 'pending' ORDER BY assigned_at DESC, id DESC LIMIT 1")
      .get(session.id);
    if (a) {
      const t = teams.find((x) => x.id === a.team_id);
      mole = {
        id: a.id, minigame_id: a.minigame_id, round_number: a.round_number,
        team_id: a.team_id, team_name: t?.name, team_color: t?.color,
        objective_text: a.objective_text, reward: a.reward,
        auto_scored: !!a.auto_scored, delivered: !!a.delivered, outcome: a.outcome
      };
    }
  }

  return {
    session,
    teams,
    quiz_attempts,
    mole,
    last_run: session ? null : lastRun,
    territories: db.prepare('SELECT * FROM territories ORDER BY id').all(),
    minigames: allManifests(),
    powerup_defs: db.prepare('SELECT * FROM powerup_defs ORDER BY rowid').all()
      .map((d) => ({ ...d, modes: JSON.parse(d.modes || '[]'), config: JSON.parse(d.config || '{}') })),
    bests: bests()
  };
}

function broadcastState() {
  if (io) io.emit('state', buildState());
}

function pushBanner(text, duration = 8) {
  if (io) io.emit('banner', { id: Date.now(), text: String(text), duration: Number(duration) || 8 });
}

module.exports = { setIO, buildState, broadcastState, pushBanner, setLastRun, getIO: () => io };
