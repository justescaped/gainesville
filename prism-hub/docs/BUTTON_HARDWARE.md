# Physical Button Hardware (Phase 2)

Five arcade buttons — **A, B, C, D,** and a dedicated **PASS** (label it on the
hardware) — wired to either:

- a **USB encoder board** (the zero-delay arcade encoders sold with button
  kits), or
- a **Raspberry Pi Pico** running USB HID keyboard firmware (CircuitPython
  `adafruit_hid`, one keycode per GPIO).

Either way the box is just a keyboard. It plugs into the machine driving the
**Stage** screen — presses arrive as ordinary keystrokes on the `/stage` page.

## How a press travels

```
button → USB HID keydown → /stage page forwards raw event.code over Socket.IO
       → Hub maps it (Settings → Input), debounces 200ms, decides what it means
       → quiz engine scores / passes / picks a category
```

Three rules baked in:
- The Stage **never** decides anything — it forwards raw codes only.
- `event.repeat` is ignored, so a held button can't machine-gun.
- Input is locked out during intro/feedback/ended, when no question is active,
  and after an answer is registered for the current question.

## Mapping keys (Settings → Input)

Defaults assume an encoder that emits F13–F17:

| Action | Default |
|--------|---------|
| A | `F13` |
| B | `F14` |
| C | `F15` |
| D | `F16` |
| PASS | `F17` |

Cheap encoders emit whatever they like — that's what **Learn** is for:

1. Open `/stage` on the machine the box is plugged into (any tab showing the
   Stage works; it's what forwards the keystrokes).
2. On the Admin tablet: **Settings → Input → Learn** next to an action.
3. Press the physical button. The received `event.code` is captured, saved,
   and shown. Repeat for each button.

You can also type a code by hand (values are JS `KeyboardEvent.code` strings:
`KeyA`, `Numpad1`, `F13`, …).

## Test panel

Settings → Input shows the **last 10 received keycodes** with timestamps and
whether each mapped to an action. Diagnosing a dead button takes seconds:

| Symptom | Meaning |
|---------|---------|
| Press shows in the panel, action column filled | Everything works — if the game didn't react, no question was active. |
| Press shows, action says `unmapped` | Wiring is fine; fix the mapping (use Learn). |
| Nothing appears at all | The keystroke never reached the Hub: check the USB cable/encoder header on that button, confirm a `/stage` page is open and focused on the box's machine, and check the connection dot on the Admin nav. |
| One button repeats wildly | Encoder bounce beyond the 200ms debounce — reseat the microswitch; genuinely chattering switches should be replaced. |

## If the hardware dies mid-show

The Admin Live panel has on-screen **A / B / C / D / PASS** buttons that go
through the identical server pipeline. The show continues from the tablet; no
restart needed.

## Wiring notes (encoder kits)

- Each button's microswitch → 2-pin header on the encoder; polarity doesn't
  matter on standard kits.
- Keep the PASS button physically distinct (color/position) — it is not answer E.
- The encoder needs no drivers on Raspberry Pi OS / Linux; it enumerates as a
  keyboard.
- If the Stage machine ever shows a browser dialog or loses focus, keystrokes
  stop reaching the page — run the Stage in a kiosk-mode browser to prevent it.
