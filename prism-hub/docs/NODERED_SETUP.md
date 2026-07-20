# Node-RED Setup

The Hub and Node-RED talk over plain HTTP — no MQTT (by design). Node-RED is the
glue between the Hub and Home Assistant: the Hub decides *what happened*, fires
an event, and Node-RED turns that into lights/audio/etc. via Home Assistant.

Two directions:
- **Hub → Node-RED (outbound):** the Hub POSTs game events. Node-RED listens.
- **Node-RED → Hub (inbound):** Pis/sensors POST results. The Hub applies them.

## Configure the Hub

**Admin → Settings:**
- **Node-RED base URL** — e.g. `http://nodered.local:1880`. Outbound events go
  to `<base>/prism/<event>`. Leave blank to disable outbound entirely.
- **Inbound token** — the shared secret (default `prism`). Every inbound POST
  must carry it in the `X-Prism-Token` header.
- **Manifest push URL** — optional; where saved minigame configs are POSTed.

Then use **Admin → Node-RED** to fire test events and watch both traffic logs.

---

## Direction 1: Hub → Node-RED (receiving game events)

Add an **http in** node per event you care about, method **POST**, URL
`/prism/<event>` (e.g. `/prism/territory_changed`), wired to your logic and an
**http response** node (return 200). Example flow — import via Menu → Import:

```json
[
  {"id":"t_in","type":"http in","name":"territory_changed","url":"/prism/territory_changed","method":"post","x":150,"y":100,"wires":[["t_fn","t_res"]]},
  {"id":"t_res","type":"http response","name":"200","statusCode":"200","x":520,"y":160,"wires":[]},
  {"id":"t_fn","type":"function","name":"→ Home Assistant","func":"// msg.payload = { event, ts, territory_id, nodered_id, name, previous_owner, new_owner }\nmsg.ha = {\n  entity: `light.${msg.payload.nodered_id}`,\n  color: msg.payload.new_owner   // red|blue|green|yellow|none\n};\nreturn msg;","outputs":1,"x":360,"y":100,"wires":[[]]}
]
```

The function node shows the payload shape; wire its output into your Home
Assistant call-service node and map `new_owner` → the color you set on that
zone's lights. Repeat the http-in for `chroma_changed`, `minigame_start`,
`minigame_end`, `timer_expired`, `powerup_used`, `session_started`,
`session_ended` as needed. Payload fields for each are in `API.md`.

---

## Direction 2: Node-RED → Hub (reporting results)

To push a score/ownership/timer change into the Hub, POST to `/api/hook/*` with
the token header. Example flow: an inject (stand-in for a Pi sensor) → set the
token → http request.

```json
[
  {"id":"inj","type":"inject","name":"Blue wins Rainball","props":[{"p":"payload"}],"payload":"{\"team\":\"blue\",\"amount\":150,\"reason\":\"Rainball win\"}","payloadType":"json","x":160,"y":300,"wires":[["hdr"]]},
  {"id":"hdr","type":"function","name":"add token + headers","func":"msg.headers = {\n  'Content-Type': 'application/json',\n  'X-Prism-Token': 'prism'   // must match Settings → Inbound token\n};\nmsg.url = 'http://hub.local:3000/api/hook/chroma';\nmsg.method = 'POST';\nreturn msg;","outputs":1,"x":390,"y":300,"wires":[["req"]]},
  {"id":"req","type":"http request","name":"POST /api/hook/chroma","method":"use","ret":"obj","url":"","x":640,"y":300,"wires":[["dbg"]]},
  {"id":"dbg","type":"debug","name":"result","active":true,"complete":"payload","x":840,"y":300,"wires":[]}
]
```

Swap the URL's path segment for the endpoint you need:
`/api/hook/chroma`, `/territory`, `/minigame/start`, `/minigame/end`,
`/timer`, `/banner` (bodies in `API.md`).

### Reporting from an external Pi-hosted minigame
When a Pi finishes running a minigame, have it report through Node-RED. Tag the
post with the minigame's `inbound_key` (from its manifest) so you can route it:

```
POST /api/hook/chroma
{ "team": "green", "amount": 200, "reason": "Color Clash win", "minigame_id": "color_clash" }
```

or end the minigame centrally:

```
POST /api/hook/minigame/end
{ "minigame_id": "color_clash" }
```

---

## Sanity check

1. Set the base URL and token in Settings.
2. Admin → Node-RED → click a test event button. It should show `200` (green) in
   the outbound log if Node-RED received it, or an error you can read.
3. From Node-RED, fire the inbound example. It should appear in the inbound log
   as `accepted`, and the score should move on the Stage instantly.

A wrong or missing token returns **401** and is logged as `401 bad token` — the
first thing to check if inbound posts "do nothing."

---

## Phase 3: mole delivery flow

`mole.assigned` (and the other `mole.*` events) POST to **Settings → Mole
delivery URL** — keep it separate from your main event flow, since it usually
points at a different physical device. The minimal receiver:

```
[http in: POST /prism/mole] → [switch on msg.payload.event] → delivery node → [http response 200]
```

Delivery node ideas (all stock or one palette install away):
- **Thermal receipt printer** (node-red-contrib-escpos or a python-shell to
  python-escpos): print `msg.payload.team_name`, the objective, and the
  reward — a physical secret card the mole pockets. ~$40 of hardware.
- **Bench screen**: a `ui_text` on a small dashboard shown only at the mole's
  bench, cleared on `mole.resolved`.
- **TTS**: pipe `msg.payload.objective` to a speaker in a headset.

Payload you'll receive:

```json
{
  "event": "mole.assigned",
  "team": "blue",
  "team_name": "Team Blue",
  "minigame_id": "color_grid",
  "objective": "Get blue into at least 2 corners.",
  "reward": 250
}
```

Always return 200 quickly — the Hub records non-2xx/timeouts as
`delivered: false` and shows the host a "read it aloud or resend" warning.

## Phase 3: Color Grid RFID flow

The shelf Pi POSTs placements as they happen and a full snapshot on boot:

```
[rfid reader event] → [function: build {row, col, color, tag_id}]
  → [http request POST http://<hub>:3000/api/hook/grid/placement, X-Prism-Token header]
```

Cell addressing is zero-indexed from the top-left **as players face the
shelves** — verify with one object in the top-left cubby before show night
(see COLOR_GRID.md for the diagram and the resync endpoint).
