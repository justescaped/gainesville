# Mole Objective System (Phase 3)

The mole system gives one team a secret one-sentence goal in game show mode.
The design principle: **the Hub never displays the objective anywhere public.**
It selects the team and the objective, then fires one webhook — `mole.assigned`
— at a dedicated URL. Node-RED decides how the mole is actually told: a small
screen at their bench, a thermal receipt printer producing a physical card, a
TTS speaker, a phone notification. Swapping the delivery device never requires
touching the Hub.

Objectives are **human-verifiable, not machine-scored**. The host judges
success and taps **Hit** or **Missed** on the Admin panel. This keeps
objectives free-form ("make sure your team never agrees on anything") instead
of limiting them to what software can measure.

**The one exception:** Trivia Twist / Puzzle Pass keep their Phase 2
exact-score mole, which IS auto-scored. Phase 3 only changed its delivery —
it now also fires `mole.assigned` with a generated objective ("Finish this
game with exactly 500 points.") so one delivery device serves every minigame.
Its assignment rows carry `auto_scored = 1` and the Hit/Missed buttons are
hidden for it.

## The objective library

Admin → **Mole Objectives**. Each objective:

| Field | Meaning |
|---|---|
| `text` | The objective, one sentence, read aloud-able |
| `minigame_ids` | JSON array of minigames it fits. **Empty = any minigame.** |
| `modes` | `["gameshow"]` (escape room has no mole) |
| `reward` | Chroma if achieved. `null` = use the minigame's `mole_reward` |
| `weight` | Draw odds multiplier (2 = drawn twice as often) |
| `active` | Soft disable |

Deleting an objective that has ever been assigned soft-deletes it
(`active = 0`); assignment rows snapshot `objective_text`, so the archive
stays accurate even if the library is edited later.

The library page warns when a minigame with `has_mole: true` has fewer than 3
active objectives available to it — a thin pool means visible repeats.

## Assignment flow

On minigame launch with `has_mole: true` in the game show block:

1. The Hub picks a team at random — unless `randomize_mole_team` is `false`,
   in which case no auto-assignment happens and the Admin picks a team from
   the mole panel.
2. It draws a weighted-random active objective matching the minigame.
3. It writes a `mole_assignments` row (`outcome: 'pending'`), voiding any
   still-pending assignment for the same session + minigame.
4. It fires `mole.assigned` at **Settings → Mole delivery URL** and records
   whether the call succeeded in `delivered`.

The Admin sees a collapsed panel labelled **MOLE — DO NOT SHOW** on the Live
screen. Expanded, it offers: Reroll objective · Reassign team ·
Resend to device · Clear mole · **Hit** / **Missed**.

**Resolution:** Hit writes a normal Chroma ledger entry (source `powerup`,
reason "Mole objective achieved: …") — so Phase 1 undo works on it. Missed
writes nothing. Both stamp `resolved_at` and fire `mole.resolved`.

**Color Grid:** its scoring screen includes the mole reveal. The reveal shows
"the host decides…" until Hit/Missed is tapped, then updates live on Stage.

## Delivery failure

If the webhook fails (or no URL is configured), `delivered` stays `0` and the
Admin panel shows a red warning: *"Objective not delivered — read it aloud or
resend."* The round **never blocks** on a delivery failure; the host is the
fallback device.

## Events

All mole events go to the **mole delivery URL** (falling back to
`<base>/prism/<event>` if unset):

```json
{
  "event": "mole.assigned",
  "session_id": 3,
  "minigame_id": "color_grid",
  "round_number": 6,
  "team": "blue",
  "team_name": "Team Blue",
  "objective": "Get blue into at least 2 corners.",
  "reward": 250
}
```

- `mole.rerolled` — same payload, new objective
- `mole.cleared` — `{ session_id, minigame_id, team }`
- `mole.resolved` — `{ team, objective, outcome, reward_awarded }`

A receipt printer, a bench display, and a TTS node are all one `http in` node
away — see `NODERED_SETUP.md` for the flow pattern.

## Writing good objectives

- **One sentence.** If it needs a diagram, it belongs in software, not here.
- **Judgeable at a glance** by a host who is also running the show.
- **Rule-shaped beats pattern-shaped**: "get blue into 2 corners" survives a
  mole's memory; "build this exact diagonal" does not.
- Sabotage ("make sure 3 cells end up wrong") and social goals ("get another
  team accused") both work — mix them.
- Tag minigame-specific objectives; leave social ones untagged so they can
  appear anywhere.
