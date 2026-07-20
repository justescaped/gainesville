# Adding a Minigame

Minigames are **manifests**, not code. To add minigame #4 through #20, drop a
JSON file in `/minigames` and restart the Hub. That's the whole flow. The three
seeded ones (`you_gave_me_your_word`, `build_or_bust`, `rainball`) are just
example manifests — copy one.

## 1. Create the manifest

`/minigames/color_clash.json`:

```json
{
  "id": "color_clash",
  "name": "Color Clash",
  "image": null,
  "round_number": 4,
  "enabled_modes": ["gameshow", "escaperoom"],
  "ui_component": null,
  "gameshow": {
    "timer_seconds": 300,
    "chroma_rules": { "win": 200, "second": 100, "third": 50, "last": 0, "participation": 25 },
    "has_mole": false,
    "custom": {}
  },
  "escaperoom": {
    "timer_seconds": 420,
    "chroma_rules": { "complete": 150, "per_second_remaining": 1, "penalty": -50 },
    "custom": {}
  },
  "nodered": { "on_start": "", "on_end": "", "inbound_key": "color_clash" }
}
```

### Field notes
- **`id`** — unique, lowercase, no spaces. This is the filename and the API id. Immutable once live.
- **`round_number`** — game-show slot. Also editable later by drag-reordering on the Minigames screen.
- **`enabled_modes`** — which modes it shows up in. At least one.
- **`ui_component`** — see the extension point below. `null` = the generic
  full-screen timer Stage view, which is all Phase 1 renders.
- **`gameshow` / `escaperoom`** — per-mode blocks. Only the ones you list in
  `enabled_modes` are required.
  - `timer_seconds` — starting duration. The Admin edits this as minutes+seconds.
  - `chroma_rules` — a free-form map. **Phase 1 does not auto-apply these** —
    scoring is manual quick-add or an inbound webhook. The rules are stored so
    that (a) Phase 2's software-native minigames can read them to score
    automatically, and (b) `manifest_push_url` can ship them to a Pi hosting the
    minigame. Add whatever keys your future scoring logic needs.
  - `has_mole` (game show) — stored for Phase 2 mole logic; inert in Phase 1.
  - `custom` — anything else you want to hang on the manifest.
- **`nodered`**
  - `on_start` / `on_end` — optional full URLs that override the default
    `<base>/prism/minigame_start|minigame_end` for this minigame only.
  - `inbound_key` — the tag a Pi puts on its webhook posts so you can tell which
    minigame reported a result.

## 2. Restart the Hub

Manifests load at boot (`loadManifests()` in `server/core.js`). Restart, and the
new tile appears on the Live screen and the Minigames editor.

## 3. Tune it in the UI

Open **Admin → Minigames**, pick it, upload an image, adjust timers/rules, wire
Node-RED URLs, drag it into the right round slot, Save. Saving writes the file
back and (if `manifest_push_url` is set) POSTs the config to Node-RED.

## The three ways Chroma gets applied (design intent)

Phase 1 ships #1; #2 and #3 build on these same manifests:

1. **Manual** — the gamemaster taps quick-add buttons on the Live screen.
   All three seeded minigames work this way today.
2. **Software-native (Phase 2)** — minigames that run *inside* this app (Trivia
   Twist, Puzzle Pass) will read `chroma_rules` and award points automatically
   from in-app performance.
3. **External Pi-hosted** — a minigame running on another Pi reports its result
   via `POST /api/hook/chroma` (or `/minigame/end`), tagged with its
   `inbound_key`. The Hub applies it through the same ledger.

## Extension point: a custom Stage view (`ui_component`)

Phase 1 renders every active minigame with the generic timer screen
(`src/stage/Stage.jsx → ActiveMinigame`). To give a minigame a bespoke Stage
visual later:

1. Set `"ui_component": "color_clash"` in the manifest.
2. In `Stage.jsx`, before falling through to `<ActiveMinigame>`, branch on
   `active.ui_component` and render your component, e.g.:
   ```jsx
   const CUSTOM = { color_clash: ColorClashStage };
   if (active.ui_component && CUSTOM[active.ui_component]) {
     const View = CUSTOM[active.ui_component];
     return <View minigame={active} timer={timer} teams={teams} />;
   }
   ```
3. Your component reads the same `state`/`timer` from the socket — no new
   plumbing. Keep the greyscale-world / team-color-only rule (see
   ARCHITECTURE.md).
