// mole.js — Phase 3 mole objective system.
// The Hub picks the team and the objective, then fires ONE outbound event
// (mole.assigned) at a dedicated URL. Node-RED decides how the mole is told —
// bench screen, receipt printer, TTS, phone. The Hub never displays the
// objective anywhere public and never needs changing when the device changes.
//
// Objectives are human-verifiable: the host judges success and taps Hit or
// Missed. The one exception is the Phase 2 trivia exact-score mole, which
// stays auto-scored (auto_scored=1) — for it this module only handles delivery
// and archiving, never resolution or reward. See docs/MOLE_SYSTEM.md.
const { randomUUID } = require('crypto');
const { db, getSetting } = require('./db');
const { fireNodeRed } = require('./core');
const { broadcastState } = require('./state');

// lazy to avoid a circular require (actions → mole → actions)
let _actions = null;
const actions = () => (_actions ??= require('./actions'));

const MIN_OBJECTIVES_WARNING = 3;

// ---------- library ----------
function listObjectives() {
  return db.prepare('SELECT * FROM mole_objectives ORDER BY created_at').all()
    .map((o) => ({ ...o, minigame_ids: JSON.parse(o.minigame_ids), modes: JSON.parse(o.modes) }));
}

function objectivesForMinigame(minigameId, mode = 'gameshow') {
  return listObjectives().filter((o) =>
    o.active &&
    o.modes.includes(mode) &&
    (o.minigame_ids.length === 0 || o.minigame_ids.includes(minigameId)));
}

// Any minigame with has_mole and a thin objective pool is a show-night risk.
function libraryWarnings(manifests) {
  const warnings = [];
  for (const m of manifests) {
    if (!m.gameshow?.has_mole || m.ui_component === 'quiz') continue; // quiz moles are auto-generated
    const n = objectivesForMinigame(m.id).length;
    if (n < MIN_OBJECTIVES_WARNING) {
      warnings.push(`"${m.name}" has a mole but only ${n} active objective(s) apply to it — add more (${MIN_OBJECTIVES_WARNING}+ recommended).`);
    }
  }
  return warnings;
}

function weightedDraw(objectives) {
  const total = objectives.reduce((s, o) => s + Math.max(1, o.weight), 0);
  let roll = Math.random() * total;
  for (const o of objectives) {
    roll -= Math.max(1, o.weight);
    if (roll <= 0) return o;
  }
  return objectives[objectives.length - 1] ?? null;
}

// ---------- assignment ----------
function getAssignment(id) {
  return db.prepare('SELECT * FROM mole_assignments WHERE id = ?').get(id) || null;
}

// The one assignment the Admin panel shows: newest unresolved for this session.
function pendingAssignment(sessionId) {
  return db.prepare(
    "SELECT * FROM mole_assignments WHERE session_id = ? AND outcome = 'pending' ORDER BY assigned_at DESC, id DESC LIMIT 1")
    .get(sessionId) || null;
}

function assignmentPayload(a) {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(a.team_id);
  return {
    session_id: a.session_id,
    minigame_id: a.minigame_id,
    round_number: a.round_number,
    team: team?.color ?? null,
    team_name: team?.name ?? null,
    objective: a.objective_text,
    reward: a.reward
  };
}

async function deliver(a, event = 'mole.assigned') {
  const ok = await fireNodeRed(event, assignmentPayload(a), getSetting('mole_webhook_url'));
  db.prepare('UPDATE mole_assignments SET delivered = ? WHERE id = ?').run(ok ? 1 : 0, a.id);
  broadcastState();
  return ok;
}

// A new assignment supersedes any unresolved one for the same session+minigame.
function voidStalePending(sessionId, minigameId) {
  db.prepare("UPDATE mole_assignments SET outcome = 'voided', resolved_at = datetime('now') WHERE session_id = ? AND minigame_id = ? AND outcome = 'pending'")
    .run(sessionId, minigameId);
}

// Creates the assignment row and fires delivery (async, non-blocking).
// `objectiveOverride` = { text, reward, auto } for the trivia exact-score mole.
function assign({ sessionId, minigameId, roundNumber = null, teamId = null, settings = {}, objectiveOverride = null }) {
  const teams = db.prepare('SELECT * FROM teams WHERE session_id = ? ORDER BY id').all(sessionId);
  if (!teams.length) throw new Error('no teams in session');
  const team = teamId
    ? teams.find((t) => t.id === Number(teamId))
    : teams[Math.floor(Math.random() * teams.length)];
  if (!team) throw new Error('unknown team');

  let objectiveId = null, text, reward;
  if (objectiveOverride) {
    text = objectiveOverride.text;
    reward = objectiveOverride.reward ?? 0;
  } else {
    const pool = objectivesForMinigame(minigameId);
    if (!pool.length) throw new Error(`no active mole objectives apply to ${minigameId} — add some in Admin → Mole Objectives`);
    const o = weightedDraw(pool);
    objectiveId = o.id;
    text = o.text;
    reward = o.reward ?? settings.mole_reward ?? 0;
  }

  voidStalePending(sessionId, minigameId);
  const a = {
    id: randomUUID(),
    session_id: sessionId,
    minigame_id: minigameId,
    round_number: roundNumber,
    team_id: team.id,
    objective_id: objectiveId,
    objective_text: text,
    reward,
    auto_scored: objectiveOverride?.auto ? 1 : 0
  };
  db.prepare(`INSERT INTO mole_assignments (id, session_id, minigame_id, round_number, team_id, objective_id, objective_text, reward, auto_scored)
              VALUES (@id, @session_id, @minigame_id, @round_number, @team_id, @objective_id, @objective_text, @reward, @auto_scored)`).run(a);
  broadcastState();
  deliver(getAssignment(a.id)); // fire-and-forget; `delivered` updates when it lands
  return getAssignment(a.id);
}

// ---------- admin controls ----------
function reroll(assignmentId) {
  const a = getAssignment(assignmentId);
  if (!a || a.outcome !== 'pending') throw new Error('no pending assignment to reroll');
  if (a.auto_scored) throw new Error('trivia moles have a generated objective — change the target in minigame settings');
  const pool = objectivesForMinigame(a.minigame_id).filter((o) => o.id !== a.objective_id);
  if (!pool.length) throw new Error('no other objectives available for this minigame');
  const o = weightedDraw(pool);
  db.prepare('UPDATE mole_assignments SET objective_id = ?, objective_text = ?, reward = ?, delivered = 0 WHERE id = ?')
    .run(o.id, o.text, o.reward ?? a.reward, a.id);
  broadcastState();
  deliver(getAssignment(a.id), 'mole.rerolled');
  return getAssignment(a.id);
}

function reassign(assignmentId, teamId) {
  const a = getAssignment(assignmentId);
  if (!a || a.outcome !== 'pending') throw new Error('no pending assignment to reassign');
  const team = db.prepare('SELECT * FROM teams WHERE id = ? AND session_id = ?').get(Number(teamId), a.session_id);
  if (!team) throw new Error('unknown team');
  db.prepare('UPDATE mole_assignments SET team_id = ?, delivered = 0 WHERE id = ?').run(team.id, a.id);
  broadcastState();
  deliver(getAssignment(a.id));
  return getAssignment(a.id);
}

function resend(assignmentId) {
  const a = getAssignment(assignmentId);
  if (!a) throw new Error('assignment not found');
  return deliver(a);
}

function clear(assignmentId) {
  const a = getAssignment(assignmentId);
  if (!a || a.outcome !== 'pending') throw new Error('no pending assignment to clear');
  db.prepare("UPDATE mole_assignments SET outcome = 'voided', resolved_at = datetime('now') WHERE id = ?").run(a.id);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(a.team_id);
  fireNodeRed('mole.cleared', { session_id: a.session_id, minigame_id: a.minigame_id, team: team?.color ?? null }, getSetting('mole_webhook_url'));
  broadcastState();
}

// Host verdict. Hit writes a normal ledger entry, so Phase 1 undo works on it.
function resolve(assignmentId, outcome) {
  if (!['hit', 'missed'].includes(outcome)) throw new Error("outcome must be 'hit' or 'missed'");
  const a = getAssignment(assignmentId);
  if (!a || a.outcome !== 'pending') throw new Error('no pending assignment to resolve');
  if (a.auto_scored) throw new Error('this mole is auto-scored by the question engine');
  db.prepare("UPDATE mole_assignments SET outcome = ?, resolved_at = datetime('now') WHERE id = ?").run(outcome, a.id);
  if (outcome === 'hit' && a.reward) {
    actions().writeChroma({
      sessionId: a.session_id, teamId: a.team_id, amount: a.reward,
      source: 'powerup', reason: `Mole objective achieved: ${a.objective_text}`, minigameId: a.minigame_id
    });
  }
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(a.team_id);
  fireNodeRed('mole.resolved', {
    team: team?.color ?? null, objective: a.objective_text, outcome,
    reward_awarded: outcome === 'hit' ? a.reward : 0
  }, getSetting('mole_webhook_url'));
  require('./grid').refreshMoleReveal(); // Stage's post-score reveal updates live
  broadcastState();
  return getAssignment(a.id);
}

// The quiz engine resolves its own mole (reward already paid there) — this just
// closes the archive record and fires the event.
function autoResolve(assignmentId, hit) {
  const a = getAssignment(assignmentId);
  if (!a || a.outcome !== 'pending') return;
  db.prepare("UPDATE mole_assignments SET outcome = ?, resolved_at = datetime('now') WHERE id = ?").run(hit ? 'hit' : 'missed', a.id);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(a.team_id);
  fireNodeRed('mole.resolved', {
    team: team?.color ?? null, objective: a.objective_text, outcome: hit ? 'hit' : 'missed',
    reward_awarded: hit ? a.reward : 0
  }, getSetting('mole_webhook_url'));
}

module.exports = {
  listObjectives, objectivesForMinigame, libraryWarnings,
  assign, getAssignment, pendingAssignment,
  reroll, reassign, resend, clear, resolve, autoResolve
};
