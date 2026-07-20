import React from 'react';
import { teamHex } from '../hub.jsx';

// QuizStage — everything the audience sees while a quiz minigame runs.
// Pure renderer: all timing/scoring arrives in the `quiz` snapshot.
// Note: the snapshot carries mole_team_id for the Admin panel; this component
// deliberately never renders it until the `ended` reveal.

export function CountdownRing({ remaining_ms, total_seconds }) {
  const R = 54, C = 2 * Math.PI * R;
  const frac = Math.max(0, Math.min(1, remaining_ms / (total_seconds * 1000)));
  const secs = Math.ceil(remaining_ms / 1000);
  const low = secs <= 5;
  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#26262A" strokeWidth="10" />
        <circle cx="60" cy="60" r={R} fill="none" stroke={low ? '#FF3B3B' : '#E8E8E6'} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center num text-4xl font-black ${low ? 'text-tred' : ''}`}>
        {secs}
      </div>
    </div>
  );
}

function ChromaStrip({ teams, quiz }) {
  return (
    <div className="shrink-0 flex justify-center gap-10 py-4 border-t border-white/10">
      {teams.map((t) => (
        <div key={t.id} className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full" style={{ background: teamHex(t.color) }} />
          <span className="text-bone/70 text-xl">{t.name}</span>
          <span className="num text-2xl font-bold" style={{ color: teamHex(t.color) }}>{t.chroma}</span>
          {quiz.streaks?.[t.id] >= 2 && (
            <span className="text-tyellow text-lg" title="streak">🔥<span className="num text-sm font-bold">{quiz.streaks[t.id]}</span></span>
          )}
        </div>
      ))}
    </div>
  );
}

function QuestionView({ quiz, teams }) {
  const team = teams.find((t) => t.id === quiz.answering_team_id);
  const q = quiz.question;
  const fb = quiz.feedback;
  const inFeedback = quiz.phase === 'feedback';
  const cols = q.answers.length <= 2 ? 'grid-cols-2' : 'grid-cols-2';

  return (
    <div className="h-full flex flex-col">
      {/* active team banner */}
      <div className="shrink-0 text-center py-4 text-4xl font-black tracking-tight"
        style={{ background: `${teamHex(team?.color)}22`, color: teamHex(team?.color) }}>
        {team?.name?.toUpperCase()}{quiz.passed_from_team_id ? ' — PASSED TO YOU' : ''}
      </div>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-12 gap-5">
        <div className="flex items-center gap-8 w-full max-w-6xl">
          <div className="flex-1">
            <div className="text-bone/40 uppercase tracking-[0.25em] text-lg mb-2">
              Question {q.number}{q.total ? ` of ${q.total}` : ''} · <span className="num">{q.value}</span> Chroma
            </div>
            <div className="text-5xl font-bold leading-tight">{q.text}</div>
          </div>
          {quiz.phase === 'question' && (
            <CountdownRing remaining_ms={quiz.question_remaining_ms ?? 0} total_seconds={quiz.question_seconds} />
          )}
        </div>

        {q.image && (
          <img src={q.image} alt="" className="max-h-[26vh] rounded-xl border border-white/10 object-contain" />
        )}

        <div className={`grid ${cols} gap-4 w-full max-w-6xl`}>
          {q.answers.map((a) => {
            const isCorrect = inFeedback && fb.correct_letter === a.letter;
            const isSelected = inFeedback && fb.selected === a.letter;
            const wrongPick = isSelected && !fb.correct;
            return (
              <div key={a.letter}
                className={`rounded-2xl border-2 px-6 py-5 flex items-center gap-5 transition-colors ${
                  isCorrect ? 'border-tgreen bg-tgreen/15'
                  : wrongPick ? 'border-tred bg-tred/15'
                  : 'border-white/15 bg-white/5'}`}>
                <span className={`w-14 h-14 rounded-xl flex items-center justify-center text-3xl font-black shrink-0 ${
                  isCorrect ? 'bg-tgreen text-ink' : wrongPick ? 'bg-tred text-ink' : 'bg-white/10'}`}>
                  {a.letter}
                </span>
                <span className="text-3xl font-semibold">{a.text}</span>
              </div>
            );
          })}
        </div>

        {/* pass tile — game show only, its own distinct style */}
        {quiz.mode === 'gameshow' && !q.was_passed && (
          <div className={`w-full max-w-6xl rounded-2xl border-2 border-dashed px-6 py-4 text-center text-2xl font-bold tracking-widest ${
            quiz.pass_available ? 'border-bone/50 text-bone/80' : 'border-white/10 text-bone/25'}`}>
            PASS — {quiz.passes?.[quiz.answering_team_id] ?? 0} left
          </div>
        )}

        {/* feedback strip */}
        {inFeedback && (
          <div className={`text-4xl font-black ${fb.correct ? 'text-tgreen' : 'text-tred'}`}>
            {fb.correct
              ? <>+{fb.points} Chroma{fb.streak >= 2 ? `  ·  streak ×${fb.streak}` : ''}</>
              : fb.selected === null ? 'Time\u2019s up!' : 'Wrong!'}
            {fb.pass_outcome === 'paid_off' && <span className="text-bone/70 text-3xl ml-4">Pass paid off: +{2 * fb.value} to the passer</span>}
            {fb.pass_outcome === 'backfired' && <span className="text-bone/70 text-3xl ml-4">Pass backfired: −{2 * fb.value} from the passer</span>}
          </div>
        )}
      </div>

      <ChromaStrip teams={teams} quiz={quiz} />
    </div>
  );
}

function IntroView({ quiz, teams }) {
  const team = teams.find((t) => t.id === quiz.intro_team_id);
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="text-bone/40 uppercase tracking-[0.4em] text-2xl">Next up</div>
        <div className="text-8xl font-black tracking-tight" style={{ color: teamHex(team?.color) }}>
          {team?.name?.toUpperCase()} — YOU'RE UP
        </div>
      </div>
      <ChromaStrip teams={teams} quiz={quiz} />
    </div>
  );
}

function PickView({ quiz }) {
  const { pick, attempt } = quiz;
  return (
    <div className="h-full flex flex-col items-center justify-center gap-8 px-16">
      <div className="text-center">
        <div className="text-5xl font-black tracking-tight">Choose your categories</div>
        <div className="text-bone/50 text-2xl mt-2">
          Pick {pick.needed} — buttons cycle, PASS selects
          {attempt && <span className="ml-4">· Attempt {attempt.no} of {attempt.max}</span>}
          {attempt?.previous_scores?.length > 0 && (
            <span className="ml-4">· Previous: <span className="num">{attempt.previous_scores[attempt.previous_scores.length - 1]}</span></span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-5 w-full max-w-6xl">
        {pick.categories.map((c) => (
          <div key={c.id}
            className={`rounded-2xl border-2 p-6 text-center transition-all ${
              c.locked ? 'border-white/5 opacity-30'
              : c.selected ? 'border-tgreen bg-tgreen/10'
              : c.highlighted ? 'border-bone bg-white/10 scale-105'
              : 'border-white/15 bg-white/5'}`}>
            <div className="text-3xl font-bold" style={{ color: c.locked ? undefined : c.color || undefined }}>{c.name}</div>
            <div className="text-bone/40 text-lg mt-1">{c.locked ? 'used' : `${c.question_count} questions`}</div>
            {c.selected && <div className="text-tgreen text-xl mt-1">✓ selected</div>}
          </div>
        ))}
      </div>
      <div className="text-bone/40 text-xl">{pick.categories.filter((c) => c.selected).length} / {pick.needed} selected</div>
    </div>
  );
}

function EndedView({ quiz, teams }) {
  const e = quiz.ended;
  const sorted = [...e.scores].sort((a, b) => b.score - a.score);
  const mole = e.mole_team_id ? teams.find((t) => t.id === e.mole_team_id) : null;
  return (
    <div className="h-full flex flex-col items-center justify-center gap-8">
      <div className="text-6xl font-black tracking-tight">Final Scores</div>
      <div className="flex gap-10">
        {sorted.map((s, i) => (
          <div key={s.team_id} className="text-center">
            <div className="text-bone/40 uppercase tracking-widest">{i === 0 ? 'Winner' : `#${i + 1}`}</div>
            <div className="text-3xl font-bold" style={{ color: teamHex(s.color) }}>{s.name}</div>
            <div className="num text-6xl font-black" style={{ color: teamHex(s.color) }}>{s.score}</div>
          </div>
        ))}
      </div>
      {mole && (
        <div className="text-center mt-4 rounded-2xl border-2 border-white/15 px-10 py-6">
          <div className="text-bone/40 uppercase tracking-[0.3em] text-xl mb-1">The mole was…</div>
          <div className="text-5xl font-black" style={{ color: teamHex(mole.color) }}>{mole.name}</div>
          <div className={`text-2xl mt-2 ${e.mole_hit ? 'text-tgreen' : 'text-bone/50'}`}>
            {e.mole_hit
              ? <>They hit <span className="num">{e.mole_target}</span> exactly — reward paid!</>
              : <>Target was exactly <span className="num">{e.mole_target}</span> — missed.</>}
          </div>
        </div>
      )}
      {quiz.attempt && (
        <div className="text-bone/50 text-2xl">Attempt {quiz.attempt.no} of {quiz.attempt.max}</div>
      )}
    </div>
  );
}

export default function QuizStage({ quiz, teams }) {
  if (quiz.phase === 'category_pick') return <PickView quiz={quiz} />;
  if (quiz.phase === 'intro') return <IntroView quiz={quiz} teams={teams} />;
  if (quiz.phase === 'question' || quiz.phase === 'feedback') return <QuestionView quiz={quiz} teams={teams} />;
  if (quiz.phase === 'ended') return <EndedView quiz={quiz} teams={teams} />;
  return null;
}
