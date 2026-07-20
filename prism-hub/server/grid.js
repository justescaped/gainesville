// grid.js — Phase 3 Color Grid engine (minigame #6, ui_component "grid").
// Reveal → build → scored. The Hub owns the pattern, the timing, and the
// scoring; the Pi only reports what is physically in each cubby.
//
// SECURITY NOTE: after the reveal ends, the target pattern is REMOVED from the
// snapshot payload entirely — never hidden with CSS. A player inspecting the
// Stage DOM on their phone finds nothing. It returns at scoring.
//
// Placements are append-only (grid_placements), like the Chroma ledger:
// current shelf state is the latest placement per cell, and the whole round
// replays for dispute resolution on stream.
const { randomUUID } = require('crypto');
const { db, resolveTeam } = require('./db');
const { fireNodeRed } = require('./core');
const { broadcastState } = require('./state');

// lazy to avoid a circular require (actions → grid → actions)
let _actions = null;
const actions = () => (_actions ??= require('./actions'));
const mole = () => require('./mole');

let emit = () => {};            // set by index.js: (snapshot) => io.emit('grid', snapshot)
function setEmitter(fn) { emit = fn; }

let grid = null;                // the single active grid round, or null
let revealTick = null;          // 100ms interval during the reveal countdown
let timerRef = null;            // the Phase 1 server timer (drives the build phase)

// ============================================================
// snapshot — the ONLY data clients ever see
// ============================================================
function snapshot() {
  if (!grid) return { active: false };
  const s = {
    active: true,
    minigame_id: grid.minigameId,
    mode: grid.mode,
    phase: grid.phase,                      // 'reveal' | 'build' | 'scored'
    round_id: grid.roundId,
    rows: grid.rows,
    cols: grid.cols,
    puzzle_name: grid.puzzle.name,
    difficulty: grid.puzzle.difficulty,
    mid_build: grid.midBuild,               // true during a repeat reveal
    reveals_used: grid.revealsUsed
  };
  if (grid.phase === 'reveal') {
    s.target = grid.target;                 // present ONLY while deliberately shown
    s.reveal_remaining_ms = Math.max(0, grid.revealDeadline - Date.now());
    s.reveal_seconds = grid.settings.reveal_seconds;
  }
  if (grid.phase === 'build') {
    // The TARGET is deliberately ABSENT from the payload — that's the secret.
    // Placements are not (they're physically visible in the room); the Stage
    // only renders them when show_placements is on, and Admin always needs
    // them for the manual fallback.
    s.show_placements = !!grid.settings.show_placements;
    s.cells = grid.cells;
  }
  if (grid.phase === 'scored') {
    s.target = grid.target;
    s.cells = grid.finalCells;
    s.result = grid.result;                 // { per_cell, scores, perfect, cause, time_bonus }
    s.mole = grid.moleReveal;               // public reveal moment — null if no mole
  }
  return s;
}
const push = () => emit(snapshot());

// ============================================================
// helpers
// ============================================================
function emptyCells(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 'empty'));
}

function drawPuzzle(mode, settings) {
  const filter = settings.difficulty_filter ?? ['easy', 'medium', 'hard'];
  const pool = db.prepare('SELECT * FROM grid_puzzles WHERE active = 1').all()
    .filter((p) => JSON.parse(p.modes).includes(mode) && filter.includes(p.difficulty));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function cellsMatchTarget() {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cells[r][c] !== grid.target[r][c]) return false;
    }
  }
  return true;
}

function clearRevealTick() {
  if (revealTick) { clearInterval(revealTick); revealTick = null; }
}

// ============================================================
// lifecycle
// ============================================================
// Throws (blocking the launch) if no active puzzle fits — actions.startMinigame
// calls this BEFORE flipping any state.
function preflight(mode, settings) {
  if (!drawPuzzle(mode, settings)) {
    throw new Error('no active grid puzzle matches this mode and difficulty filter — add one in Minigames → Color Grid → Puzzles');
  }
}

function launch({ sessionId, minigameId, mode, manifest, teams, timer }) {
  clearRevealTick();
  timerRef = timer;
  const settings = manifest[mode];
  const puzzle = drawPuzzle(mode, settings);
  const target = JSON.parse(puzzle.pattern);

  grid = {
    sessionId, minigameId, mode, settings, teams,
    roundId: randomUUID(),
    puzzle, target,
    rows: puzzle.rows, cols: puzzle.cols,
    cells: emptyCells(puzzle.rows, puzzle.cols),
    phase: 'reveal',
    midBuild: false,
    revealsUsed: 0,
    revealDeadline: 0,
    buildStarted: false,
    moleAssignmentId: null,
    finalCells: null, result: null, moleReveal: null,
    finalized: false
  };

  // Game show mole: Part 1 assignment flow, delivered via Node-RED.
  if (mode === 'gameshow' && settings.has_mole) {
    if (settings.randomize_mole_team !== false) {
      const a = mole().assign({
        sessionId, minigameId,
        roundNumber: manifest.round_number ?? null,
        settings
      });
      grid.moleAssignmentId = a.id;
    }
    // randomize_mole_team=false: Admin picks the team from the mole panel;
    // the panel's assign call links itself to this round via setMoleAssignment.
  }

  db.prepare(`INSERT INTO grid_rounds (id, session_id, puzzle_id, mode, mole_assignment_id, reveal_seconds)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(grid.roundId, sessionId, puzzle.id, mode, grid.moleAssignmentId, settings.reveal_seconds ?? 10);

  // Build timer is loaded but NOT started — it starts when the reveal ends.
  timer.load(settings.build_seconds ?? 90);
  fireNodeRed('grid.started', { puzzle_id: puzzle.id, rows: puzzle.rows, cols: puzzle.cols, mode });
  startReveal();
}

function setMoleAssignment(assignmentId) {
  if (!grid) return;
  grid.moleAssignmentId = assignmentId;
  db.prepare('UPDATE grid_rounds SET mole_assignment_id = ? WHERE id = ?').run(assignmentId, grid.roundId);
}

function startReveal() {
  grid.phase = 'reveal';
  grid.revealsUsed += 1;
  grid.revealDeadline = Date.now() + (grid.settings.reveal_seconds ?? 10) * 1000;
  fireNodeRed('grid.reveal_start', { round_id: grid.roundId, reveal_number: grid.revealsUsed });
  push();
  revealTick = setInterval(() => {
    if (Date.now() >= grid.revealDeadline) endReveal();
    else push();
  }, 100);
}

function endReveal() {
  clearRevealTick();
  fireNodeRed('grid.reveal_end', { round_id: grid.roundId });
  grid.phase = 'build';
  if (!grid.buildStarted) {
    grid.buildStarted = true;
    fireNodeRed('grid.build_start', { round_id: grid.roundId });
    timerRef.start();               // the Phase 1 server timer runs the build countdown
  }
  grid.midBuild = false;
  push();
}

// Repeat reveal. Escape room: always available (hint mechanism). Game show:
// only if allow_repeat_reveal. Cost, if configured, is a normal ledger entry —
// in game show every team pays (they all see it again).
function revealAgain() {
  if (!grid || grid.phase !== 'build') throw new Error('reveal is only repeatable during the build phase');
  if (grid.mode === 'gameshow' && !grid.settings.allow_repeat_reveal) {
    throw new Error('repeat reveal is disabled for game show — enable it in minigame settings');
  }
  const cost = Math.abs(Number(grid.settings.repeat_reveal_cost) || 0);
  if (cost > 0) {
    for (const t of grid.teams) {
      actions().writeChroma({
        sessionId: grid.sessionId, teamId: t.id, amount: -cost,
        source: 'minigame', reason: 'Repeat reveal', minigameId: grid.minigameId
      });
    }
  }
  grid.midBuild = true;             // build timer keeps running — looking costs time too
  startReveal();
}

// ============================================================
// placements — from RFID via Node-RED, or Admin manual fallback
// ============================================================
function recordPlacement({ row, col, color, tagId = null, teamRef = null }) {
  if (!grid) throw new Error('no grid round active');
  if (grid.phase === 'scored') throw new Error('round already scored');
  const r = Math.trunc(Number(row)), c = Math.trunc(Number(col));
  if (!(r >= 0 && r < grid.rows && c >= 0 && c < grid.cols)) throw new Error(`cell ${row},${col} outside ${grid.rows}×${grid.cols} grid`);
  if (!['red', 'blue', 'green', 'yellow', 'empty'].includes(color)) throw new Error(`invalid color: ${color}`);
  const team = teamRef != null ? resolveTeam(grid.sessionId, teamRef) : null;
  db.prepare('INSERT INTO grid_placements (id, round_id, row, col, color, tag_id, team_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), grid.roundId, r, c, color, tagId, team?.id ?? null);
  grid.cells[r][c] = color;
  // Escape room exact-match completion: the instant the shelf matches, score —
  // remaining build seconds convert to Chroma.
  if (grid.phase === 'build' && grid.mode === 'escaperoom' && grid.settings.require_exact && cellsMatchTarget()) {
    return score('exact_match');
  }
  push();
}

// Full snapshot resync (a Pi that reboots mid-round POSTs the whole shelf).
function setFullState(cells) {
  if (!grid) throw new Error('no grid round active');
  if (grid.phase === 'scored') throw new Error('round already scored');
  if (!Array.isArray(cells) || cells.length !== grid.rows || cells.some((row) => !Array.isArray(row) || row.length !== grid.cols)) {
    throw new Error(`cells must be a ${grid.rows}×${grid.cols} array`);
  }
  const ins = db.prepare('INSERT INTO grid_placements (id, round_id, row, col, color, tag_id, team_id) VALUES (?, ?, ?, ?, ?, NULL, NULL)');
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const color = cells[r][c];
      if (!['red', 'blue', 'green', 'yellow', 'empty'].includes(color)) throw new Error(`invalid color at ${r},${c}: ${color}`);
      if (grid.cells[r][c] !== color) {
        ins.run(randomUUID(), grid.roundId, r, c, color);
        grid.cells[r][c] = color;
      }
    }
  }
  if (grid.phase === 'build' && grid.mode === 'escaperoom' && grid.settings.require_exact && cellsMatchTarget()) {
    return score('exact_match');
  }
  push();
}

// ============================================================
// scoring
// ============================================================
function score(cause) {
  if (!grid || grid.finalized) return;
  grid.finalized = true;
  clearRevealTick();

  const st = grid.settings;
  const perCell = [];               // [{row, col, target, placed, correct}]
  const correctByColor = {};        // color → count of correctly placed cells
  const wrongByColor = {};
  let allMatch = true;

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const t = grid.target[r][c], p = grid.cells[r][c];
      const correct = t === p;
      if (!correct) allMatch = false;
      perCell.push({ row: r, col: c, target: t, placed: p, correct });
      if (t !== 'empty' && correct) correctByColor[t] = (correctByColor[t] || 0) + 1;
      if (p !== 'empty' && !correct) wrongByColor[p] = (wrongByColor[p] || 0) + 1;
    }
  }

  const remainingSec = Math.floor((timerRef?.snapshot().remaining_ms ?? 0) / 1000);
  timerRef?.pause();

  const scores = {};                // team_id → correct count (persisted on the round)
  const perTeam = [];               // for the Stage tally

  if (grid.mode === 'gameshow') {
    const targetColors = new Set(grid.target.flat().filter((x) => x !== 'empty'));
    for (const t of grid.teams) {
      const correct = correctByColor[t.color] || 0;
      const wrong = wrongByColor[t.color] || 0;
      scores[t.id] = correct;
      let points = correct * (st.points_per_correct ?? 25) + wrong * (st.points_per_wrong ?? 0);
      let bonus = 0;
      if (allMatch && targetColors.has(t.color)) bonus = st.perfect_bonus ?? 0;
      if (points + bonus !== 0) {
        actions().writeChroma({
          sessionId: grid.sessionId, teamId: t.id, amount: points + bonus,
          source: 'minigame', minigameId: grid.minigameId,
          reason: `Color Grid: ${correct} correct${wrong && (st.points_per_wrong ?? 0) !== 0 ? `, ${wrong} wrong` : ''}${bonus ? ' + perfect bonus' : ''}`
        });
      }
      perTeam.push({ team_id: t.id, name: t.name, color: t.color, correct, wrong, points: points + bonus });
    }
  } else {
    const team = grid.teams[0];
    const correct = Object.values(correctByColor).reduce((s, n) => s + n, 0);
    scores[team.id] = correct;
    let points = correct * (st.points_per_correct ?? 25);
    let bonus = allMatch ? (st.perfect_bonus ?? 0) : 0;
    let timeBonus = cause === 'exact_match' ? remainingSec * (st.per_second_remaining ?? 0) : 0;
    const total = points + bonus + timeBonus;
    if (total !== 0) {
      actions().writeChroma({
        sessionId: grid.sessionId, teamId: team.id, amount: total,
        source: 'minigame', minigameId: grid.minigameId,
        reason: `Color Grid: ${correct} correct${bonus ? ' + perfect bonus' : ''}${timeBonus ? ` + ${remainingSec}s remaining` : ''}`
      });
    }
    perTeam.push({ team_id: team.id, name: team.name, color: team.color, correct, wrong: 0, points: total, time_bonus: timeBonus });
  }

  grid.finalCells = grid.cells.map((row) => [...row]);
  grid.result = { per_cell: perCell, per_team: perTeam, perfect: allMatch, cause };

  // Mole reveal — this is the public moment. Outcome may still be pending
  // (the host taps Hit/Missed from the Admin panel; Stage updates live).
  if (grid.moleAssignmentId) {
    const a = mole().getAssignment(grid.moleAssignmentId);
    if (a && a.outcome !== 'voided') {
      const mteam = grid.teams.find((t) => t.id === a.team_id);
      grid.moleReveal = {
        assignment_id: a.id,
        team_id: a.team_id,
        team_name: mteam?.name, team_color: mteam?.color,
        objective: a.objective_text, reward: a.reward, outcome: a.outcome
      };
    }
  }

  db.prepare("UPDATE grid_rounds SET final_state = ?, scores = ?, ended_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(grid.finalCells), JSON.stringify(scores), grid.roundId);

  grid.phase = 'scored';
  fireNodeRed('grid.scored', {
    scores: Object.fromEntries(perTeam.map((t) => [t.color, t.correct])),
    perfect: allMatch
  });
  broadcastState();
  push();
}

// Mole outcome resolved after scoring — refresh the Stage reveal live.
function refreshMoleReveal() {
  if (!grid || grid.phase !== 'scored' || !grid.moleAssignmentId) return;
  const a = mole().getAssignment(grid.moleAssignmentId);
  if (a && grid.moleReveal) {
    grid.moleReveal.outcome = a.outcome;
    push();
  }
}

// ============================================================
// end
// ============================================================
// Called by actions.endMinigame (admin End Game) — score if mid-build, then clear.
function stop() {
  if (!grid) return;
  if (!grid.finalized && grid.buildStarted) score('admin_end');
  if (!grid.finalized) {
    // Ended during the first reveal: nothing was built, close the round unscored.
    db.prepare("UPDATE grid_rounds SET ended_at = datetime('now') WHERE id = ?").run(grid.roundId);
  }
  clearRevealTick();
  grid = null;
  emit({ active: false });
}

function onTimerExpired() {      // Phase 1 build timer hit zero
  if (grid && !grid.finalized && grid.phase === 'build') score('timer_expired');
}

function isActive() { return !!grid; }
function activeMoleAssignmentId() { return grid?.moleAssignmentId ?? null; }

module.exports = {
  setEmitter, snapshot, preflight, launch, stop, isActive, onTimerExpired,
  recordPlacement, setFullState, score, revealAgain,
  setMoleAssignment, activeMoleAssignmentId, refreshMoleReveal
};
