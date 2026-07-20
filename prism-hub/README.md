# Prism Dilemma — Control Hub (Phase 1)

The brain of the attraction. One Node process serves the gamemaster's control
tablet, the room's Stage TV, and (later) player devices. It owns all game state,
scoring, and the timer, and talks to the rest of the room through Node-RED.

## Requirements
- **Node.js 20 or newer** (built and tested on Node 22). Check with `node -v`.
- Runs great on a Raspberry Pi 5. The DB is a single SQLite file — no separate
  database server to install.

## Setup

```bash
# 1. install dependencies and build the front end
npm run setup

# 2. start the Hub
npm start
```

Then open:
- **Admin** — `http://<hub-ip>:3000/admin` (PIN `1234`)
- **Stage** — `http://<hub-ip>:3000/stage` (put this on the TV, full screen)
- **Player** — `http://<hub-ip>:3000/player` (Phase 3 placeholder)

On the same machine, use `localhost` instead of the IP.

> `npm run setup` = `npm install` + `npm run build`. If you only changed the
> front end later, `npm run build` is enough; if you only changed the server,
> just restart with `npm start`.

## First-run defaults (change in Admin → Settings)
| Setting | Default |
|---------|---------|
| Port | `3000` — override with `PORT=8080 npm start` |
| Admin PIN | `1234` |
| Inbound token | `prism` (Node-RED/Pis send this in `X-Prism-Token`) |
| Node-RED base URL | *(blank — set it to enable outbound events)* |

## Using it
1. Open **Admin**, enter the PIN.
2. On the **Live** screen pick **Game Show** or **Escape Room** to start a session.
3. Tap a minigame tile to launch it; use the big timer transport + quick Chroma
   buttons to run the game. The **Stage** mirrors everything instantly.
4. **Minigames**, **Territories**, **Power-ups**, **Teams**, **Ledger**,
   **Node-RED**, and **Settings** are in the left nav.

## Running on boot (Raspberry Pi)
Point a `systemd` service at `npm start` in this folder (set `PORT` in the unit
if you don't want 3000). A kiosk browser on the Pi driving the TV should open
`/stage`; the tablet opens `/admin`.

## Adding minigames
Drop a JSON manifest in `/minigames` and restart. See
[`docs/ADDING_A_MINIGAME.md`](docs/ADDING_A_MINIGAME.md).

## Wiring the room
Node-RED flows (both directions) with copy-paste examples are in
[`docs/NODERED_SETUP.md`](docs/NODERED_SETUP.md).

## Phase 2 is included
Trivia Twist and Puzzle Pass run on the shared question engine: author content
in **Admin → Question Banks**, wire the arcade buttons in **Settings → Input**
(see [`docs/BUTTON_HARDWARE.md`](docs/BUTTON_HARDWARE.md)), and the full
ruleset lives in [`docs/QUESTION_ENGINE.md`](docs/QUESTION_ENGINE.md).

## For whoever builds Phase 3
Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), then
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) and
[`docs/API.md`](docs/API.md). The design rules there (the Hub owns all state;
Chroma is an append-only ledger; the timer is server-authoritative; state is
pushed not polled) are load-bearing — keep them.

## Project layout
```
server/     Node backend (Express + Socket.IO + SQLite)
src/        React front end (admin / stage / player)
minigames/  minigame manifests (JSON)
uploads/    uploaded images
docs/        architecture, data model, API, Node-RED, how-to guides
data/        SQLite DB (created on first run)
```
