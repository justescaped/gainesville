# API Reference — Prism Dilemma Hub

Base URL: `http://<hub-host>:3000`. All bodies are JSON.

Two namespaces:
- **`/api/*`** — the Admin surface API. No token (the PIN gates the UI; the
  network is closed).
- **`/api/hook/*`** — inbound from Node-RED / Pis. **Requires** header
  `X-Prism-Token: <inbound_token>` (default `prism`, set in Settings).

Every mutation broadcasts a fresh `state` snapshot over Socket.IO.

---

## Admin API (`/api`)

### Auth & state
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/auth` | `{ pin }` | 400 if wrong. UI-gate only. |
| GET  | `/state` | — | Full snapshot + `timer`. |

### Sessions
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/sessions` | `{ mode }` | `gameshow`\|`escaperoom`. Creates teams, **resets all territories**. 400 if one is already active. |
| POST | `/sessions/end` | — | Writes `run_history`, marks complete, fires `session_ended`. |
| POST | `/sessions/status` | `{ status }` | `active`\|`paused`. |
| POST | `/sessions/round` | `{ round }` | Set game-show round (clamped ≥1). |

### Teams
| PUT | `/teams/:id` | `{ name }` | Rename. |

### Chroma & ledger
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/chroma` | `{ team_id, amount, reason }` | Manual signed adjustment. |
| GET  | `/ledger` | — | Last 200 entries for the active session (newest first). |
| POST | `/ledger/:id/void` | — | Undo (sets `voided=1`; voids the whole trade group if any). |
| POST | `/ledger/:id/unvoid` | — | Redo. |

### Territories
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/territories` | `{ name, nodered_id? }` | Add. |
| PUT  | `/territories/:id` | `{ name?, nodered_id?, locked?, owner? }` | Any subset. Setting `owner` here **ignores the lock** (admin override) and fires `territory_changed`. |
| DELETE | `/territories/:id` | — | Remove. |

### Power-ups
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/powerups/defs` | `{ id?, name, description?, icon?, modes?, effect_type, config? }` | Upsert a catalog entry. `id` auto-derives from name if omitted. |
| DELETE | `/powerups/defs/:id` | — | Delete def + all its instances. |
| POST | `/powerups/grant` | `{ team_id, def_id }` | Give a team a copy. |
| POST | `/powerups/instances/:id/use` | `{ territory_id?, target_team_id? }` | Trigger. `steal_territory` needs `territory_id`; targeted announcements need `target_team_id`. |
| DELETE | `/powerups/instances/:id` | — | Revoke an unused copy. |

### Minigames
| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET  | `/minigames` | — | All manifests. |
| PUT  | `/minigames/:id` | partial manifest | Merge + save to disk; POSTs config to `manifest_push_url` if set. |
| POST | `/minigames/order` | `{ ids: [...] }` | Reorder rounds; position → `round_number`. |
| POST | `/minigames/:id/start` | `{ mode? }` | Load its timer, set active, fire `minigame_start`. |
| POST | `/minigames/end` | — | Clear active, advance round (game show), fire `minigame_end` (unless the timer already did). |
| POST | `/minigames/active/mode` | `{ mode }` | Swap the running minigame's ruleset without changing session mode. |

### Timer
| POST | `/timer` | `{ action, seconds? }` | `action`: `start`\|`pause`\|`resume`\|`reset`\|`add`\|`subtract`. `reset` with `seconds` loads a new duration. |

### Misc
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/banner` | `{ text, duration? }` | Push a Stage banner (seconds, default 8). |
| POST | `/upload` | multipart `image` | png/jpg/jpeg/gif/webp, ≤15MB → `{ path }`. |
| GET/PUT | `/settings` | `{ admin_pin?, inbound_token?, nodered_base_url?, manifest_push_url? }` | Read / update. |
| GET  | `/nodered/log` | — | `{ inbound[], outbound[] }`, last 50 each. |
| POST | `/nodered/test` | `{ event }` | Fire a synthetic outbound event. |
| GET  | `/history` | — | Last 100 `run_history` rows. |

---

## Inbound hooks (`/api/hook`) — from Node-RED

All require `X-Prism-Token`. `team` accepts a color string (`"red"`) or a
numeric team id. Every request is logged (accepted or rejected).

| Path | Body | Effect |
|------|------|--------|
| `/chroma` | `{ team, amount, reason?, minigame_id? }` | Append a ledger entry (`source: nodered`). |
| `/territory` | `{ territory_id, owner }` | Set owner (respects lock). |
| `/minigame/start` | `{ minigame_id, mode? }` | Start a minigame. |
| `/minigame/end` | `{ minigame_id? }` | End the active minigame. |
| `/timer` | `{ action, seconds? }` | Same actions as `/api/timer`. |
| `/banner` | `{ text, duration? }` | Show a Stage banner. |

Example:
```bash
curl -X POST http://hub.local:3000/api/hook/chroma \
  -H 'Content-Type: application/json' -H 'X-Prism-Token: prism' \
  -d '{"team":"blue","amount":150,"reason":"Rainball win"}'
```

---

## Outbound events (Hub → Node-RED)

Fire-and-forget POST to `<nodered_base_url>/prism/<event>` (2s timeout, failures
logged not thrown). A minigame's `nodered.on_start` / `on_end` can override the
URL for those two events. Every payload includes `event` and an ISO `ts`.

| Event | Fired when | Key fields |
|-------|-----------|-----------|
| `session_started` | new session | `session_id, mode` |
| `session_ended` | session ends | `session_id, mode` |
| `chroma_changed` | any ledger change | `team, team_name, amount, reason, source, new_total` |
| `territory_changed` | owner changes | `territory_id, nodered_id, name, previous_owner, new_owner` |
| `minigame_start` | minigame starts | `minigame_id, mode, session_id` |
| `minigame_end` | minigame ends | `minigame_id, cause` (`timer_expired`\|`admin_end`) |
| `timer_expired` | timer hits 0 | `minigame_id, session_id` |
| `powerup_used` | power-up triggered | `team, team_name, powerup, effect_type` |
| `minigame_config` | a manifest is saved (to `manifest_push_url`) | `manifest` |

---

## Socket.IO events (Hub → surfaces)

Connect to the same origin. On connect you immediately receive current `state`
and `timer`.

| Event | Payload | Frequency |
|-------|---------|-----------|
| `state` | full snapshot (see DATA_MODEL.md) | on every mutation |
| `timer` | `{ duration_ms, remaining_ms, running, expired }` | ~10Hz while running |
| `banner` | `{ id, text, duration }` | on banner push |

---

# Phase 2 additions

## Question banks (`/api/qb`)

| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/qb` | — | Banks → categories with question counts. |
| GET | `/qb/:bankId/stats` | — | Totals, per-category counts, run-dry warnings. |
| GET | `/qb/:bankId/export` | — | CSV download of the whole bank. |
| POST | `/qb/:bankId/categories` | `{ name, color? }` | Add category. |
| PUT | `/qb/categories/:id` | `{ name?, color? }` | Rename / recolor. |
| POST | `/qb/:bankId/categories/order` | `{ ids }` | Reorder (position → sort_order). |
| DELETE | `/qb/categories/:id?force=1` | — | Without `force`, errors if it holds questions (UI confirms). Referenced questions are deactivated, never hard-deleted. |
| GET | `/qb/categories/:id/questions` | — | Questions + answers. |
| POST | `/qb/categories/:id/questions` | `{ text, image?, base_points?, active?, answers: [{text, is_correct}] }` | 2–4 answers, exactly one correct — enforced. |
| PUT | `/qb/questions/:id` | same shape | Full update. |
| DELETE | `/qb/questions/:id` | — | Hard delete, or `{ soft_deleted: true }` if used in past games. |
| POST | `/qb/questions/:id/duplicate` | — | Copy (created inactive, "(copy)" suffix). |
| POST | `/qb/categories/:id/import` | `{ rows, commit }` | CSV rows (columns per spec). `commit:false` = validation preview with row-level errors; `commit:true` inserts valid rows only and reports both counts. `image_filename` must already exist in uploads. |

## Quiz control (`/api/quiz`)

| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/quiz` | — | Current quiz snapshot (same shape as the socket event). |
| POST | `/quiz/input` | `{ button }` | `A`–`D`/`PASS` — the Admin fallback; identical pipeline to hardware. |
| POST | `/quiz/pick` | `{ category_id }` | Toggle a category during escape-room pick. |
| POST | `/quiz/skip` | — | Discard current question, same team stays up. |
| POST | `/quiz/advance_turn` | — | Skip the current team's turn (game show). |
| POST | `/quiz/mole` | `{ team_id \| null }` | Reassign or clear the mole. |

## Input settings (`/api/input`)

| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/input` | — | `{ map, recent (last 10 keycodes), learn_arm }`. |
| PUT | `/input/map` | `{ map }` | Full `{A,B,C,D,PASS}` → `event.code` map. |
| POST | `/input/learn` | `{ action \| null }` | Arm learn mode: the next raw press binds to `action`. |

## Socket.IO additions

| Event | Direction | Payload | Notes |
|-------|-----------|---------|-------|
| `quiz` | Hub → clients | quiz snapshot | On every change; ~10Hz during a question countdown. `{active:false}` when no quiz. |
| `raw_button` | Stage → Hub | `{ code }` | Raw `KeyboardEvent.code` from the button box. Mapping/debounce/meaning are server-side. |
| `input_code` | Hub → clients | `{ code, ts, action }` | Feed for the Settings → Input test panel. |
| `input_learned` | Hub → clients | `{ action, code, map }` | Learn mode captured a binding. |

## New outbound Node-RED events

Same delivery rules as Phase 1 (POST to `<base>/prism/<event>`, 2s timeout).

| Event | Payload |
|-------|---------|
| `quiz.started` | `{ minigame_id, mode, team_count }` |
| `quiz.question` | `{ question_id, team, question_number }` |
| `quiz.answered` | `{ team, correct, points, streak }` |
| `quiz.passed` | `{ from_team, to_team }` |
| `quiz.mole_assigned` | `{ team }` |
| `quiz.ended` | `{ scores, mole_team, mole_hit_target }` |

## State snapshot additions

`buildState()` now includes `quiz_attempts`:
`{ [minigame_id]: { used, max, scores[], counted_score } }` for each quiz
minigame in the active session — what greys out an exhausted escape-room tile.

# Phase 3 additions

## Mole objectives (`/api/mole`)

| Method & path | Body / query | Effect |
|---|---|---|
| `GET /mole/objectives` | — | `{ objectives[], warnings[] }` — warnings flag mole minigames with < 3 applicable objectives |
| `POST /mole/objectives` | `{ text, minigame_ids[], reward, weight, active }` | Create. Empty `minigame_ids` = any minigame; `reward` null = minigame default |
| `PUT /mole/objectives/:id` | any subset of the above | Update |
| `POST /mole/objectives/:id/duplicate` | — | Copy (created inactive) |
| `DELETE /mole/objectives/:id` | — | Hard delete, or soft (`active=0`) if ever assigned |
| `POST /mole/assign` | `{ team_id? }` | Assign for the active minigame (omit team_id = random). Used when `randomize_mole_team` is off |
| `POST /mole/assignment/:id/reroll` | — | Draw a different objective, re-deliver |
| `POST /mole/assignment/:id/reassign` | `{ team_id }` | Move to another team, re-deliver |
| `POST /mole/assignment/:id/resend` | — | Re-fire `mole.assigned` → `{ delivered }` |
| `POST /mole/assignment/:id/clear` | — | Void the assignment, fire `mole.cleared` |
| `POST /mole/assignment/:id/resolve` | `{ outcome: 'hit'\|'missed' }` | Host verdict. Hit writes the reward to the ledger (source `powerup`, undo-able) |

The pending assignment rides the state snapshot as `state.mole` (Admin panel
only — the Stage never renders it before the scoring reveal).

## Color Grid (`/api/grid`)

| Method & path | Body | Effect |
|---|---|---|
| `GET /grid` | — | Current grid snapshot (same shape as the `grid` socket event) |
| `GET /grid/puzzles` | — | All puzzles with patterns |
| `POST /grid/puzzles` | `{ name, rows, cols, pattern[][], difficulty, modes[] }` | Create (2×2 – 8×8) |
| `PUT /grid/puzzles/:id` | any subset | Update / activate / deactivate |
| `POST /grid/puzzles/:id/duplicate` | — | Copy (created inactive) |
| `DELETE /grid/puzzles/:id` | — | Hard delete, or soft if used by a past round |
| `POST /grid/cell` | `{ row, col, color }` | Admin manual fallback placement |
| `POST /grid/score` | — | Score Now |
| `POST /grid/reveal_again` | — | Repeat the reveal (escape room: always; game show: if `allow_repeat_reveal`; cost per `repeat_reveal_cost`) |

## Run history (`/api/history`)

| Method & path | Body / query | Effect |
|---|---|---|
| `GET /history/alltime` | — | Top 25 visible escape-room runs, ties → shorter duration |
| `GET /history/monthly` | `?month=YYYY-MM` (omit = current) | Monthly top 25 + `months[]` for the picker |
| `GET /history/recent` | `?mode=&from=&to=` (dates `YYYY-MM-DD`) | Every run newest-first, hidden ones flagged |
| `GET /history/:id/archive` | — | Full session archive: ledger, mole assignments, launches, quiz runs, grid rounds |
| `PUT /history/:id` | `{ team_name, player_names[], notes, visible }` | Post-run edits — never the score |
| `GET /history/export.csv` | — | CSV of everything |

## Inbound hook additions (`/api/hook`, token-gated)

| Endpoint | Body | Effect |
|---|---|---|
| `POST /hook/grid/placement` | `{ row, col, color, tag_id, team }` | One cubby change (zero-indexed from top-left as players face the shelves — see COLOR_GRID.md) |
| `POST /hook/grid/state` | `{ cells: [[...]] }` | Full shelf resync |
| `POST /hook/grid/score` | `{}` | Force scoring |

## Socket.IO additions

| Event | Direction | Payload |
|---|---|---|
| `grid` | Hub → clients | Grid snapshot. **During the build phase the target pattern is absent from the payload** (server-filtered, not CSS-hidden). |

## New outbound Node-RED events

`mole.*` events go to **Settings → Mole delivery URL** (falls back to the base URL).

| Event | Payload |
|-------|---------|
| `mole.assigned` | `{ session_id, minigame_id, round_number, team, team_name, objective, reward }` |
| `mole.rerolled` | same as `mole.assigned` |
| `mole.cleared` | `{ session_id, minigame_id, team }` |
| `mole.resolved` | `{ team, objective, outcome, reward_awarded }` |
| `grid.started` | `{ puzzle_id, rows, cols, mode }` |
| `grid.reveal_start` / `grid.reveal_end` | `{ round_id, ... }` |
| `grid.build_start` | `{ round_id }` |
| `grid.scored` | `{ scores: {color: correct_count}, perfect }` |
| `run.completed` | `{ team_name, final_chroma, duration_sec, mode }` |
| `run.record_set` | `{ team_name, rank, scope: 'alltime'\|'monthly' }` — fired when a run enters the top 10 |

## State snapshot additions

- `state.mole` — newest pending mole assignment (`team`, snapshotted
  `objective_text`, `reward`, `delivered`, `auto_scored`) or `null`
- `state.last_run` — after an escape-room session ends (until the next session
  starts): `{ team_name, final_chroma, duration_sec, rank_alltime,
  rank_monthly, made_top25 }` — drives the Stage end-of-run screen
