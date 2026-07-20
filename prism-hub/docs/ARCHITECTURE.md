# Architecture — Prism Dilemma Hub (Phase 1)

Written for whoever (human or AI) picks this up next. Read this first.

## What this is

The **Hub** is the single brain of the Prism Dilemma attraction. It runs on a
Raspberry Pi 5 and owns all game state, rules, scoring, and the timer. Other
Pis and devices in the room are **dumb sensors/effect drivers** — they never
hold authoritative state. They talk to the Hub through Node-RED over HTTP.

Two game modes share one codebase:
- **Game show** — 4 fixed teams (red/blue/green/yellow), rounds, territories, power-ups.
- **Escape room** — 1 solo team chasing a monthly / all-time Chroma record.

## One process, three surfaces

`npm start` launches a single Node process (`server/index.js`) that serves
everything on one port (default 3000):

| Surface | Route    | Who       | Notes |
|---------|----------|-----------|-------|
| Admin   | `/admin` | gamemaster on a 10" tablet | PIN-gated, all controls |
| Stage   | `/stage` | the room TV | read-only, no cursor, 20-ft legible |
| Player  | `/player`| per-team device | Phase 3 stub for now |

All three are routes of the same Vite/React SPA built to `/dist`. The server
serves that build plus a catch-all so client-side routing works on refresh.

## The golden rules

1. **The Hub owns all pixels and rules. Pis only sense.** If a decision needs
   to be made about score, ownership, or time, it happens here.
2. **Chroma is a ledger, never a counter.** `chroma_ledger` is append-only.
   A team's total is *always* `SUM(amount) WHERE voided = 0`. Undo = set
   `voided = 1`; nothing is deleted. This makes every point auditable and every
   mistake reversible. See `DATA_MODEL.md`.
3. **The timer is server-authoritative.** `server/core.js`'s `createTimer`
   counts down at ~10Hz and broadcasts remaining milliseconds over Socket.IO.
   Clients render what they receive; they never run their own clock. This keeps
   the tablet and the TV frame-identical.
4. **State is pushed, not polled.** Any mutation calls `broadcastState()`,
   which emits the whole snapshot (`server/state.js → buildState`) to every
   connected surface. The Stage updates instantly with no polling.
5. **Node-RED failures never block the game.** Outbound calls
   (`fireNodeRed`) are fire-and-forget with a 2-second timeout; every outcome
   is logged, never thrown.

## Data flow

```
                         ┌─────────────────────────────┐
   Node-RED / Pis  ──────► POST /api/hook/*  (token)    │
   (inbound events)       │        │                    │
                          │        ▼                    │
                          │   actions.js  (the verbs)   │
   Admin tablet   ───────►│   POST /api/*               │
   (controls)             │        │                    │
                          │        ▼                    │
                          │   SQLite (better-sqlite3)   │
                          │        │                    │
                          │        ├─ broadcastState() ─┼──► Socket.IO ──► Admin / Stage / Player
                          │        └─ fireNodeRed() ────┼──► POST /prism/<event> ──► Node-RED ──► Home Assistant (lights/audio)
                          └─────────────────────────────┘
```

`actions.js` is the shared verb layer. Both the Admin API and the inbound
Node-RED hooks call the same functions, so "Team Red scored 200" behaves
identically whether a human tapped a button or a Pi POSTed a result.

## File map

```
server/
  index.js      entry point: Express + Socket.IO + static + timer wiring
  db.js         SQLite schema, seeds, settings, derived-total helpers
  core.js       manifest loading, Node-RED outbound, the timer factory
  state.js      buildState() snapshot + broadcast + banner push
  actions.js    the verbs: writeChroma, setTerritoryOwner, start/endMinigame, usePowerup, timerAction
  routes/
    api.js      the Admin REST API
    hooks.js    inbound Node-RED webhooks (token-gated)
minigames/      one JSON manifest per minigame (see ADDING_A_MINIGAME.md)
src/            the React SPA (admin/, stage/, player/, hub.jsx shared)
uploads/        user-uploaded minigame + power-up images (served at /uploads)
data/           the SQLite DB (created at first run; git-ignored)
docs/           you are here
```

## Phase boundaries

Phase 1 (this) is the **core hub**: sessions, teams, Chroma ledger, territories,
generic power-ups, manifest-driven minigames, server timer, Node-RED I/O, and
the three surfaces.

Deliberately **out of scope** and stubbed or absent: the question engine
(Trivia Twist / Puzzle Pass), physical buttons, the Color Grid, the interactive
player surface, mole-assignment logic (the `has_mole` flag is stored but does
nothing yet), MQTT, and direct audio/lighting (those live in Home Assistant,
driven by the Node-RED events this Hub fires).
