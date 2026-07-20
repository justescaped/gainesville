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

## Extension point: a custom `ui_component` — worked example: Color Grid

The generic timer screen (`src/stage/Stage.jsx → ActiveMinigame`) covers any
manifest with `ui_component: null`. Two engines ship as reference
implementations: `"quiz"` (Phase 2) and `"grid"` (Phase 3). **Color Grid is
the one to copy** — it's the smaller of the two and touches every layer.
Follow its file trail to add a hypothetical `"color_clash"`:

1. **Manifest** — `minigames/color_grid.json` sets `"ui_component": "grid"`
   plus its engine-specific settings inside the per-mode blocks. Your new
   manifest sets `"ui_component": "color_clash"` and whatever settings your
   engine reads.

2. **Server engine** — `server/grid.js`. The pattern:
   - a module-level state object (one active round or `null`), a `snapshot()`
     that returns ONLY what clients may see, and `setEmitter()` so
     `index.js` can broadcast it (`io.emit('grid', snap)`)
   - `preflight(mode, settings)` — throw to block a bad launch *before* any
     state changes
   - `launch({ sessionId, minigameId, mode, manifest, teams, timer })`,
     `stop()`, `isActive()`, `onTimerExpired()`
   - all Chroma through `actions().writeChroma(...)` — never touch totals
   Note grid.js's snapshot discipline: during the build phase the target is
   *omitted from the payload*, not hidden client-side. If your minigame has a
   secret, filter it server-side the same way.

3. **Wire the engine** — three one-line hookups, all visible by grepping
   `gridEngine` in:
   - `server/actions.js` (`startMinigame` preflight + launch, `endMinigame` stop)
   - `server/index.js` (emitter, timer-expiry hook, snapshot on socket connect)
   - plus any REST/hook routes your engine needs (`server/routes/phase3.js`
     and the `/grid/*` block in `server/routes/hooks.js` are the model)

4. **Stage view** — `src/stage/GridStage.jsx`, a pure renderer of the
   snapshot. Register it in `Stage.jsx` next to the existing branches:
   ```jsx
   if (active && grid.active) return <GridStage grid={grid} timer={timer} teams={teams} />;
   ```
   Subscribe the socket event in `src/hub.jsx` (`socket.on('grid', setGrid)`).
   Keep the greyscale-world / team-color-only rule (see ARCHITECTURE.md).

5. **Admin panel** — `src/admin/GridPanel.jsx` replaces the generic
   MinigamePanel on Live while your engine is active (see the branch in
   `src/admin/Live.jsx`), and `src/admin/Minigames.jsx` gets a settings block
   keyed on your `ui_component`.

6. **Mole support (free)** — set `has_mole: true` in the game show block and
   the Part 1 objective system assigns/delivers automatically for any non-quiz
   minigame. Link the assignment to your round if you want it in your reveal
   (see `setMoleAssignment` / `refreshMoleReveal` in grid.js).
