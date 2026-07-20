import React, { useState } from 'react';
import { api, Btn, ColorDot, teamHex, fmtTime } from '../hub.jsx';

// QuizPanel — the gamemaster's controls while a quiz minigame runs. Replaces
// the generic timer panel on Live. The on-screen A–D/PASS buttons go through
// the exact same server pipeline as the physical hardware (full fallback).
export default function QuizPanel({ quiz, teams, timer, toast }) {
  const [moleOpen, setMoleOpen] = useState(false);
  const call = (path, body) => api(path, 'POST', body).catch((e) => toast(e.message));
  const team = teams.find((t) => t.id === quiz.answering_team_id);

  return (
    <div className="rounded-xl border border-line bg-panel p-4 flex flex-col h-full gap-3 overflow-y-auto no-scrollbar">
      {/* overall minigame timer + End Game (runs alongside the per-question clock) */}
      <div className="flex items-center gap-2">
        <span className={`num text-2xl font-bold ${timer.expired ? 'timer-expired' : ''}`}>{fmtTime(timer.remaining_ms)}</span>
        {timer.running
          ? <Btn className="!min-h-[38px]" onClick={() => call('/timer', { action: 'pause' })}>Pause</Btn>
          : <Btn className="!min-h-[38px]" onClick={() => call('/timer', { action: 'start' })}>{timer.remaining_ms < timer.duration_ms && timer.remaining_ms > 0 ? 'Resume' : 'Start'}</Btn>}
        <Btn className="!min-h-[38px]" onClick={() => call('/timer', { action: 'add', seconds: 30 })}>+30s</Btn>
        <span className="flex-1" />
        <Btn className="!min-h-[38px]" kind="danger" onClick={() => call('/minigames/end')}>End Game</Btn>
      </div>
      {/* status line */}
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-ink border border-line">{quiz.phase.replaceAll('_', ' ')}</span>
        {team && (
          <span className="flex items-center gap-2 font-semibold">
            <ColorDot color={team.color} /> {team.name}
            {quiz.passed_from_team_id && <span className="text-fog text-xs">(passed to them)</span>}
          </span>
        )}
        <span className="flex-1" />
        {quiz.phase === 'question' && (
          <span className="num text-2xl font-bold">{Math.ceil((quiz.question_remaining_ms ?? 0) / 1000)}s</span>
        )}
      </div>

      {/* category pick fallback */}
      {quiz.phase === 'category_pick' && (
        <div>
          <div className="text-xs text-fog mb-2">Tap to select for the team ({quiz.pick.categories.filter((c) => c.selected).length}/{quiz.pick.needed}) — starts automatically when full.</div>
          <div className="grid grid-cols-2 gap-2">
            {quiz.pick.categories.map((c) => (
              <button key={c.id} disabled={c.locked}
                onClick={() => call('/quiz/pick', { category_id: c.id })}
                className={`min-h-[48px] rounded-lg border px-3 text-left disabled:opacity-30 ${
                  c.selected ? 'border-tgreen bg-tgreen/10' : c.highlighted ? 'border-bone' : 'border-line hover:border-fog'}`}>
                <span className="font-semibold" style={{ color: c.color || undefined }}>{c.name}</span>
                <span className="text-xs text-fog ml-2">{c.locked ? 'used' : `${c.question_count} q`}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* live question */}
      {(quiz.phase === 'question' || quiz.phase === 'feedback') && (
        <>
          <div className="text-sm">
            <span className="text-fog">Q{quiz.question.number}{quiz.question.total ? `/${quiz.question.total}` : ''} · <span className="num">{quiz.question.value}</span> pts · correct: </span>
            <b className="text-tgreen">{quiz.question.correct_letter_admin}</b>
            <div className="mt-1 line-clamp-2">{quiz.question.text}</div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {['A', 'B', 'C', 'D'].map((l) => (
              <Btn key={l} disabled={quiz.phase !== 'question' || !quiz.question.answers.some((a) => a.letter === l)}
                onClick={() => call('/quiz/input', { button: l })}
                className={quiz.question.correct_letter_admin === l ? '!border-tgreen/60' : ''}>
                {l}
              </Btn>
            ))}
            <Btn disabled={quiz.phase !== 'question' || !quiz.pass_available}
              onClick={() => call('/quiz/input', { button: 'PASS' })}>
              PASS
            </Btn>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => call('/quiz/skip')} disabled={quiz.phase !== 'question'} title="New question, same team">Skip question</Btn>
            {quiz.mode === 'gameshow' && (
              <Btn onClick={() => call('/quiz/advance_turn')} disabled={quiz.phase !== 'question'} title="Skip this team's turn">Force next turn</Btn>
            )}
          </div>
        </>
      )}

      {quiz.phase === 'ended' && (
        <div className="text-sm text-fog">Quiz finished — scores are on the Stage. Press <b className="text-bone">End Game</b> to return to the leaderboard.</div>
      )}

      {/* per-team quiz status */}
      {quiz.mode === 'gameshow' && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {teams.map((t) => (
            <div key={t.id} className="rounded-lg border border-line bg-ink p-2">
              <div className="text-xs truncate" style={{ color: teamHex(t.color) }}>{t.name}</div>
              <div className="num font-bold">{quiz.scores?.[t.id] ?? 0}</div>
              <div className="text-[10px] text-fog">
                {quiz.streaks?.[t.id] >= 2 ? `🔥${quiz.streaks[t.id]} ` : ''}P:{quiz.passes?.[t.id] ?? 0}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MOLE — collapsed by default, never on Stage */}
      {quiz.mode === 'gameshow' && (
        <div className="rounded-lg border border-tred/40 overflow-hidden">
          <button onClick={() => setMoleOpen(!moleOpen)}
            className="w-full px-3 py-2 text-left text-xs uppercase tracking-widest text-tred">
            {moleOpen ? '▾' : '▸'} Mole — do not show
          </button>
          {moleOpen && (
            <div className="p-3 border-t border-tred/40 space-y-2 text-sm">
              {quiz.mole_team_id ? (
                <div>
                  Mole: <b style={{ color: teamHex(teams.find((t) => t.id === quiz.mole_team_id)?.color) }}>
                    {teams.find((t) => t.id === quiz.mole_team_id)?.name}
                  </b>
                  <span className="text-fog"> · in-game </span>
                  <b className="num">{quiz.scores?.[quiz.mole_team_id] ?? 0}</b>
                  <span className="text-fog"> / target exactly </span>
                  <b className="num">{quiz.mole_target}</b>
                </div>
              ) : <div className="text-fog">No mole assigned.</div>}
              <div className="flex flex-wrap gap-1">
                {teams.map((t) => (
                  <Btn key={t.id} className="!min-h-[36px] !px-3 text-xs"
                    kind={quiz.mole_team_id === t.id ? 'primary' : 'default'}
                    onClick={() => call('/quiz/mole', { team_id: t.id })}>
                    {t.name}
                  </Btn>
                ))}
                <Btn className="!min-h-[36px] !px-3 text-xs" kind="danger" onClick={() => call('/quiz/mole', { team_id: null })}>Clear</Btn>
              </div>
            </div>
          )}
        </div>
      )}

      {/* escape room attempt info */}
      {quiz.mode === 'escaperoom' && quiz.attempt && (
        <div className="text-xs text-fog">
          Attempt <b className="text-bone num">{quiz.attempt.no}</b> of <span className="num">{quiz.attempt.max}</span>
          {quiz.attempt.previous_scores?.length > 0 && (
            <> · previous scores: <span className="num">{quiz.attempt.previous_scores.join(', ')}</span> (only the newest counts)</>
          )}
        </div>
      )}
    </div>
  );
}
