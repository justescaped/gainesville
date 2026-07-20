// quiz.js — the ONE question engine. Trivia Twist and Puzzle Pass are two
// instances of this code with different question banks (bank_id == minigame id).
// There is deliberately no per-minigame scoring/timing/rendering logic anywhere.
//
// Phases:
//   category_pick  (escape room only)  → question ⇄ feedback → ended
//   intro          (game show turn transition) → question ⇄ feedback → ended
//
// The engine is server-authoritative: buttons/admin only send intents; every
// countdown, score, and turn decision happens here and is broadcast as a
// 'quiz' snapshot. The Stage renders; it never decides.
const { randomUUID } = require('crypto');
const { db } = require('./db');
const { fireNodeRed } = require('./core');
const { broadcastState } = require('./state');

// lazy to avoid a circular require (actions → quiz → actions)
let _actions = null;
const actions = () => (_actions ??= require('./actions'));

let emit = () => {};           // set by index.js: (snapshot) => io.emit('quiz', snapshot)
function setEmitter(fn) { emit = fn; }

const FEEDBACK_MS = 3000;
const INTRO_MS = 2000;

let quiz = null;               // the single active quiz, or null
let tick = null;               // 100ms interval while a question is live
let phaseTimeout = null;       // feedback/intro transitions

// ============================================================
// snapshot
// ============================================================
function snapshot() {
  if (!quiz) return { active: false };
  const s = {
    active: true,
    minigame_id: quiz.minigameId,
    mode: quiz.mode,
    phase: quiz.phase,
    run_id: quiz.runId || null,
    scores: quiz.scores,
    streaks: quiz.streaks,
    passes: quiz.passes,
    answering_team_id: quiz.answeringTeamId ?? null,
    turn_team_id: quiz.mode === 'gameshow' ? quiz.teams[quiz.turnIndex]?.id ?? null : null,
    passed_from_team_id: quiz.passedFromTeamId ?? null,
    question_seconds: quiz.settings.question_seconds,
    // mole: present in the payload for the Admin panel; the Stage deliberately
    // never renders it (see docs/QUESTION_ENGINE.md).
    mole_team_id: quiz.mode === 'gameshow' ? quiz.moleTeamId : null,
    mole_target: quiz.mode === 'gameshow' ? quiz.settings.mole_target : null,
    attempt: quiz.mode === 'escaperoom'
      ? { no: quiz.attemptNo, max: quiz.settings.max_attempts, previous_scores: quiz.previousScores }
      : null
  };
  if (quiz.phase === 'category_pick') {
    s.pick = {
      needed: quiz.settings.categories_per_attempt,
      highlight: quiz.pickHighlight,
      categories: quiz.pickCategories.map((c, i) => ({
        id: c.id, name: c.name, color: c.color, question_count: c.question_count,
        locked: c.locked, selected: quiz.pickSelected.includes(c.id), highlighted: i === quiz.pickHighlight
      }))
    };
  }
  if (quiz.phase === 'intro') s.intro_team_id = quiz.answeringTeamId;
  if (quiz.phase === 'question' || quiz.phase === 'feedback') {
    s.question = {
      number: quiz.questionNumber,
      total: quiz.plannedTotal,   // null = open-ended (until timer expires)
      text: quiz.question.text,
      image: quiz.question.image,
      value: quiz.questionValue,
      answers: quiz.question.answers.map((a) => ({ letter: a.letter, text: a.text })),
      was_passed: quiz.wasPassed,
      correct_letter_admin: quiz.question.answers.find((a) => a.is_correct)?.letter ?? null
    };
    s.pass_available = quiz.mode === 'gameshow' && !quiz.wasPassed && (quiz.passes[quiz.answeringTeamId] ?? 0) > 0;
  }
  if (quiz.phase === 'question') s.question_remaining_ms = Math.max(0, quiz.deadline - Date.now());
  if (quiz.phase === 'feedback') s.feedback = quiz.feedback;
  if (quiz.phase === 'ended') s.ended = quiz.endedPayload;
  return s;
}
const push = () => emit(snapshot());

// ============================================================
// helpers
// ============================================================
function activeQuestionsInBank(bankId) {
  return db.prepare(`
    SELECT q.* FROM questions q JOIN categories c ON c.id = q.category_id
    WHERE c.bank_id = ? AND q.active = 1`).all(bankId);
}

function loadAnswers(questionId) {
  return db.prepare('SELECT * FROM answers WHERE question_id = ? ORDER BY letter').all(questionId);
}

function categoriesWithCounts(bankId) {
  return db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM questions q WHERE q.category_id = c.id AND q.active = 1) AS question_count
    FROM categories c WHERE c.bank_id = ? ORDER BY c.sort_order, c.name`).all(bankId);
}

function usedCategoryIds(sessionId, minigameId) {
  const rows = db.prepare('SELECT category_ids FROM quiz_runs WHERE session_id = ? AND minigame_id = ? AND category_ids IS NOT NULL').all(sessionId, minigameId);
  const used = new Set();
  for (const r of rows) for (const id of JSON.parse(r.category_ids)) used.add(id);
  return used;
}

function attemptsUsed(sessionId, minigameId) {
  return db.prepare('SELECT COUNT(*) AS c FROM quiz_runs WHERE session_id = ? AND minigame_id = ?').get(sessionId, minigameId).c;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function questionValue(q) {
  const st = quiz.settings;
  if (!st.randomize_points) return q.base_points;
  const min = st.points_min ?? 25, max = st.points_max ?? 200;
  return Math.round((min + Math.random() * (max - min)) / 5) * 5;
}

function writeQuizChroma(teamId, amount, reason) {
  if (!amount) return;
  actions().writeChroma({
    sessionId: quiz.sessionId, teamId, amount,
    source: 'minigame', reason, minigameId: quiz.minigameId, quizRunId: quiz.runId
  });
  quiz.scores[teamId] = (quiz.scores[teamId] || 0) + amount;
}

function clearTimers() {
  if (tick) { clearInterval(tick); tick = null; }
  if (phaseTimeout) { clearTimeout(phaseTimeout); phaseTimeout = null; }
}

// ============================================================
// lifecycle
// ============================================================
// Throws (blocking the launch) if escape-room attempts are exhausted or too few
// categories remain — actions.startMinigame calls this BEFORE flipping state.
function preflight(sessionId, minigameId, mode, settings) {
  if (mode !== 'escaperoom') return;
  const used = attemptsUsed(sessionId, minigameId);
  if (used >= (settings.max_attempts ?? 3)) throw new Error('No attempts remaining');
  const usedCats = usedCategoryIds(sessionId, minigameId);
  const selectable = categoriesWithCounts(minigameId).filter((c) => c.question_count > 0 && !usedCats.has(c.id));
  if (selectable.length < (settings.categories_per_attempt ?? 4)) {
    throw new Error(`Only ${selectable.length} unused categories left — ${settings.categories_per_attempt ?? 4} needed. Add categories or reset the session.`);
  }
}

function launch({ sessionId, minigameId, mode, manifest, teams }) {
  clearTimers();
  const settings = manifest[mode];
  quiz = {
    sessionId, minigameId, mode, settings,
    teams,                                   // session order = turn order
    runId: null,
    phase: null,
    scores: {}, streaks: {}, passes: {},
    askedIds: new Set(),
    questionNumber: 0, plannedTotal: null,
    turnIndex: -1,                           // advanced to 0 on first question
    answeringTeamId: null, passedFromTeamId: null, wasPassed: false,
    question: null, questionValue: 0, deadline: 0, feedback: null,
    moleTeamId: null, endedPayload: null,
    attemptNo: 1, previousScores: [], pool: null,
    finalized: false
  };
  for (const t of teams) { quiz.scores[t.id] = 0; quiz.streaks[t.id] = 0; }

  if (mode === 'gameshow') {
    quiz.runId = randomUUID();
    db.prepare('INSERT INTO quiz_runs (id, session_id, minigame_id, mode) VALUES (?, ?, ?, ?)')
      .run(quiz.runId, sessionId, minigameId, mode);
    for (const t of teams) quiz.passes[t.id] = settings.max_passes_per_team ?? 3;
    quiz.pool = shuffle(activeQuestionsInBank(minigameId));
    quiz.plannedTotal = settings.question_count > 0 ? Math.min(settings.question_count, quiz.pool.length) : null;
    if (settings.has_mole) {
      quiz.moleTeamId = teams[Math.floor(Math.random() * teams.length)].id;
      fireNodeRed('quiz.mole_assigned', { team: teams.find((t) => t.id === quiz.moleTeamId).color });
    }
    fireNodeRed('quiz.started', { minigame_id: minigameId, mode, team_count: teams.length });
    nextTurn();
  } else {
    // escape room: pick categories first; the run row is created on confirm so
    // an aborted pick doesn't burn an attempt or lock categories.
    quiz.attemptNo = attemptsUsed(sessionId, minigameId) + 1;
    quiz.previousScores = db.prepare(
      'SELECT final_score FROM quiz_runs WHERE session_id = ? AND minigame_id = ? ORDER BY started_at').all(sessionId, minigameId)
      .map((r) => r.final_score);
    const usedCats = usedCategoryIds(sessionId, minigameId);
    quiz.pickCategories = categoriesWithCounts(minigameId)
      .map((c) => ({ ...c, locked: usedCats.has(c.id) || c.question_count === 0 }));
    quiz.pickSelected = [];
    quiz.pickHighlight = quiz.pickCategories.findIndex((c) => !c.locked);
    quiz.phase = 'category_pick';
    fireNodeRed('quiz.started', { minigame_id: minigameId, mode, team_count: teams.length });
    push();
  }
}

function confirmCategories() {
  const st = quiz.settings;
  quiz.runId = randomUUID();
  db.prepare('INSERT INTO quiz_runs (id, session_id, minigame_id, mode, attempt_no, category_ids) VALUES (?, ?, ?, ?, ?, ?)')
    .run(quiz.runId, quiz.sessionId, quiz.minigameId, quiz.mode, quiz.attemptNo, JSON.stringify(quiz.pickSelected));
  // draw N per category, shuffle together
  const pool = [];
  for (const catId of quiz.pickSelected) {
    const qs = shuffle(db.prepare('SELECT * FROM questions WHERE category_id = ? AND active = 1').all(catId))
      .slice(0, st.questions_per_category ?? 5);
    pool.push(...qs);
  }
  quiz.pool = shuffle(pool);
  quiz.plannedTotal = quiz.pool.length;
  quiz.answeringTeamId = quiz.teams[0].id;
  broadcastState(); // attempts info changed
  nextQuestion();
}

// ---- game show turn rotation ----
function nextTurn() {
  quiz.turnIndex = (quiz.turnIndex + 1) % quiz.teams.length;
  quiz.answeringTeamId = quiz.teams[quiz.turnIndex].id;
  quiz.phase = 'intro';
  push();
  phaseTimeout = setTimeout(nextQuestion, INTRO_MS);
}

function drawQuestion() {
  while (quiz.pool.length) {
    const q = quiz.pool.shift();
    if (!quiz.askedIds.has(q.id)) return q;
  }
  return null;
}

function nextQuestion() {
  clearTimers();
  if (quiz.plannedTotal !== null && quiz.questionNumber >= quiz.plannedTotal) return endQuiz('question_count_reached');
  const q = drawQuestion();
  if (!q) return endQuiz('pool_exhausted');
  quiz.askedIds.add(q.id);
  quiz.question = { ...q, answers: loadAnswers(q.id) };
  quiz.questionValue = questionValue(q);
  quiz.questionNumber += 1;
  quiz.wasPassed = false;
  quiz.passedFromTeamId = null;
  quiz.phase = 'question';
  quiz.deadline = Date.now() + quiz.settings.question_seconds * 1000;
  fireNodeRed('quiz.question', {
    question_id: q.id,
    team: quiz.teams.find((t) => t.id === quiz.answeringTeamId)?.color ?? null,
    question_number: quiz.questionNumber
  });
  push();
  tick = setInterval(() => {
    if (Date.now() >= quiz.deadline) resolve(null);
    else push();
  }, 100);
}

// ============================================================
// resolution — `selected` is 'A'..'D' or null for timeout
// ============================================================
function resolve(selected) {
  clearTimers();
  const teamId = quiz.answeringTeamId;
  const team = quiz.teams.find((t) => t.id === teamId);
  const correctAns = quiz.question.answers.find((a) => a.is_correct);
  const correct = selected !== null && selected === correctAns.letter;
  const value = quiz.questionValue;
  let points = 0;
  let streakAfter;
  let passOutcome = null;

  if (correct) {
    streakAfter = (quiz.streaks[teamId] || 0) + 1;
    quiz.streaks[teamId] = streakAfter;
    const bonus = Number(quiz.settings.streak_ladder?.[String(streakAfter)] ?? 0);
    points = value + bonus;
    writeQuizChroma(teamId, points,
      `${quiz.question.text.length > 40 ? quiz.question.text.slice(0, 40) + '…' : quiz.question.text} — correct${bonus ? ` (streak ×${streakAfter}: +${bonus})` : ''}`);
  } else {
    streakAfter = 0;
    quiz.streaks[teamId] = 0;
  }

  // pass settlement (game show only; wasPassed means teamId is the receiver)
  if (quiz.wasPassed && quiz.passedFromTeamId) {
    const passer = quiz.teams.find((t) => t.id === quiz.passedFromTeamId);
    if (correct) {
      writeQuizChroma(passer.id, -2 * value, `Pass penalty: ${passer.name} passed, ${team.name} answered correctly`);
      quiz.streaks[passer.id] = 0; // a pass that backfires breaks the passer's run
      passOutcome = 'backfired';
    } else {
      writeQuizChroma(passer.id, 2 * value, `Pass reward: ${passer.name} passed, ${team.name} missed`);
      passOutcome = 'paid_off';
    }
  }

  db.prepare(`INSERT INTO question_results (id, run_id, question_id, team_id, selected, correct, points_awarded, was_passed, passed_from_team_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), quiz.runId, quiz.question.id, teamId, selected, correct ? 1 : 0, points, quiz.wasPassed ? 1 : 0, quiz.passedFromTeamId);

  fireNodeRed('quiz.answered', { team: team.color, correct, points, streak: streakAfter });

  quiz.phase = 'feedback';
  quiz.feedback = {
    selected, correct, correct_letter: correctAns.letter, points,
    streak: streakAfter, team_id: teamId, pass_outcome: passOutcome,
    passed_from_team_id: quiz.passedFromTeamId, value
  };
  push();

  phaseTimeout = setTimeout(() => {
    if (quiz.mode === 'gameshow') {
      // turn resumes from the team after the ORIGINAL asker (the passer if passed)
      if (quiz.wasPassed && quiz.passedFromTeamId) {
        quiz.turnIndex = quiz.teams.findIndex((t) => t.id === quiz.passedFromTeamId);
      }
      nextTurn();
    } else {
      nextQuestion();
    }
  }, FEEDBACK_MS);
}

function doPass() {
  if (quiz.mode !== 'gameshow' || quiz.wasPassed) return;
  const asker = quiz.answeringTeamId;
  if ((quiz.passes[asker] ?? 0) <= 0) return;
  quiz.passes[asker] -= 1;
  quiz.passedFromTeamId = asker;
  quiz.wasPassed = true;
  const idx = quiz.teams.findIndex((t) => t.id === asker);
  quiz.answeringTeamId = quiz.teams[(idx + 1) % quiz.teams.length].id;
  quiz.deadline = Date.now() + quiz.settings.question_seconds * 1000; // fresh clock for the receiver
  fireNodeRed('quiz.passed', {
    from_team: quiz.teams[idx].color,
    to_team: quiz.teams.find((t) => t.id === quiz.answeringTeamId).color
  });
  push();
}

// ============================================================
// input — the ONLY entry point for buttons (physical or admin fallback)
// ============================================================
function input(button) {
  if (!quiz) return;
  if (quiz.phase === 'category_pick') {
    const cats = quiz.pickCategories;
    if (['A', 'B', 'C', 'D'].includes(button)) {
      // advance highlight to the next selectable category
      for (let step = 1; step <= cats.length; step++) {
        const i = (quiz.pickHighlight + step) % cats.length;
        if (!cats[i].locked) { quiz.pickHighlight = i; break; }
      }
      push();
    } else if (button === 'PASS') {
      togglePick(cats[quiz.pickHighlight]?.id);
    }
    return;
  }
  if (quiz.phase !== 'question') return; // locked out during intro/feedback/ended
  if (button === 'PASS') return doPass();
  if (['A', 'B', 'C', 'D'].includes(button)) {
    if (!quiz.question.answers.some((a) => a.letter === button)) return; // no such answer on this question
    resolve(button);
  }
}

function togglePick(categoryId) {
  if (!quiz || quiz.phase !== 'category_pick' || !categoryId) return;
  const cat = quiz.pickCategories.find((c) => c.id === categoryId);
  if (!cat || cat.locked) return;
  const i = quiz.pickSelected.indexOf(categoryId);
  if (i >= 0) quiz.pickSelected.splice(i, 1);
  else quiz.pickSelected.push(categoryId);
  if (quiz.pickSelected.length >= quiz.settings.categories_per_attempt) confirmCategories();
  else push();
}

// ============================================================
// admin controls
// ============================================================
function adminSkip() { // abandon question, same team stays up, no scoring
  if (!quiz || quiz.phase !== 'question') return;
  clearTimers();
  quiz.questionNumber -= 1; // it didn't count
  if (quiz.mode === 'gameshow') { quiz.turnIndex -= 1; nextTurn(); }
  else nextQuestion();
}

function adminAdvanceTurn() { // skip the current team entirely
  if (!quiz || quiz.mode !== 'gameshow' || quiz.phase !== 'question') return;
  clearTimers();
  quiz.questionNumber -= 1;
  nextTurn();
}

function adminSetMole(teamId) {
  if (!quiz || quiz.mode !== 'gameshow') return;
  quiz.moleTeamId = teamId ?? null;
  if (teamId) fireNodeRed('quiz.mole_assigned', { team: quiz.teams.find((t) => t.id === teamId)?.color });
  push();
}

// ============================================================
// end — natural (count/pool/timer) or via admin End Game
// ============================================================
function endQuiz(cause) {
  if (!quiz || quiz.finalized) return;
  quiz.finalized = true;
  clearTimers();

  let moleHit = null;
  if (quiz.mode === 'gameshow' && quiz.moleTeamId) {
    moleHit = quiz.scores[quiz.moleTeamId] === quiz.settings.mole_target;
    if (moleHit) {
      writeQuizChroma(quiz.moleTeamId, quiz.settings.mole_reward ?? 0,
        `Mole hit ${quiz.settings.mole_target} exactly — reward`);
    }
  }

  if (quiz.runId) {
    // escape room: the solo team's net score for this run; game show: n/a
    const finalScore = quiz.mode === 'escaperoom' ? (quiz.scores[quiz.teams[0].id] || 0) : null;
    db.prepare("UPDATE quiz_runs SET final_score = ?, ended_at = datetime('now') WHERE id = ?")
      .run(finalScore, quiz.runId);

    if (quiz.mode === 'escaperoom') {
      // Only the most recent attempt counts: flag older runs and VOID their
      // ledger entries so the session total reflects this run alone.
      const older = db.prepare('SELECT id FROM quiz_runs WHERE session_id = ? AND minigame_id = ? AND id != ?')
        .all(quiz.sessionId, quiz.minigameId, quiz.runId);
      db.prepare('UPDATE quiz_runs SET counted = 0 WHERE session_id = ? AND minigame_id = ? AND id != ?')
        .run(quiz.sessionId, quiz.minigameId, quiz.runId);
      db.prepare('UPDATE quiz_runs SET counted = 1 WHERE id = ?').run(quiz.runId);
      for (const r of older) {
        db.prepare('UPDATE chroma_ledger SET voided = 1 WHERE quiz_run_id = ?').run(r.id);
      }
    }
  }

  const scores = quiz.teams.map((t) => ({ team_id: t.id, name: t.name, color: t.color, score: quiz.scores[t.id] || 0 }));
  quiz.endedPayload = {
    cause, scores,
    mole_team_id: quiz.moleTeamId,
    mole_hit: moleHit,
    mole_target: quiz.mode === 'gameshow' ? quiz.settings.mole_target : null,
    attempt: quiz.mode === 'escaperoom' ? { no: quiz.attemptNo, max: quiz.settings.max_attempts } : null
  };
  quiz.phase = 'ended';
  fireNodeRed('quiz.ended', {
    scores: Object.fromEntries(scores.map((s) => [s.color, s.score])),
    mole_team: quiz.moleTeamId ? quiz.teams.find((t) => t.id === quiz.moleTeamId)?.color : null,
    mole_hit_target: moleHit
  });
  broadcastState(); // ledger voids / attempts changed
  push();
}

// Called by actions.endMinigame (admin End Game) — finalize if mid-run, then clear.
function stop() {
  if (!quiz) return;
  if (!quiz.finalized && (quiz.runId || quiz.phase === 'category_pick')) {
    if (quiz.phase === 'category_pick') { /* nothing started; no attempt burned */ }
    else endQuiz('admin_end');
  }
  clearTimers();
  quiz = null;
  emit({ active: false });
}

function onTimerExpired() { // Phase 1 minigame timer hit zero while a quiz runs
  if (quiz && !quiz.finalized && quiz.phase !== 'category_pick') endQuiz('timer_expired');
}

function isActive() { return !!quiz; }

module.exports = {
  setEmitter, snapshot, preflight, launch, input, togglePick,
  adminSkip, adminAdvanceTurn, adminSetMole, endQuiz, stop, onTimerExpired, isActive,
  attemptsUsed, usedCategoryIds, categoriesWithCounts
};
