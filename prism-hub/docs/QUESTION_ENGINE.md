# The Question Engine (Phase 2)

One engine powers **Trivia Twist** and **Puzzle Pass**. They are the same code
(`server/quiz.js`) with different question banks — the bank id equals the
minigame id. There is deliberately no duplicated scoring, timing, or rendering
logic between them. Puzzle Pass leans on question images; Trivia Twist leans on
text; the engine doesn't care.

## How it fits Phase 1

- A manifest with `"ui_component": "quiz"` makes a minigame quiz-powered.
  `actions.startMinigame` detects it, validates preconditions (`preflight`),
  and calls `quiz.launch()`. `actions.endMinigame` calls `quiz.stop()`.
- All Chroma still flows through the Phase 1 append-only ledger
  (`source: minigame`, tagged with `quiz_run_id`). Undo, totals, and the Stage
  Chroma strip all come from the same place as everything else.
- The Phase 1 minigame timer keeps running alongside as the *overall* clock;
  when it expires, the quiz ends (`onTimerExpired`).
- The engine broadcasts a `quiz` snapshot over Socket.IO on every change (and
  ~10×/sec during a question countdown). The Stage renders the snapshot; it
  never counts time or computes points. Same rule as Phase 1: server decides,
  clients draw.

## The state machine

```
game show:    launch → intro → question ⇄ feedback → intro → … → ended
escape room:  launch → category_pick → question ⇄ feedback → … → ended
```

`intro` = the "TEAM BLUE — YOU'RE UP" transition (2s). `feedback` = the answer
reveal (3s). `ended` stays on the final-scores screen until the admin presses
**End Game**, which returns the Stage to the Phase 1 leaderboard.

## Answers and the fifth button

Questions have **2–4 answers (A–D)** — never five. The fifth physical button is
a dedicated **PASS** and nothing else. On Stage it renders as its own dashed
tile below the answers with the remaining count, greys out at 0, and is hidden
entirely in escape room mode and on already-passed questions. This is a
deliberate design decision replacing the old "E is answer-or-pass" ambiguity.

## Game show ruleset

- **Turn-based** — one shared button box, teams step up in session order
  (Red → Blue → Green → Yellow). No buzz-in anywhere.
- **Per question:** `question_seconds` countdown; value = `base_points`, or a
  random multiple of 5 in `[points_min, points_max]` when `randomize_points`.
- **Correct:** value + any `streak_ladder` bonus at the new streak count.
  **Wrong/timeout:** nothing, streak resets. Streaks are per team.
- **Pass:** decrements the team's `max_passes_per_team` pool and hands the
  question (fresh countdown) to the *next team in order*. Receiver correct →
  receiver scores normally, **passer charged −2× value** and their streak
  breaks. Receiver wrong/timeout → **passer awarded +2× value**. A passed
  question can't be passed again. Turn resumes after the *original passer*.
  Every outcome writes a clearly-labeled ledger entry.
- **Game length:** `question_count` questions, or until the overall timer
  expires when set to 0. Running out of unasked active questions also ends it.
- **The mole:** assigned randomly at launch when `has_mole`. Must finish with
  **exactly** `mole_target` Chroma *earned in this minigame* (net, including
  pass penalties) to win `mole_reward` — over or under gets nothing. Never
  shown on Stage until the end reveal; the Admin sees it in a collapsed
  "MOLE — DO NOT SHOW" panel with a live progress total, and can reassign or
  clear it mid-game. The `quiz` socket snapshot does carry `mole_team_id` (the
  Admin panel needs it live); the Stage deliberately never renders it — on a
  closed room network that is the intended secrecy model.

## Escape room ruleset

Single team. No passes, no mole, no rotation.

- **Category pick:** the team selects `categories_per_attempt` categories on
  Stage using the buttons — any of A–D advances the highlight, PASS toggles
  the highlighted category, and play starts automatically when the quota is
  reached. The Admin can tap categories as a full fallback.
- **Categories lock across attempts:** anything used in a previous attempt this
  session is greyed and unselectable. If fewer selectable categories remain
  than needed, the launch itself is blocked with a clear error (nothing is
  consumed — an aborted pick burns neither an attempt nor categories, because
  the run row is only written when the pick is confirmed).
- **Play:** `questions_per_category` drawn per chosen category, shuffled
  together. Streak ladder applies. The overall minigame timer runs alongside.
- **Attempts:** up to `max_attempts` per session. **The most recent attempt is
  the one that counts** — not the highest. On each run's end, the new run gets
  `counted = 1`, all earlier runs `counted = 0`, and every ledger entry tagged
  with a superseded `quiz_run_id` is voided, so the team's total reflects the
  counted run alone. After the last attempt, the launch tile shows "No attempts
  remaining" and is disabled.

## Admin controls during a quiz

On-screen **A/B/C/D/PASS** enter through the exact same server pipeline as the
hardware (full fallback if buttons die mid-show). **Skip question** discards
the current question with no scoring — same team stays up. **Force next turn**
skips the team entirely. The mole panel handles reassignment. Answer mistakes
are corrected the Phase 1 way: void the ledger entry.

## Adding a third quiz-type minigame

1. Create the bank: `INSERT INTO question_banks (id, name) VALUES ('speed_round', 'Speed Round')`
   — or copy how `db.js` seeds the first two. The bank id must equal the new
   minigame id.
2. Add `/minigames/speed_round.json` — copy `trivia_twist.json`, change `id`,
   `name`, `round_number`. Keep `"ui_component": "quiz"`.
3. Restart. The bank appears in **Question Banks** (it's listed from the DB),
   the tile appears on Live, and every rule above applies automatically. Tune
   the settings blocks in **Minigames**.

No engine code changes are involved.

## Data flow of one answered question

```
button press (Stage keydown) ──raw code──► Hub maps + debounces (index.js)
   └─ admin fallback POST /api/quiz/input ─┘
                     ▼
             quiz.input('B')
                     ▼
             resolve('B')  — decides correct/wrong, streaks, pass settlement
                     ├─ chroma_ledger rows (via actions.writeChroma, tagged quiz_run_id)
                     ├─ question_results row
                     ├─ Node-RED quiz.answered event
                     └─ 'quiz' snapshot broadcast → Stage/Admin re-render
```
