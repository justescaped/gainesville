import React from 'react';
import { api, Btn, fmtTime, teamHex } from '../hub.jsx';
import { Cell } from './GridPuzzles.jsx';
import MolePanel from './MolePanel.jsx';

// GridPanel — the gamemaster's controls while a Color Grid round runs.
// The manual cell editor is the RFID fallback: tap a cell to cycle its color,
// then Score Now. Same append-only pipeline as the hardware.

const CYCLE = ['empty', 'red', 'blue', 'green', 'yellow'];

export default function GridPanel({ grid, state, timer, toast }) {
  const call = (path, body) => api(path, 'POST', body).catch((e) => toast(e.message));
  const teams = state.teams;

  const tapCell = (r, c) => {
    const cur = grid.cells?.[r]?.[c] ?? 'empty';
    call('/grid/cell', { row: r, col: c, color: CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length] });
  };

  const revealAllowed = grid.mode === 'escaperoom' || state.minigames.find((m) => m.id === grid.minigame_id)?.[grid.mode]?.allow_repeat_reveal;

  return (
    <div className="rounded-xl border border-line bg-panel p-4 flex flex-col h-full gap-3 overflow-y-auto no-scrollbar">
      {/* build timer + End Game */}
      <div className="flex items-center gap-2">
        <span className={`num text-2xl font-bold ${timer.expired ? 'timer-expired' : ''}`}>{fmtTime(timer.remaining_ms)}</span>
        {timer.running
          ? <Btn className="!min-h-[38px]" onClick={() => call('/timer', { action: 'pause' })}>Pause</Btn>
          : <Btn className="!min-h-[38px]" onClick={() => call('/timer', { action: 'start' })}>Start</Btn>}
        <Btn className="!min-h-[38px]" onClick={() => call('/timer', { action: 'add', seconds: 30 })}>+30s</Btn>
        <span className="flex-1" />
        <Btn className="!min-h-[38px]" kind="danger" onClick={() => call('/minigames/end')}>End Game</Btn>
      </div>

      {/* status line */}
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-ink border border-line">
          {grid.phase}{grid.mid_build ? ' (repeat)' : ''}
        </span>
        <span className="text-sm text-fog">{grid.puzzle_name} · {grid.rows}×{grid.cols} · {grid.difficulty}</span>
        <span className="flex-1" />
        {grid.phase === 'reveal' && (
          <span className="num text-2xl font-bold">{Math.ceil((grid.reveal_remaining_ms ?? 0) / 1000)}s</span>
        )}
      </div>

      {grid.phase === 'reveal' && (
        <div>
          <div className="text-xs text-fog mb-1">Target showing on Stage:</div>
          <div className="inline-grid gap-[3px] p-2 rounded-lg bg-ink border border-line"
            style={{ gridTemplateColumns: `repeat(${grid.cols}, auto)` }}>
            {grid.target.map((row, r) => row.map((color, c) => (
              <Cell key={`${r}-${c}`} color={color} size={Math.min(34, 260 / Math.max(grid.rows, grid.cols))} />
            )))}
          </div>
        </div>
      )}

      {grid.phase === 'build' && (
        <>
          <div className="flex gap-2">
            <Btn kind="primary" onClick={() => call('/grid/score')}>Score Now</Btn>
            <Btn disabled={!revealAllowed} onClick={() => call('/grid/reveal_again')}
              title={revealAllowed ? '' : 'Enable allow_repeat_reveal in minigame settings'}>
              Reveal Again
            </Btn>
          </div>
          <div>
            <div className="text-xs text-fog mb-1">Shelf state — tap a cell to cycle (manual fallback if RFID dies):</div>
            <div className="inline-grid gap-[3px] p-2 rounded-lg bg-ink border border-line"
              style={{ gridTemplateColumns: `repeat(${grid.cols}, auto)` }}>
              {(grid.cells || []).map((row, r) => row.map((color, c) => (
                <Cell key={`${r}-${c}`} color={color} size={Math.min(40, 300 / Math.max(grid.rows, grid.cols))} onClick={() => tapCell(r, c)} />
              )))}
            </div>
          </div>
        </>
      )}

      {grid.phase === 'scored' && grid.result && (
        <div className="space-y-2">
          <div className="text-sm">
            {grid.result.perfect ? <b className="text-tgreen">PERFECT GRID!</b> : 'Scored.'}
            <span className="text-fog"> Results are on the Stage — press <b className="text-bone">End Game</b> to return to the leaderboard.</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {grid.result.per_team.map((t) => (
              <div key={t.team_id} className="rounded-lg border border-line bg-ink p-2">
                <div className="text-xs truncate" style={{ color: teamHex(t.color) }}>{t.name}</div>
                <div className="num font-bold">{t.correct} ✓</div>
                <div className="text-[10px] text-fog num">{t.points >= 0 ? '+' : ''}{t.points}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* mole — text objectives via Part 1; visible pending or assignable */}
      {grid.mode === 'gameshow' && (
        <MolePanel mole={state.mole} teams={teams} hasMole={true} toast={toast} />
      )}
    </div>
  );
}
