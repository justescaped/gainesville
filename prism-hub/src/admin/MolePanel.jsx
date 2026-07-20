import React, { useState } from 'react';
import { api, Btn, teamHex } from '../hub.jsx';

// MolePanel — the Admin-only "MOLE — DO NOT SHOW" panel (Phase 3, Part 1).
// Collapsed by default; a tap reveals the assignment. Works for any minigame
// using text objectives. Quiz minigames keep their own auto-scored panel.
export default function MolePanel({ mole, teams, hasMole, toast }) {
  const [open, setOpen] = useState(false);
  const call = (path, body) => api(path, 'POST', body).catch((e) => toast(e.message));

  if (!mole && !hasMole) return null;

  return (
    <div className="rounded-lg border border-tred/40 overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 text-left text-xs uppercase tracking-widest text-tred">
        {open ? '▾' : '▸'} Mole — do not show
      </button>
      {open && (
        <div className="p-3 border-t border-tred/40 space-y-2 text-sm">
          {!mole && (
            <>
              <div className="text-fog">No mole assigned. Pick a team to assign one:</div>
              <div className="flex flex-wrap gap-1">
                {teams.map((t) => (
                  <Btn key={t.id} className="!min-h-[36px] !px-3 text-xs"
                    onClick={() => call('/mole/assign', { team_id: t.id })}>{t.name}</Btn>
                ))}
                <Btn className="!min-h-[36px] !px-3 text-xs" onClick={() => call('/mole/assign', {})}>Random</Btn>
              </div>
            </>
          )}
          {mole && (
            <>
              <div>
                Mole: <b style={{ color: teamHex(mole.team_color) }}>{mole.team_name}</b>
                {mole.reward > 0 && <span className="text-fog"> · reward <b className="num text-bone">{mole.reward}</b></span>}
              </div>
              <div className="rounded bg-ink border border-line px-2 py-1.5 italic">“{mole.objective_text}”</div>
              {!mole.delivered && (
                <div className="rounded border border-tred/60 bg-tred/10 text-tred text-xs px-2 py-1.5">
                  ⚠ Objective not delivered — read it aloud or resend.
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {!mole.auto_scored && (
                  <Btn className="!min-h-[36px] !px-3 text-xs" onClick={() => call(`/mole/assignment/${mole.id}/reroll`)}>Reroll objective</Btn>
                )}
                <Btn className="!min-h-[36px] !px-3 text-xs" onClick={() => call(`/mole/assignment/${mole.id}/resend`)}>Resend to device</Btn>
                <Btn className="!min-h-[36px] !px-3 text-xs" kind="danger" onClick={() => call(`/mole/assignment/${mole.id}/clear`)}>Clear mole</Btn>
              </div>
              {!mole.auto_scored && (
                <>
                  <div className="text-xs text-fog">Reassign:</div>
                  <div className="flex flex-wrap gap-1">
                    {teams.filter((t) => t.id !== mole.team_id).map((t) => (
                      <Btn key={t.id} className="!min-h-[36px] !px-3 text-xs"
                        onClick={() => call(`/mole/assignment/${mole.id}/reassign`, { team_id: t.id })}>{t.name}</Btn>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Btn className="!min-h-[40px] !border-tgreen/60 text-tgreen"
                      onClick={() => call(`/mole/assignment/${mole.id}/resolve`, { outcome: 'hit' })}>
                      ✓ Hit{mole.reward > 0 ? ` (+${mole.reward})` : ''}
                    </Btn>
                    <Btn className="!min-h-[40px]"
                      onClick={() => call(`/mole/assignment/${mole.id}/resolve`, { outcome: 'missed' })}>
                      ✗ Missed
                    </Btn>
                  </div>
                </>
              )}
              {mole.auto_scored && (
                <div className="text-xs text-fog">Auto-scored by the question engine — resolves itself at game end.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
