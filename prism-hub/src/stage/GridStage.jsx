import React from 'react';
import { teamHex, fmtTime, GRID_GLYPH } from '../hub.jsx';
import { CountdownRing } from './QuizStage.jsx';

// GridStage — everything the audience sees while Color Grid runs.
// Pure renderer. The build-phase snapshot deliberately does NOT contain the
// target pattern (server-filtered, not CSS-hidden) — there is nothing to find
// in this DOM between reveal and scoring.
//
// Every color pairs with a shape glyph (▲ ■ ● ◆) so the pattern survives
// colorblindness and washed-out livestream encoding.

function StageCell({ color, size, outline, badge }) {
  const filled = color && color !== 'empty';
  return (
    <div className="relative rounded-lg flex items-center justify-center"
      style={{
        width: size, height: size,
        background: filled ? teamHex(color) : 'rgba(255,255,255,0.04)',
        border: outline ? `4px solid ${outline}` : '2px solid rgba(255,255,255,0.12)',
        color: 'rgba(0,0,0,0.5)', fontSize: size * 0.5, fontWeight: 700
      }}>
      {filled ? GRID_GLYPH[color] : ''}
      {badge && badge !== 'empty' && (
        <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center text-sm border-2 border-ink"
          style={{ background: teamHex(badge), color: 'rgba(0,0,0,0.55)' }}>
          {GRID_GLYPH[badge]}
        </span>
      )}
    </div>
  );
}

function StageGrid({ rows, cols, cell }) {
  // Size cells to fit ~60vh whatever the grid dimensions.
  const size = Math.min(110, Math.floor(560 / Math.max(rows, cols)));
  return (
    <div className="inline-grid gap-2 p-4 rounded-2xl bg-white/[0.03] border border-white/10"
      style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
      {Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (
        <React.Fragment key={`${r}-${c}`}>{cell(r, c, size)}</React.Fragment>
      )))}
    </div>
  );
}

function ChromaStrip({ teams }) {
  if (teams.length <= 1) return null;
  return (
    <div className="shrink-0 flex justify-center gap-10 py-4 border-t border-white/10">
      {teams.map((t) => (
        <div key={t.id} className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full" style={{ background: teamHex(t.color) }} />
          <span className="text-bone/70 text-xl">{t.name}</span>
          <span className="num text-2xl font-bold" style={{ color: teamHex(t.color) }}>{t.chroma}</span>
        </div>
      ))}
    </div>
  );
}

function RevealView({ grid, teams }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="flex items-center gap-10">
          <div>
            <div className="text-bone/40 uppercase tracking-[0.35em] text-2xl mb-1 text-center">
              {grid.mid_build ? 'Look again' : 'Memorize the pattern'}
            </div>
            <div className="text-bone/60 text-xl text-center">{grid.puzzle_name}</div>
          </div>
          <CountdownRing remaining_ms={grid.reveal_remaining_ms ?? 0} total_seconds={grid.reveal_seconds ?? 10} />
        </div>
        <StageGrid rows={grid.rows} cols={grid.cols}
          cell={(r, c, size) => <StageCell color={grid.target[r][c]} size={size} />} />
      </div>
      <ChromaStrip teams={teams} />
    </div>
  );
}

function BuildView({ grid, timer, teams }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="text-bone/40 uppercase tracking-[0.35em] text-2xl">Build it from memory</div>
        <div className={`num text-[9rem] leading-none font-black ${timer.expired ? 'timer-expired' : 'text-bone'}`}>
          {fmtTime(timer.remaining_ms)}
        </div>
        <StageGrid rows={grid.rows} cols={grid.cols}
          cell={(r, c, size) => (
            <StageCell size={size}
              color={grid.show_placements ? (grid.cells?.[r]?.[c] ?? 'empty') : 'empty'} />
          )} />
      </div>
      <ChromaStrip teams={teams} />
    </div>
  );
}

function ScoredView({ grid, teams }) {
  const result = grid.result;
  const correctOf = (r, c) => result.per_cell.find((x) => x.row === r && x.col === c);
  const mole = grid.mole;
  const moleTeamHex = mole ? teamHex(mole.team_color) : null;
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex items-center justify-center gap-14 px-10">
        <div className="text-center">
          <div className="text-bone/40 uppercase tracking-[0.3em] text-xl mb-3">
            {result.perfect ? <span className="text-tgreen">Perfect grid!</span> : 'The result'}
          </div>
          <StageGrid rows={grid.rows} cols={grid.cols}
            cell={(r, c, size) => {
              const cell = correctOf(r, c);
              return (
                <StageCell size={size} color={cell.placed}
                  outline={cell.correct ? '#21D07A' : '#FF3B3B'}
                  badge={cell.correct ? null : cell.target} />
              );
            }} />
          <div className="text-bone/40 text-lg mt-3">Green outline = correct · red = wrong (badge shows the target)</div>
        </div>

        <div className="space-y-6">
          <div>
            <div className="text-bone/40 uppercase tracking-[0.3em] text-lg mb-2">Scores</div>
            {result.per_team.map((t) => (
              <div key={t.team_id} className="flex items-baseline gap-4 py-1">
                <span className="text-3xl font-bold w-56 truncate" style={{ color: teamHex(t.color) }}>{t.name}</span>
                <span className="num text-3xl font-black">{t.correct} ✓</span>
                <span className="num text-2xl text-bone/70">{t.points >= 0 ? '+' : ''}{t.points}</span>
                {t.time_bonus > 0 && <span className="text-tgreen text-xl">incl. time bonus</span>}
              </div>
            ))}
          </div>

          {mole && (
            <div className="rounded-2xl border-2 border-white/15 px-8 py-5">
              <div className="text-bone/40 uppercase tracking-[0.3em] text-lg mb-1">The mole was…</div>
              <div className="text-4xl font-black" style={{ color: moleTeamHex }}>{mole.team_name}</div>
              <div className="text-2xl text-bone/80 italic mt-1">“{mole.objective}”</div>
              <div className={`text-2xl mt-2 font-bold ${
                mole.outcome === 'hit' ? 'text-tgreen' : mole.outcome === 'missed' ? 'text-tred' : 'text-bone/50'}`}>
                {mole.outcome === 'hit' ? <>They pulled it off — +<span className="num">{mole.reward}</span> Chroma!</>
                  : mole.outcome === 'missed' ? 'They didn’t manage it.'
                  : 'Did they pull it off? The host decides…'}
              </div>
            </div>
          )}
        </div>
      </div>
      <ChromaStrip teams={teams} />
    </div>
  );
}

export default function GridStage({ grid, timer, teams }) {
  if (grid.phase === 'reveal') return <RevealView grid={grid} teams={teams} />;
  if (grid.phase === 'build') return <BuildView grid={grid} timer={timer} teams={teams} />;
  if (grid.phase === 'scored') return <ScoredView grid={grid} teams={teams} />;
  return null;
}
