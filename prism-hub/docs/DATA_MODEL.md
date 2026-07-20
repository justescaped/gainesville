# Data Model — Prism Dilemma Hub

SQLite via `better-sqlite3`, one file at `data/prism.db` (WAL mode). Schema is
defined and seeded in `server/db.js`. Minigames are **not** in the DB — they
live as JSON files in `/minigames` (see `ADDING_A_MINIGAME.md`).

## Tables

### settings `(key, value)`
Key/value store. Seeded keys: `admin_pin` (default `1234`), `inbound_token`
(default `prism`), `nodered_base_url`, `manifest_push_url`.

### sessions
One row per playthrough.
- `mode` — `gameshow` | `escaperoom`
- `status` — `setup` | `active` | `paused` | `complete`
- `current_round` — game-show round counter; auto-increments when a game-show
  minigame ends
- `active_minigame_id`, `active_minigame_mode` — which minigame is on the
  Stage right now (both NULL when nothing is running)
- `started_at`, `ended_at`

"The active session" = the most recent row whose `status != 'complete'`
(`activeSession()` in db.js). Only one is ever active.

### teams
Created with a session. Game show → 4 rows (red/blue/green/yellow). Escape room
→ 1 row (color `solo`). `color` is immutable and drives every accent in the
room; `name` is editable.

### chroma_ledger — APPEND-ONLY, the heart of the system
Never `UPDATE amount`. Never `DELETE`. Every point movement is a row.
- `amount` — signed integer
- `source` — `manual` | `nodered` | `minigame` | `powerup` | `trade` | `correction`
- `reason` — human-readable label shown in the ledger feed
- `trade_group_id` — links the two halves of a trade so undoing one undoes both
- `voided` — `0`/`1`. Undo sets it to `1`; the row stays visible, struck through, with a Redo button.

**A team's Chroma total is always derived:**
`SELECT SUM(amount) FROM chroma_ledger WHERE team_id = ? AND voided = 0`
(`chromaForTeam()`). Nothing caches a total. This is the single source of truth
and the reason undo/redo is trivially correct.

> Phase 1 has no trade UI (by decision) — only the `trade_group_id` column and
> the linked-void behavior, so a Phase 2 trade feature drops in cleanly.

### territories
Physical zones in the room.
- `owner` — `red` | `blue` | `green` | `yellow` | `none`
- `nodered_id` — the id sent to Node-RED so it knows which lights to change
- `locked` — `0`/`1`. Locked territories are **immune to power-up steals**, but
  an admin can always reassign them by hand.

> **DEVIATION worth knowing:** territories persist **globally**, not per session.
> They are not linked to a `session_id`. Starting a new session resets every
> territory to `owner = 'none', locked = 0` (see the `/api/sessions` POST
> transaction). This matches the physical reality — the zones are the same
> walls every game — and avoids re-seeding them each run. If you ever need
> per-session territory history, that's a schema change: add `session_id` and
> stop the reset.

### powerup_defs — the catalog
Reusable power-up definitions.
- `effect_type` — one of exactly three engines:
  - `steal_territory` — flips a chosen unlocked territory to the user's color (fires the lighting webhook)
  - `chroma_bonus` — writes `config.amount` Chroma to the user via the ledger
  - `announcement_only` — changes **no** state; just shows a Stage banner from `config.template`
- `config` — JSON. For `chroma_bonus`: `{ amount }`. For `announcement_only`:
  `{ template, needs_target_team }` where `template` may contain `{team}` (the
  user) and `{target}` (a chosen other team).
- `modes` — JSON array limiting which game mode(s) it appears in.

Seeded: **Chroma Heist** (steal_territory), **Lockdown** (announcement, targets
a team — jail is narrative only, it blocks no points), **Get Out Free**
(announcement), **Super Hint** (announcement, escape-room).

### powerup_instances
A specific copy of a def granted to a team in a session. `used` / `used_at`
mark it spent. Deleting a def cascades to its instances.

### run_history
One row per team written when a session ends (`/api/sessions/end`): `mode`,
`team_name`, `final_chroma`, `duration_seconds`, `ended_at`. Feeds the escape
room bests (`bests()` computes monthly + all-time max `final_chroma` for
`mode = 'escaperoom'`).

### nodered_log
Rolling diagnostics, capped at 500 rows. `direction` `in`/`out`, plus `event`,
`url`, `payload`, `status`. Powers the Node-RED panel in the Admin UI.

## The state snapshot

`buildState()` (server/state.js) is what every surface renders. Shape:

```jsonc
{
  "session":  { /* sessions row, or null */ },
  "teams":    [ { ...team, "chroma": 200, "territory_count": 1, "powerups": [...] } ],
  "territories": [ { id, name, owner, nodered_id, locked } ],
  "minigames":   [ /* all manifests, sorted by round_number */ ],
  "powerup_defs":[ /* catalog, modes/config parsed */ ],
  "bests":    { "monthly": 1234, "alltime": 1500 }
}
```

`GET /api/state` returns this plus a `timer` snapshot. Over Socket.IO the
`state` and `timer` events are emitted separately (timer far more often).

---

# Phase 2 additions — question engine tables

Minigames with `ui_component: "quiz"` use these. Full behavior in `QUESTION_ENGINE.md`.

### question_banks `(id, name)`
Seeded: `trivia_twist`, `puzzle_pass`. **The bank id equals the minigame id** —
that's the whole wiring between a quiz manifest and its content.

### categories
`bank_id`, `name`, optional `color` (picker accent), `sort_order`. Categories
hold **any number** of questions — there is no cap. The stats endpoint warns
(never blocks) when an active category has fewer than 5 active questions,
because a game could run dry.

### questions
`category_id` (exactly one category per question), `text`, optional `image`
(uploaded path, rendered between text and answers), `base_points`, `active`.
**Never hard-deleted while referenced by a question_result** — deletes become
`active = 0` so past game history stays resolvable. Deleting a whole category
hard-deletes only its unreferenced questions; referenced ones are deactivated
and left in place.

### answers
2–4 rows per question, `letter` A–D, exactly one `is_correct = 1` (enforced by
the API — saving zero or multiple correct answers is rejected).

### quiz_runs
One row per playthrough of a quiz minigame. `attempt_no` and `category_ids`
(JSON) are escape-room fields. `counted`: escape room marks only the **most
recent** run as counted; `final_score` is the solo team's net for that run.

### question_results
One row per resolved question: which team was on the clock, what they
`selected` (null = timeout), `correct`, signed `points_awarded` (includes
streak bonus), `was_passed` + `passed_from_team_id`. The passer's ±2× pass
settlement lives in the ledger (tagged with the run), not here.

### chroma_ledger.quiz_run_id (migration)
New nullable column tagging quiz-generated entries with their run, added via
`ALTER TABLE` on first boot of Phase 2 against an existing DB. It exists so a
superseded escape-room attempt's entries can be voided as a group.

### settings additions
`button_map` — JSON `{A,B,C,D,PASS} → KeyboardEvent.code`, edited in
Settings → Input (see `BUTTON_HARDWARE.md`).
