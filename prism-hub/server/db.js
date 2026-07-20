// db.js — SQLite persistence layer for the Prism Dilemma Hub.
// All state that must survive a restart lives here. The Chroma ledger is
// append-only: totals are ALWAYS computed as SUM(amount) of non-voided rows.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'prism.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  mode                 TEXT NOT NULL CHECK (mode IN ('gameshow','escaperoom')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('setup','active','paused','complete')),
  current_round        INTEGER NOT NULL DEFAULT 1,
  active_minigame_id   TEXT,
  active_minigame_mode TEXT,
  started_at           TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at             TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  color      TEXT NOT NULL CHECK (color IN ('red','blue','green','yellow','solo')),
  name       TEXT NOT NULL
);

-- APPEND-ONLY. Never UPDATE amount, never DELETE. Undo = voided=1.
CREATE TABLE IF NOT EXISTS chroma_ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     INTEGER NOT NULL REFERENCES sessions(id),
  team_id        INTEGER NOT NULL REFERENCES teams(id),
  amount         INTEGER NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('manual','nodered','minigame','powerup','trade','correction')),
  minigame_id    TEXT,
  reason         TEXT NOT NULL DEFAULT '',
  trade_group_id TEXT,
  voided         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_team ON chroma_ledger(team_id, voided);
CREATE INDEX IF NOT EXISTS idx_ledger_session ON chroma_ledger(session_id);

-- Territories are physical zones and persist across sessions.
-- Starting a new session resets owner to 'none' and unlocks all of them.
CREATE TABLE IF NOT EXISTS territories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  owner      TEXT NOT NULL DEFAULT 'none' CHECK (owner IN ('red','blue','green','yellow','none')),
  nodered_id TEXT NOT NULL DEFAULT '',
  locked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS powerup_defs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT,
  modes       TEXT NOT NULL DEFAULT '["gameshow","escaperoom"]',
  effect_type TEXT NOT NULL CHECK (effect_type IN ('steal_territory','chroma_bonus','announcement_only')),
  config      TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS powerup_instances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  team_id    INTEGER NOT NULL REFERENCES teams(id),
  def_id     TEXT NOT NULL REFERENCES powerup_defs(id),
  used       INTEGER NOT NULL DEFAULT 0,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per team when a session ends. Feeds monthly/all-time bests.
CREATE TABLE IF NOT EXISTS run_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       INTEGER NOT NULL,
  mode             TEXT NOT NULL,
  team_name        TEXT NOT NULL,
  final_chroma     INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  ended_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Phase 2: question engine ============
-- One engine, two banks (trivia_twist / puzzle_pass). See docs/QUESTION_ENGINE.md.
CREATE TABLE IF NOT EXISTS question_banks (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  bank_id    TEXT NOT NULL REFERENCES question_banks(id),
  name       TEXT NOT NULL,
  color      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Never hard-deleted while referenced by a question_result: soft-delete via active=0.
CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  text        TEXT NOT NULL,
  image       TEXT,
  base_points INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_cat ON questions(category_id, active);

CREATE TABLE IF NOT EXISTS answers (
  id          TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  letter      TEXT NOT NULL CHECK (letter IN ('A','B','C','D')),
  text        TEXT NOT NULL,
  is_correct  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_answers_q ON answers(question_id);

CREATE TABLE IF NOT EXISTS quiz_runs (
  id           TEXT PRIMARY KEY,
  session_id   INTEGER NOT NULL,
  minigame_id  TEXT NOT NULL,
  mode         TEXT NOT NULL,
  attempt_no   INTEGER NOT NULL DEFAULT 1,
  category_ids TEXT,               -- JSON array, escape room only
  final_score  INTEGER,
  counted      INTEGER NOT NULL DEFAULT 1,  -- escape room: only the newest run counts
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_session ON quiz_runs(session_id, minigame_id);

CREATE TABLE IF NOT EXISTS question_results (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES quiz_runs(id),
  question_id    TEXT NOT NULL,
  team_id        INTEGER NOT NULL,
  selected       TEXT,             -- 'A'..'D', null = timed out
  correct        INTEGER NOT NULL DEFAULT 0,
  points_awarded INTEGER NOT NULL DEFAULT 0,  -- signed; includes streak bonus / pass outcomes
  was_passed     INTEGER NOT NULL DEFAULT 0,
  passed_from_team_id INTEGER,
  answered_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_results_run ON question_results(run_id);

-- ============ Phase 3: mole objectives ============
-- Text objectives delivered via Node-RED (mole.assigned). The Hub never
-- displays the objective on Stage; delivery hardware is Node-RED's problem.
-- See docs/MOLE_SYSTEM.md.
CREATE TABLE IF NOT EXISTS mole_objectives (
  id           TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  minigame_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array; [] = usable with any minigame
  modes        TEXT NOT NULL DEFAULT '["gameshow"]',
  reward       INTEGER,                      -- null = use the minigame's mole_reward
  weight       INTEGER NOT NULL DEFAULT 1,   -- higher = drawn more often
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mole_assignments (
  id             TEXT PRIMARY KEY,
  session_id     INTEGER NOT NULL,
  minigame_id    TEXT NOT NULL,
  round_number   INTEGER,
  team_id        INTEGER NOT NULL,
  objective_id   TEXT,                        -- null for auto-generated (trivia exact-score)
  objective_text TEXT NOT NULL,               -- snapshot; survives edits to the library
  reward         INTEGER NOT NULL DEFAULT 0,
  outcome        TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','hit','missed','voided')),
  auto_scored    INTEGER NOT NULL DEFAULT 0,  -- trivia exact-score moles resolve themselves
  delivered      INTEGER NOT NULL DEFAULT 0,  -- did the mole.assigned webhook succeed
  assigned_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_mole_session ON mole_assignments(session_id, outcome);

-- ============ Phase 3: Color Grid ============
-- Append-only placements, like the Chroma ledger: current shelf state is the
-- latest placement per cell, and the full history replays for dispute review.
CREATE TABLE IF NOT EXISTS grid_puzzles (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  rows       INTEGER NOT NULL,
  cols       INTEGER NOT NULL,
  pattern    TEXT NOT NULL,                   -- JSON 2D array: 'red'|'blue'|'green'|'yellow'|'empty'
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  modes      TEXT NOT NULL DEFAULT '["gameshow","escaperoom"]',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grid_rounds (
  id                 TEXT PRIMARY KEY,
  session_id         INTEGER NOT NULL,
  puzzle_id          TEXT NOT NULL,
  mode               TEXT NOT NULL,
  mole_assignment_id TEXT,
  reveal_seconds     INTEGER NOT NULL,
  final_state        TEXT,                    -- JSON snapshot at scoring
  scores             TEXT,                    -- JSON { team_id: correct_count }
  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_grid_rounds_session ON grid_rounds(session_id);

CREATE TABLE IF NOT EXISTS grid_placements (
  id        TEXT PRIMARY KEY,
  round_id  TEXT NOT NULL REFERENCES grid_rounds(id),
  row       INTEGER NOT NULL,
  col       INTEGER NOT NULL,
  color     TEXT NOT NULL,                    -- 'red'|'blue'|'green'|'yellow'|'empty'
  tag_id    TEXT,
  team_id   INTEGER,
  placed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_grid_placements_round ON grid_placements(round_id, row, col);

-- Phase 3: every minigame launch, so run_history.minigames_played is complete
-- even for games that never wrote a Chroma entry.
CREATE TABLE IF NOT EXISTS minigame_launches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL,
  minigame_id TEXT NOT NULL,
  mode        TEXT NOT NULL,
  launched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_launches_session ON minigame_launches(session_id);

-- Rolling diagnostics log of Node-RED traffic (both directions).
CREATE TABLE IF NOT EXISTS nodered_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  direction  TEXT NOT NULL CHECK (direction IN ('in','out')),
  event      TEXT NOT NULL,
  url        TEXT,
  payload    TEXT,
  status     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- migrations on existing DBs ----------
// Phase 2 adds quiz_run_id to the ledger so a superseded escape-room attempt's
// entries can be voided as a group. ALTER only if the column is missing.
if (!db.prepare("PRAGMA table_info(chroma_ledger)").all().some((c) => c.name === 'quiz_run_id')) {
  db.exec('ALTER TABLE chroma_ledger ADD COLUMN quiz_run_id TEXT');
}

// Phase 3 extends run_history into the leaderboard/archive record.
{
  const cols = db.prepare('PRAGMA table_info(run_history)').all().map((c) => c.name);
  if (!cols.includes('player_names')) db.exec('ALTER TABLE run_history ADD COLUMN player_names TEXT');
  if (!cols.includes('minigames_played')) db.exec("ALTER TABLE run_history ADD COLUMN minigames_played TEXT NOT NULL DEFAULT '[]'");
  if (!cols.includes('notes')) db.exec('ALTER TABLE run_history ADD COLUMN notes TEXT');
  // visible=0 hides staff test runs from the public boards without deleting them.
  if (!cols.includes('visible')) db.exec('ALTER TABLE run_history ADD COLUMN visible INTEGER NOT NULL DEFAULT 1');
}

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  admin_pin: '1234',
  inbound_token: 'prism',
  nodered_base_url: '',        // e.g. http://nodered.local:1880 — outbound events POST to <base>/prism/<event>
  manifest_push_url: '',       // saved minigame configs are POSTed here for Pis to pick up
  // Phase 3: mole.assigned goes to its own URL — it usually points at a different
  // device than everything else (bench screen, receipt printer, TTS speaker).
  mole_webhook_url: '',
  // Phase 2: physical button map. Stage forwards raw event.code values; the Hub
  // maps them to actions here. Editable in Settings → Input (with Learn mode).
  button_map: JSON.stringify({ A: 'F13', B: 'F14', C: 'F15', D: 'F16', PASS: 'F17' })
};
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (!getSettingStmt.get(k)) setSettingStmt.run(k, v);
}
function getSetting(key) {
  const row = getSettingStmt.get(key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? '');
}
function setSetting(key, value) { setSettingStmt.run(key, String(value)); }

// ---------- seeds ----------
if (db.prepare('SELECT COUNT(*) AS c FROM territories').get().c === 0) {
  const ins = db.prepare('INSERT INTO territories (name, nodered_id) VALUES (?, ?)');
  ins.run('North Wall', 'north_wall');
  ins.run('Cell Block', 'cell_block');
  ins.run('The Pit', 'the_pit');
}

if (db.prepare('SELECT COUNT(*) AS c FROM powerup_defs').get().c === 0) {
  const ins = db.prepare('INSERT INTO powerup_defs (id, name, description, modes, effect_type, config) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run('chroma_heist', 'Chroma Heist', 'Steal any unlocked territory. It flips to your color instantly.',
    '["gameshow"]', 'steal_territory', '{}');
  ins.run('lockdown', 'Lockdown', 'Send another team to jail. Narrative only — no points are blocked.',
    '["gameshow"]', 'announcement_only', JSON.stringify({ template: '{team} sent {target} to jail', needs_target_team: true }));
  ins.run('get_out_free', 'Get Out Free', 'Immunity from jail.',
    '["gameshow"]', 'announcement_only', JSON.stringify({ template: '{team} is immune from jail' }));
  ins.run('super_hint', 'Super Hint', 'The gamemaster delivers a powerful hint.',
    '["escaperoom"]', 'announcement_only', JSON.stringify({ template: '{team} used a Super Hint' }));
}

// ---------- Phase 2 seeds: banks, categories, sample questions ----------
if (db.prepare('SELECT COUNT(*) AS c FROM question_banks').get().c === 0) {
  const { randomUUID } = require('crypto');
  const insBank = db.prepare('INSERT INTO question_banks (id, name) VALUES (?, ?)');
  insBank.run('trivia_twist', 'Trivia Twist');
  insBank.run('puzzle_pass', 'Puzzle Pass');

  const insCat = db.prepare('INSERT INTO categories (id, bank_id, name, color, sort_order) VALUES (?, ?, ?, ?, ?)');
  const insQ = db.prepare('INSERT INTO questions (id, category_id, text, image, base_points) VALUES (?, ?, ?, ?, ?)');
  const insA = db.prepare('INSERT INTO answers (id, question_id, letter, text, is_correct) VALUES (?, ?, ?, ?, ?)');

  // q(catId, text, answers[[text, correct?]], points, image?)
  function q(catId, text, answers, points = 100, image = null) {
    const qid = randomUUID();
    insQ.run(qid, catId, text, image, points);
    const letters = ['A', 'B', 'C', 'D'];
    answers.forEach(([t, correct], i) => insA.run(randomUUID(), qid, letters[i], t, correct ? 1 : 0));
  }
  function cat(bank, name, color, order) {
    const id = randomUUID();
    insCat.run(id, bank, name, color, order);
    return id;
  }

  // ---- Trivia Twist: text-leaning general trivia ----
  const ttSports = cat('trivia_twist', 'Sports', '#21D07A', 0);
  const ttScience = cat('trivia_twist', 'Science', '#2E86FF', 1);
  const ttGeo = cat('trivia_twist', 'Geography', '#FFC61A', 2);
  const ttGrab = cat('trivia_twist', 'Grab Bag', '#FF3B3B', 3);

  q(ttSports, 'How many players are on the court for one basketball team?', [['4'], ['5', true], ['6'], ['7']]);
  q(ttSports, 'In soccer, how long is a standard match (excluding stoppage time)?', [['60 minutes'], ['80 minutes'], ['90 minutes', true], ['120 minutes']]);
  q(ttSports, 'Which sport uses the term "strike" for knocking down all pins?', [['Bowling', true], ['Golf'], ['Darts'], ['Curling']]);
  q(ttScience, 'What planet is known as the Red Planet?', [['Venus'], ['Jupiter'], ['Mars', true], ['Saturn']]);
  q(ttScience, 'What gas do plants primarily absorb for photosynthesis?', [['Oxygen'], ['Carbon dioxide', true], ['Nitrogen'], ['Hydrogen']]);
  q(ttScience, 'How many bones are in the adult human body?', [['106'], ['186'], ['206', true], ['306']], 150);
  q(ttGeo, 'What is the longest river in the world (by most measures)?', [['Amazon'], ['Nile', true], ['Yangtze'], ['Mississippi']]);
  q(ttGeo, 'Which U.S. state has the most coastline?', [['California'], ['Florida'], ['Alaska', true], ['Texas']]);
  q(ttGeo, 'What is the capital of Australia?', [['Sydney'], ['Melbourne'], ['Canberra', true], ['Perth']], 150);
  q(ttGrab, 'How many colors are in a rainbow, traditionally?', [['5'], ['6'], ['7', true], ['8']]);
  q(ttGrab, 'What do you call a group of crows?', [['A murder', true], ['A parliament'], ['A gaggle'], ['A pod']]);
  q(ttGrab, 'Which month has 28 days?', [['February'], ['All of them', true]], 50);

  // ---- Puzzle Pass: image/visual-leaning ----
  const ppColor = cat('puzzle_pass', 'Colors', '#FF3B3B', 0);
  const ppLogic = cat('puzzle_pass', 'Logic', '#2E86FF', 1);
  const ppPattern = cat('puzzle_pass', 'Patterns', '#21D07A', 2);
  const ppRiddle = cat('puzzle_pass', 'Riddles', '#FFC61A', 3);

  q(ppColor, 'What color is the MIDDLE stripe in this image?', [['Red'], ['White', true], ['Green'], ['Black']], 100, '/uploads/seed-stripes.png');
  q(ppColor, 'Mixing blue and yellow paint gives you…', [['Purple'], ['Orange'], ['Green', true], ['Brown']]);
  q(ppColor, 'Which of these is NOT a primary color of light?', [['Red'], ['Green'], ['Blue'], ['Yellow', true]]);
  q(ppLogic, 'Which square is the odd one out in this grid?', [['Top left'], ['Center'], ['Bottom right', true], ['They all match']], 150, '/uploads/seed-oddgrid.png');
  q(ppLogic, 'What comes next: 2, 4, 8, 16, …?', [['18'], ['24'], ['32', true], ['64']]);
  q(ppLogic, 'If all Bloops are Razzies and all Razzies are Lazzies, are all Bloops definitely Lazzies?', [['Yes', true], ['No'], ['Only some'], ['Cannot tell']], 150);
  q(ppPattern, 'What comes next: circle, square, circle, square, …?', [['Triangle'], ['Circle', true], ['Square'], ['Star']], 50);
  q(ppPattern, 'A clock shows 3:15. What angle is between the hands (roughly)?', [['0°'], ['7.5°', true], ['30°'], ['90°']], 200);
  q(ppRiddle, 'What has keys but can\'t open locks?', [['A map'], ['A piano', true], ['A clock'], ['A book']]);
  q(ppRiddle, 'What gets wetter the more it dries?', [['A sponge'], ['A towel', true], ['Rain'], ['Soap']]);
  q(ppRiddle, 'The more you take, the more you leave behind. What are they?', [['Memories'], ['Footsteps', true], ['Photos'], ['Coins']]);
}

// ---------- Phase 3 seeds: mole objectives ----------
if (db.prepare('SELECT COUNT(*) AS c FROM mole_objectives').get().c === 0) {
  const { randomUUID } = require('crypto');
  const ins = db.prepare('INSERT INTO mole_objectives (id, text, minigame_ids, reward, weight) VALUES (?, ?, ?, ?, ?)');
  const seed = (text, minigameIds = [], reward = null, weight = 1) =>
    ins.run(randomUUID(), text, JSON.stringify(minigameIds), reward, weight);

  seed('Get your color into at least 2 corners.', ['color_grid']);
  seed('Make sure at least 3 cells end up wrong.', ['color_grid']);
  seed('Never let two of the same color sit next to each other.', ['color_grid']);
  seed('Fill an entire edge row or column with your color.', ['color_grid']);
  seed('Trade away every one of your own blocks before time runs out.', ['you_gave_me_your_word']);
  seed('End the round holding blocks from all four colors.', ['you_gave_me_your_word']);
  seed('Convince another team to make an obviously bad trade.', []);
  seed('Finish the round with fewer points than the team on your left.', []);
  seed('Get another team accused of being the mole.', [], null, 2);
  seed('Say the word "prism" out loud at least five times.', []);
  seed('Make sure your team never agrees on anything.', []);
  seed('Celebrate loudly every time an opposing team scores.', []);
  seed('Volunteer to go first, then take as long as possible.', []);
}

// ---------- Phase 3 seeds: Color Grid puzzles ----------
if (db.prepare('SELECT COUNT(*) AS c FROM grid_puzzles').get().c === 0) {
  const { randomUUID } = require('crypto');
  const ins = db.prepare('INSERT INTO grid_puzzles (id, name, rows, cols, pattern, difficulty) VALUES (?, ?, ?, ?, ?, ?)');
  const P = (name, difficulty, pattern) =>
    ins.run(randomUUID(), name, pattern.length, pattern[0].length, JSON.stringify(pattern), difficulty);
  const _ = 'empty', r = 'red', b = 'blue', g = 'green', y = 'yellow';

  P('Corners', 'easy', [
    [r, _, b],
    [_, g, _],
    [y, _, r]
  ]);
  P('Cross', 'easy', [
    [_, b, _],
    [b, r, b],
    [_, b, _]
  ]);
  P('Checker Four', 'medium', [
    [r, b, r, b],
    [b, r, b, r],
    [g, y, g, y],
    [y, g, y, g]
  ]);
  P('Diagonal Run', 'medium', [
    [g, _, _, y],
    [_, g, y, _],
    [_, y, g, _],
    [y, _, _, g]
  ]);
  P('Prism Burst', 'hard', [
    [_, _, r, _, _],
    [_, r, y, r, _],
    [r, y, b, y, r],
    [_, r, y, r, _],
    [_, _, r, _, _]
  ]);
  P('The Wall', 'hard', [
    [b, b, _, g, g, _],
    [b, _, r, r, _, g],
    [_, r, y, y, r, _],
    [_, r, y, y, r, _],
    [g, _, r, r, _, b],
    [g, g, _, b, b, _]
  ]);
}

// ---------- Phase 3 seeds: sample run records (so History demos immediately) ----------
if (db.prepare('SELECT COUNT(*) AS c FROM run_history').get().c === 0) {
  const ins = db.prepare(`
    INSERT INTO run_history (session_id, mode, team_name, final_chroma, duration_seconds, ended_at, player_names, minigames_played, notes)
    VALUES (0, 'escaperoom', ?, ?, ?, datetime('now', ?), ?, ?, 'Sample seed data — edit or hide from the History page')`);
  ins.run('The Chromanauts', 1240, 3480, '-2 days', JSON.stringify(['Ava', 'Ben', 'Cody']), JSON.stringify(['trivia_twist', 'color_grid']));
  ins.run('Grey Matter', 980, 3620, '-9 days', null, JSON.stringify(['puzzle_pass', 'color_grid']));
  ins.run('Hue Dunnit', 1105, 3300, '-16 days', JSON.stringify(['Dana', 'Eli']), JSON.stringify(['trivia_twist', 'puzzle_pass']));
  ins.run('Spectrum Squad', 860, 3555, '-40 days', null, JSON.stringify(['color_grid']));
  ins.run('Full Saturation', 1330, 3140, '-70 days', JSON.stringify(['Finn', 'Gio', 'Hana', 'Iris']), JSON.stringify(['trivia_twist', 'puzzle_pass', 'color_grid']));
}

// ---------- helpers ----------
function activeSession() {
  return db.prepare("SELECT * FROM sessions WHERE status != 'complete' ORDER BY id DESC LIMIT 1").get() || null;
}

function teamsForSession(sessionId) {
  return db.prepare('SELECT * FROM teams WHERE session_id = ? ORDER BY id').all(sessionId);
}

// Chroma is DERIVED. This is the only place a total ever comes from.
const chromaStmt = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM chroma_ledger WHERE team_id = ? AND voided = 0');
function chromaForTeam(teamId) { return chromaStmt.get(teamId).total; }

function resolveTeam(sessionId, teamRef) {
  // Node-RED may send a color string ("red") or a numeric team id.
  if (teamRef === undefined || teamRef === null) return null;
  const asNum = Number(teamRef);
  if (Number.isInteger(asNum) && String(asNum) === String(teamRef)) {
    return db.prepare('SELECT * FROM teams WHERE id = ? AND session_id = ?').get(asNum, sessionId) || null;
  }
  return db.prepare('SELECT * FROM teams WHERE session_id = ? AND color = ?').get(sessionId, String(teamRef).toLowerCase()) || null;
}

function logNodeRed(direction, event, url, payload, status) {
  db.prepare('INSERT INTO nodered_log (direction, event, url, payload, status) VALUES (?, ?, ?, ?, ?)')
    .run(direction, event, url || null, JSON.stringify(payload ?? null), status == null ? null : String(status));
  // keep the table from growing forever
  db.prepare("DELETE FROM nodered_log WHERE id NOT IN (SELECT id FROM nodered_log ORDER BY id DESC LIMIT 500)").run();
}

function bests() {
  // visible=0 rows are staff test runs — excluded from every public board.
  const alltime = db.prepare("SELECT MAX(final_chroma) AS v FROM run_history WHERE mode = 'escaperoom' AND visible = 1").get().v;
  const monthly = db.prepare("SELECT MAX(final_chroma) AS v FROM run_history WHERE mode = 'escaperoom' AND visible = 1 AND strftime('%Y-%m', ended_at) = strftime('%Y-%m', 'now')").get().v;
  return { monthly: monthly ?? null, alltime: alltime ?? null };
}

module.exports = { db, getSetting, setSetting, activeSession, teamsForSession, chromaForTeam, resolveTeam, logNodeRed, bests };
