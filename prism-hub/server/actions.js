// actions.js — the verbs of the system. Both the Admin API and the inbound
// Node-RED hooks call these, so a Chroma award behaves identically whether a
// human tapped a button or a Pi POSTed a result.
const { db, activeSession, chromaForTeam } = require('./db');
const { getManifest, fireNodeRed } = require('./core');
const { broadcastState, pushBanner } = require('./state');

// ---- Chroma (append-only ledger) ----
function writeChroma({ sessionId, teamId, amount, source, reason = '', minigameId = null, tradeGroupId = null, quizRunId = null }) {
  const amt = Math.trunc(Number(amount));
  if (!Number.isFinite(amt) || amt === 0) throw new Error('amount must be a non-zero integer');
  const info = db.prepare(`
    INSERT INTO chroma_ledger (session_id, team_id, amount, source, minigame_id, reason, trade_group_id, quiz_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, teamId, amt, source, minigameId, reason, tradeGroupId, quizRunId);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  fireNodeRed('chroma_changed', {
    team: team.color, team_name: team.name, amount: amt, reason, source,
    new_total: chromaForTeam(teamId)
  });
  broadcastState();
  return db.prepare('SELECT * FROM chroma_ledger WHERE id = ?').get(info.lastInsertRowid);
}

function setVoided(entryId, voided) {
  const entry = db.prepare('SELECT * FROM chroma_ledger WHERE id = ?').get(entryId);
  if (!entry) throw new Error('ledger entry not found');
  // Trades are two linked rows — undoing one undoes both.
  if (entry.trade_group_id) {
    db.prepare('UPDATE chroma_ledger SET voided = ? WHERE trade_group_id = ?').run(voided ? 1 : 0, entry.trade_group_id);
  } else {
    db.prepare('UPDATE chroma_ledger SET voided = ? WHERE id = ?').run(voided ? 1 : 0, entryId);
  }
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(entry.team_id);
  fireNodeRed('chroma_changed', {
    team: team.color, team_name: team.name, amount: voided ? -entry.amount : entry.amount,
    reason: voided ? `undo: ${entry.reason}` : `redo: ${entry.reason}`, source: 'correction',
    new_total: chromaForTeam(entry.team_id)
  });
  broadcastState();
}

// ---- Territories ----
function setTerritoryOwner(territoryId, newOwner, { ignoreLock = false } = {}) {
  const terr = db.prepare('SELECT * FROM territories WHERE id = ?').get(territoryId);
  if (!terr) throw new Error('territory not found');
  if (terr.locked && !ignoreLock) throw new Error(`"${terr.name}" is locked`);
  if (terr.owner === newOwner) return terr;
  db.prepare('UPDATE territories SET owner = ? WHERE id = ?').run(newOwner, territoryId);
  // The Hub never talks to lights directly — Node-RED + Home Assistant do.
  fireNodeRed('territory_changed', {
    territory_id: terr.id, nodered_id: terr.nodered_id, name: terr.name,
    previous_owner: terr.owner, new_owner: newOwner
  });
  broadcastState();
  return { ...terr, owner: newOwner };
}

// ---- Minigames ----
function startMinigame(timer, minigameId, modeOverride = null) {
  const session = activeSession();
  if (!session) throw new Error('no active session');
  const manifest = getManifest(minigameId);
  if (!manifest) throw new Error(`unknown minigame: ${minigameId}`);
  const mode = modeOverride || session.mode;
  if (!manifest.enabled_modes.includes(mode)) throw new Error(`${manifest.name} is not enabled for ${mode}`);

  // Quiz minigames: validate attempts/categories BEFORE any state changes so a
  // blocked launch leaves everything untouched.
  const isQuiz = manifest.ui_component === 'quiz';
  const quizEngine = isQuiz ? require('./quiz') : null;
  if (isQuiz) quizEngine.preflight(session.id, minigameId, mode, manifest[mode]);

  db.prepare('UPDATE sessions SET active_minigame_id = ?, active_minigame_mode = ? WHERE id = ?')
    .run(minigameId, mode, session.id);
  timer.load(manifest[mode]?.timer_seconds ?? 300);
  fireNodeRed('minigame_start', { minigame_id: minigameId, mode, session_id: session.id }, manifest.nodered?.on_start);
  if (isQuiz) {
    const teams = db.prepare('SELECT * FROM teams WHERE session_id = ? ORDER BY id').all(session.id);
    quizEngine.launch({ sessionId: session.id, minigameId, mode, manifest, teams });
  }
  broadcastState();
  return { minigame_id: minigameId, mode };
}

function endMinigame(timer, onEndGuard) {
  const session = activeSession();
  if (!session || !session.active_minigame_id) throw new Error('no active minigame');
  const manifest = getManifest(session.active_minigame_id);

  // Quiz cleanup: finalize the run (scores/attempts/mole) if it hasn't ended
  // naturally, then clear the engine so the Stage returns to the leaderboard.
  const quizEngine = require('./quiz');
  if (quizEngine.isActive()) quizEngine.stop();

  // Fire on_end only if timer expiry didn't already fire it.
  if (manifest && !onEndGuard.fired()) {
    fireNodeRed('minigame_end', { minigame_id: manifest.id, cause: 'admin_end' }, manifest.nodered?.on_end);
  }
  onEndGuard.set(false);

  // Game show: playing a round advances the session to the next one.
  if (session.mode === 'gameshow' && session.active_minigame_mode === 'gameshow' && manifest?.round_number) {
    db.prepare('UPDATE sessions SET current_round = ? WHERE id = ?').run(manifest.round_number + 1, session.id);
  }
  db.prepare('UPDATE sessions SET active_minigame_id = NULL, active_minigame_mode = NULL WHERE id = ?').run(session.id);
  timer.load(0);
  broadcastState();
}

// ---- Timer (used by admin transport controls AND the inbound hook) ----
function timerAction(timer, action, seconds) {
  const s = Number(seconds) || 0;
  switch (action) {
    case 'start': timer.start(); break;
    case 'pause': timer.pause(); break;
    case 'resume': timer.start(); break;
    case 'reset': if (s > 0) timer.load(s); else timer.reset(); break;
    case 'add': timer.add(s); break;
    case 'subtract': timer.add(-Math.abs(s)); break;
    default: throw new Error(`unknown timer action: ${action}`);
  }
}

// ---- Power-ups ----
function usePowerup(instanceId, { territoryId = null, targetTeamId = null } = {}) {
  const inst = db.prepare(`
    SELECT pi.*, pd.name AS def_name, pd.effect_type, pd.config AS def_config
    FROM powerup_instances pi JOIN powerup_defs pd ON pd.id = pi.def_id
    WHERE pi.id = ?`).get(instanceId);
  if (!inst) throw new Error('power-up not found');
  if (inst.used) throw new Error('power-up already used');
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(inst.team_id);
  const config = JSON.parse(inst.def_config || '{}');

  switch (inst.effect_type) {
    case 'steal_territory': {
      if (!territoryId) throw new Error('steal_territory needs a territory_id');
      setTerritoryOwner(territoryId, team.color); // fires the Node-RED lighting event
      pushBanner(`${team.name} used ${inst.def_name}!`);
      break;
    }
    case 'chroma_bonus': {
      writeChroma({
        sessionId: inst.session_id, teamId: inst.team_id,
        amount: config.amount ?? 0, source: 'powerup', reason: inst.def_name
      });
      pushBanner(`${team.name} used ${inst.def_name}: +${config.amount ?? 0} Chroma`);
      break;
    }
    case 'announcement_only': {
      // Deliberately changes NO state. The room does the mechanic; we narrate it.
      let text = (config.template || `{team} used ${inst.def_name}`).replaceAll('{team}', team.name);
      if (text.includes('{target}')) {
        const target = targetTeamId ? db.prepare('SELECT * FROM teams WHERE id = ?').get(targetTeamId) : null;
        if (!target) throw new Error('this power-up needs a target_team_id');
        text = text.replaceAll('{target}', target.name);
      }
      pushBanner(text);
      break;
    }
    default: throw new Error(`unknown effect_type: ${inst.effect_type}`);
  }

  db.prepare("UPDATE powerup_instances SET used = 1, used_at = datetime('now') WHERE id = ?").run(instanceId);
  fireNodeRed('powerup_used', { team: team.color, team_name: team.name, powerup: inst.def_id, effect_type: inst.effect_type });
  broadcastState();
}

module.exports = { writeChroma, setVoided, setTerritoryOwner, startMinigame, endMinigame, timerAction, usePowerup };
