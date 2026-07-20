# Changelog

## Phase 1 — Core Hub (initial build)

The foundation: one process, one port, three surfaces (Admin / Stage / Player),
server-authoritative state and timer, Node-RED I/O in both directions.

### Included
- **Sessions** in two modes (game show: 4 teams; escape room: 1 solo team) with
  pause/resume/end and game-show round tracking (auto-advances when a game-show
  minigame ends).
- **Chroma ledger** — append-only, totals always derived, undo/redo via void,
  `trade_group_id` support (no trade UI yet, by decision).
- **Territories** — owner + lock + `nodered_id`; owner changes fire a webhook.
  Persist globally; reset on new session (deviation documented in DATA_MODEL.md).
- **Power-ups** — generic catalog with three effect engines (`steal_territory`,
  `chroma_bonus`, `announcement_only`). Seeded: Chroma Heist, Lockdown, Get Out
  Free, Super Hint. Jail is narrative-only — it blocks no points.
- **Minigames** — manifest-driven (JSON files in `/minigames`). Three seeded.
  Per-mode timers + chroma rules; drag-to-reorder rounds; image upload; Node-RED
  URL overrides. Generic timer Stage view; `ui_component` extension point for
  custom views later.
- **Server timer** — 10Hz broadcast, Start/Pause/Resume/Reset/±30s, minutes+seconds entry.
- **Node-RED** — 6 token-gated inbound hooks; fire-and-forget outbound events
  (2s timeout); a diagnostics panel (last 50 each way + test buttons).
- **Stage** — greyscale world, team color as the only saturation, 20-ft legible,
  banner overlay. **Admin** — PIN gate, left nav, no-scroll Live screen tuned
  for a 10" tablet. **Player** — Phase 3 stub.
- **Seeded demo-ready:** 4 teams on session start, 3 minigames, 4 power-ups,
  3 territories (North Wall / Cell Block / The Pit).

### Deliberately out of scope (later phases)
Question engine (Trivia Twist / Puzzle Pass), physical buttons, Color Grid,
interactive player surface, mole-assignment logic (`has_mole` stored but inert),
MQTT, direct audio/lighting (handled by Home Assistant via the fired events).

### Defaults
Port `3000` (env `PORT`) · Admin PIN `1234` · Inbound token `prism`.
All changeable in Admin → Settings.

## Phase 2 — Question Engine

One engine (`server/quiz.js`) powering **Trivia Twist** (round 4) and
**Puzzle Pass** (round 5) — two manifests, two question banks, zero duplicated
scoring/timing/rendering logic — plus physical button input.

### Included
- **Data:** question_banks / categories / questions / answers / quiz_runs /
  question_results tables; `chroma_ledger.quiz_run_id` migration; seeds (4
  categories per bank, 23 sample questions, 2 with generated images).
- **Question authoring:** new Admin "Question Banks" page — category CRUD with
  reorder + guarded delete, question editor (2–4 answers, exactly-one-correct
  enforced, image upload, base points, active toggle), duplicate, CSV import
  with row-level validation preview, CSV export, bank stats with run-dry
  warnings (warnings never block; categories have no size cap).
- **Game show rules:** turn-based rotation, per-question countdown, optional
  point randomization, per-team streak ladder, dedicated PASS button (2–4
  answers only — the fifth button is never answer E) with ±2× settlement and
  labeled ledger entries, mole with exact-target reward and an Admin-only
  collapsed reveal panel.
- **Escape room rules:** button-driven category pick, categories lock across
  attempts, N-per-category draws, up to 3 attempts where the **most recent**
  counts (superseded runs' ledger entries voided as a group), launch blocked
  with clear errors when out of attempts/categories.
- **Buttons:** Stage forwards raw `event.code` over Socket.IO; Hub maps
  (Settings → Input), debounces 200ms, ignores repeats, locks out inactive
  phases. Learn mode + last-10-keycodes test panel + full on-screen Admin
  fallback.
- **Stage:** quiz takeover views — team-color banner, big question + image,
  A–D tiles, distinct PASS tile with remaining count, circular countdown ring,
  answer feedback with streak flame, turn transitions, category picker,
  final-scores + mole reveal.
- **Node-RED:** `quiz.started/question/answered/passed/mole_assigned/ended`.
- **Docs:** QUESTION_ENGINE.md, BUTTON_HARDWARE.md; API/DATA_MODEL updates.

### Deliberately out of scope (Phase 3)
Color Grid (#6), interactive Player surface, buzz-in mechanics, audio/lighting.

## Phase 3 — Mole Objectives, Color Grid, Run History

Final core phase. The Player surface was **removed from scope** (revised
plan): mole objectives are text delivered via Node-RED to any device, so team
tablets are unnecessary. `/player` stays a reserved stub ("Not in use").

### Included
- **Mole objective system** — admin-editable text objective library (13
  seeded) with per-minigame tagging, weighted draw, and reward overrides.
  Random (or admin-picked) assignment on launch of any `has_mole` minigame;
  one `mole.assigned` webhook to a dedicated URL delivers the secret to
  whatever device the room uses. Collapsed "MOLE — DO NOT SHOW" Admin panel
  with reroll / reassign / resend / clear / Hit / Missed; Hit pays through the
  normal ledger (undo works). Objective text snapshotted into assignments;
  delivery failures warn but never block. Trivia's exact-score mole retrofitted
  to fire the same event with a generated objective (still auto-scored).
- **Color Grid (#6)** — `ui_component: "grid"` engine: reveal → build →
  scored. Puzzle builder (2×2–8×8, tap/palette painting, 6 seeded puzzles
  across three difficulties), difficulty filter per mode. Append-only RFID
  placements via 3 token-gated hooks (incremental + full-resync + force-score),
  Admin tap-to-cycle manual fallback. Game show: per-color scoring, wrong-cell
  penalty option, perfect bonus, optional paid repeat reveal, mole reveal at
  scoring. Escape room: `require_exact` instant completion converting remaining
  seconds to Chroma, always-available Reveal Again hint. **The target pattern
  is stripped from the build-phase payload — server-filtered, not CSS-hidden.**
  Colors pair with shape glyphs (▲ ■ ● ◆) for colorblind viewers and
  compressed livestreams.
- **Run history** — run_history extended (player names, minigames played,
  notes, visible flag for staff test runs). New History nav: All-Time top 25,
  Monthly with month picker, Recent with filters, and a per-run session
  archive (full ledger, mole assignments, grid rounds) with CSV export.
  Stage end-of-run screen with all-time/monthly rank and a top-25/record
  celebration; `run.completed` on every session end and `run.record_set` on
  top-10 entries. 5 sample runs seeded so the boards demo immediately.
- **Docs:** MOLE_SYSTEM.md, COLOR_GRID.md (cell-addressing diagram);
  API/DATA_MODEL updates; ADDING_A_MINIGAME custom-`ui_component` walkthrough
  now uses Color Grid as the reference implementation.

### Deliberately out of scope
Player tablet surface (removed — Node-RED delivers mole objectives), grid-based
mole patterns (replaced by text objectives), minigames #7–20 (manifest drops),
audio/lighting (Node-RED + Home Assistant).
