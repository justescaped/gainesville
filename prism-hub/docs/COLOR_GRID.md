# Color Grid (Phase 3) — minigame #6

Memory-and-placement. The Stage shows a **target pattern** for a few seconds,
hides it, and the players rebuild it from memory on a physical wall of
RFID-tracked shelves. The Hub owns the pattern, the timing, and the scoring;
**the Pi only reports what is physically in each cubby.**

`ui_component: "grid"` in `minigames/color_grid.json`. The engine lives in
`server/grid.js` and follows the same pattern as the quiz engine: a server
state machine broadcasting a `grid` snapshot; Stage and Admin render, never
decide.

## Phases

```
reveal ──(reveal_seconds elapse)──▶ build ──(timer expiry / Score Now / exact match)──▶ scored
   ▲                                  │
   └────────── Reveal Again ──────────┘   (escape room: always · game show: if allowed)
```

- **Reveal**: target full-screen with a countdown ring. The build timer is
  loaded but not running.
- **Build**: the Phase 1 server timer runs `build_seconds`. **The target is
  stripped from the snapshot payload** — not CSS-hidden. Someone opening
  /stage on their phone and inspecting the DOM finds nothing.
- **Scored**: target returns, overlaid on what was built — correct cells
  outlined green, wrong cells outlined red with a badge showing the intended
  color. Mole reveal follows (game show).

## Cell addressing — READ THIS BEFORE WIRING THE PI

`row` and `col` are **zero-indexed from the top-left AS PLAYERS FACE THE
SHELVES**. A mirrored mapping is the single most likely integration bug.

```
            players stand here, looking at the shelves
        ┌─────────┬─────────┬─────────┬─────────┐
        │ (0,0)   │ (0,1)   │ (0,2)   │ (0,3)   │   ← top shelf
        ├─────────┼─────────┼─────────┼─────────┤
        │ (1,0)   │ (1,1)   │ (1,2)   │ (1,3)   │
        ├─────────┼─────────┼─────────┼─────────┤
        │ (2,0)   │ (2,1)   │ (2,2)   │ (2,3)   │   ← bottom shelf
        └─────────┴─────────┴─────────┴─────────┘
          ↑ players' left                  players' right ↑
```

Sanity test during install: place one object in the **top-left** cubby and
confirm the Admin shelf view lights up its **top-left** cell.

## RFID input (Node-RED → Hub)

All three use the Phase 1 `X-Prism-Token` header.

| Endpoint | Body | Use |
|---|---|---|
| `POST /api/hook/grid/placement` | `{ "row": 0, "col": 2, "color": "blue", "tag_id": "04:A2:...", "team": "blue" }` | One cubby changed. `tag_id` and `team` optional. `color: "empty"` = object removed. |
| `POST /api/hook/grid/state` | `{ "cells": [["red","empty"],["blue","blue"]] }` | Full snapshot — replaces current state. **A Pi that reboots mid-round resyncs with this.** |
| `POST /api/hook/grid/score` | `{}` | Force immediate scoring |

Placements are **append-only** (`grid_placements`); current shelf state is the
latest placement per cell, and the full history replays for dispute review in
the session archive.

## Scoring

**Game show** — every team builds at once; each color scores for its team:

- each correctly placed cell of a team's color: `points_per_correct`
- each wrongly placed cell of a team's color: `points_per_wrong` (signed;
  default 0, set negative to punish spam)
- entire grid exact: every team whose color appears in the target gets
  `perfect_bonus`
- mole: Part 1 text objective, host-resolved at the reveal

**Escape room** — one team:

- `points_per_correct` per correct cell, `perfect_bonus` if exact
- `require_exact: true`: the round completes **the instant** the shelf matches,
  and remaining build seconds convert to Chroma at `per_second_remaining`
- **Reveal Again** is always available as a hint (cost `repeat_reveal_cost`
  per use, written to the ledger; 0 = free). The build timer keeps running
  while they look.

## Manual fallback

If RFID dies mid-show the game still runs: the Admin GridPanel shows a
tap-to-cycle copy of the shelf. Tap cells to mirror what the players built,
then **Score Now**. Same append-only pipeline, `tag_id`/`team_id` null.

## Puzzles

Admin → Minigames → Color Grid → **Open puzzle builder** (`/admin/grid-puzzles`).
2×2 up to 8×8; tap-to-cycle or palette painting; Fill/Clear/Randomize; live
preview identical to the Stage rendering; difficulty + per-mode availability +
active toggle. Launch draws a random active puzzle matching the manifest's
`difficulty_filter` and mode. Puzzles used by a past round soft-delete.

## Colorblind / livestream glyphs

Every color pairs with a glyph — red ▲, blue ■, green ●, yellow ◆ — rendered
inside each filled cell on Stage, the Admin builder, and the shelf view. Red
vs green squares survive both colorblind viewers and heavy stream compression.
The glyphs live in `GRID_GLYPH` (`src/hub.jsx`) if you want different shapes.

## Events

- `grid.started` — `{ puzzle_id, rows, cols, mode }`
- `grid.reveal_start` / `grid.reveal_end` — reveal window (repeat reveals too)
- `grid.build_start` — build timer began
- `grid.scored` — `{ scores: { red: 4, ... }, perfect: false }` (correct counts by color)
