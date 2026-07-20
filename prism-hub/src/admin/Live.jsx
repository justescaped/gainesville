import React, { useState } from 'react';
import { useHub, api, Btn, ColorDot, teamHex, fmtTime, inputCls, useToast } from '../hub.jsx';
import LedgerFeed from './LedgerFeed.jsx';
import QuizPanel from './QuizPanel.jsx';
import GridPanel from './GridPanel.jsx';
import MolePanel from './MolePanel.jsx';

// ---------- mode selector (Admin home when no session exists) ----------
function ModeSelector({ toast }) {
  const start = async (mode) => { try { await api('/sessions', 'POST', { mode }); } catch (e) { toast(e.message); } };
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 p-8">
      <div className="text-fog uppercase tracking-[0.3em] text-sm">Start a session</div>
      <div className="flex gap-6 w-full max-w-3xl">
        <button onClick={() => start('gameshow')}
          className="flex-1 h-52 rounded-2xl border border-line bg-panel hover:border-fog transition-colors flex flex-col items-center justify-center gap-3">
          <div className="flex gap-2">{['red', 'blue', 'green', 'yellow'].map((c) => <ColorDot key={c} color={c} size={18} />)}</div>
          <div className="text-2xl font-bold">Game Show Mode</div>
          <div className="text-fog text-sm">4 teams · rounds · territories</div>
        </button>
        <button onClick={() => start('escaperoom')}
          className="flex-1 h-52 rounded-2xl border border-line bg-panel hover:border-fog transition-colors flex flex-col items-center justify-center gap-3">
          <ColorDot color="solo" size={18} />
          <div className="text-2xl font-bold">Escape Room Mode</div>
          <div className="text-fog text-sm">1 team · chase the record</div>
        </button>
      </div>
    </div>
  );
}

// ---------- one team card with quick chroma buttons ----------
const QUICK = [10, 25, 50, 100];
function TeamCard({ team, toast }) {
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const add = async (amt, why) => {
    try { await api('/chroma', 'POST', { team_id: team.id, amount: amt, reason: why || (amt > 0 ? `+${amt} quick add` : `${amt} quick deduct`) }); }
    catch (e) { toast(e.message); }
  };
  return (
    <div className="rounded-xl border border-line bg-panel p-3" style={{ borderLeft: `4px solid ${teamHex(team.color)}` }}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-semibold truncate">{team.name}</div>
        <div className="num text-2xl font-bold" style={{ color: teamHex(team.color) }}>{team.chroma}</div>
      </div>
      <div className="text-[11px] text-fog mb-2">
        {team.territory_count} territor{team.territory_count === 1 ? 'y' : 'ies'}
        {team.powerups.filter((p) => !p.used).length > 0 && <> · {team.powerups.filter((p) => !p.used).length} power-up(s)</>}
      </div>
      <div className="grid grid-cols-4 gap-1 mb-1">
        {QUICK.map((q) => (
          <button key={q} onClick={() => add(q)}
            className="min-h-[38px] rounded bg-ink border border-line text-tgreen text-xs num hover:border-fog">+{q}</button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1 mb-1">
        {QUICK.map((q) => (
          <button key={q} onClick={() => add(-q)}
            className="min-h-[38px] rounded bg-ink border border-line text-tred text-xs num hover:border-fog">−{q}</button>
        ))}
      </div>
      {custom ? (
        <div className="flex gap-1 mt-2">
          <input className={`${inputCls} !min-h-[38px] w-20`} inputMode="numeric" placeholder="±amt" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className={`${inputCls} !min-h-[38px] flex-1`} placeholder="reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Btn className="!min-h-[38px] !px-3" kind="primary" onClick={async () => {
            await add(Number(amount), reason);
            setAmount(''); setReason(''); setCustom(false);
          }}>Go</Btn>
        </div>
      ) : (
        <button onClick={() => setCustom(true)} className="w-full min-h-[32px] text-xs text-fog hover:text-bone">custom amount…</button>
      )}
    </div>
  );
}

// ---------- active minigame panel ----------
function MinigamePanel({ session, minigame, timer, mole, teams, toast }) {
  const call = (path, body) => api(path, 'POST', body).catch((e) => toast(e.message));
  const mode = session.active_minigame_mode;
  const canToggle = minigame.enabled_modes.length > 1;
  const moleCapable = mode === 'gameshow' && !!minigame.gameshow?.has_mole;
  return (
    <div className="rounded-xl border border-line bg-panel p-4 flex flex-col h-full gap-3 overflow-y-auto no-scrollbar">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold leading-tight">{minigame.name}</div>
          {canToggle && (
            <div className="mt-1 inline-flex rounded-lg border border-line overflow-hidden text-xs">
              {['gameshow', 'escaperoom'].filter((m) => minigame.enabled_modes.includes(m)).map((m) => (
                <button key={m} onClick={() => call('/minigames/active/mode', { mode: m })}
                  className={`px-3 py-1.5 ${mode === m ? 'bg-bone text-ink font-semibold' : 'text-fog'}`}>
                  {m === 'gameshow' ? 'Game show' : 'Escape room'}
                </button>
              ))}
            </div>
          )}
        </div>
        {minigame.image && <img src={minigame.image} alt="" className="w-16 h-16 object-cover rounded-lg border border-line" />}
      </div>
      <div className={`num text-6xl font-bold text-center my-3 ${timer.expired ? 'timer-expired' : ''}`}>
        {fmtTime(timer.remaining_ms)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {timer.running
          ? <Btn onClick={() => call('/timer', { action: 'pause' })}>Pause</Btn>
          : <Btn kind="primary" onClick={() => call('/timer', { action: 'start' })}>{timer.remaining_ms < timer.duration_ms && timer.remaining_ms > 0 ? 'Resume' : 'Start'}</Btn>}
        <Btn onClick={() => call('/timer', { action: 'reset' })}>Reset</Btn>
        <Btn kind="danger" onClick={() => call('/minigames/end')}>End Game</Btn>
        <Btn onClick={() => call('/timer', { action: 'add', seconds: 30 })}>+30s</Btn>
        <Btn onClick={() => call('/timer', { action: 'subtract', seconds: 30 })}>−30s</Btn>
      </div>
      {moleCapable && <MolePanel mole={mole} teams={teams} hasMole toast={toast} />}
    </div>
  );
}

// ---------- main Live screen ----------
export default function Live() {
  const { state, timer, quiz, grid } = useHub();
  const [toast, toastNode] = useToast();
  const [drawer, setDrawer] = useState(false);
  if (!state) return null;
  const { session, teams, minigames, quiz_attempts } = state;
  if (!session) return <><ModeSelector toast={toast} />{toastNode}</>;

  const active = session.active_minigame_id ? minigames.find((m) => m.id === session.active_minigame_id) : null;
  const launchable = minigames.filter((m) => m.enabled_modes.includes(session.mode));
  const call = (path, body) => api(path, 'POST', body).catch((e) => toast(e.message));
  const attemptsLeft = (m) => {
    if (m.ui_component !== 'quiz' || session.mode !== 'escaperoom') return null;
    const qa = quiz_attempts?.[m.id];
    return qa ? qa.max - qa.used : null;
  };

  return (
    <div className="h-full flex flex-col">
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-line shrink-0">
        <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-panel border border-line">
          {session.mode === 'gameshow' ? 'Game Show' : 'Escape Room'}
        </span>
        {session.mode === 'gameshow' && (
          <span className="flex items-center gap-1 text-sm text-fog">
            Round
            <button className="px-2 py-1 hover:text-bone" onClick={() => call('/sessions/round', { round: session.current_round - 1 })}>−</button>
            <b className="text-bone num">{session.current_round}</b>
            <button className="px-2 py-1 hover:text-bone" onClick={() => call('/sessions/round', { round: session.current_round + 1 })}>+</button>
          </span>
        )}
        <span className="flex-1" />
        {session.status === 'paused'
          ? <Btn className="!min-h-[38px]" kind="primary" onClick={() => call('/sessions/status', { status: 'active' })}>Resume session</Btn>
          : <Btn className="!min-h-[38px]" onClick={() => call('/sessions/status', { status: 'paused' })}>Pause session</Btn>}
        <Btn className="!min-h-[38px]" kind="danger" onClick={() => { if (confirm('End this session? Final scores will be recorded.')) call('/sessions/end'); }}>End session</Btn>
      </div>

      {/* body */}
      <div className="flex-1 min-h-0 flex gap-3 p-3">
        <div className={`grid gap-2 content-start overflow-y-auto no-scrollbar ${teams.length > 1 ? 'w-[380px] grid-cols-1' : 'w-[380px]'}`}>
          {teams.map((t) => <TeamCard key={t.id} team={t} toast={toast} />)}
        </div>
        <div className="flex-1 min-w-0">
          {active && quiz.active
            ? <QuizPanel quiz={quiz} teams={teams} timer={timer} toast={toast} />
            : active && grid.active
              ? <GridPanel grid={grid} state={state} timer={timer} toast={toast} />
            : active
              ? <MinigamePanel session={session} minigame={active} timer={timer} mole={state.mole} teams={teams} toast={toast} />
              : (
                <div className="h-full rounded-xl border border-dashed border-line flex flex-col items-center justify-center text-fog gap-1">
                  <div className="text-lg">No minigame running</div>
                  <div className="text-sm">Tap a tile below to launch one.</div>
                </div>
              )}
        </div>
      </div>

      {/* minigame strip */}
      <div className="shrink-0 border-t border-line px-3 py-2">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {launchable.map((m) => {
            const left = attemptsLeft(m);
            const exhausted = left !== null && left <= 0;
            return (
              <button key={m.id}
                disabled={exhausted}
                onClick={() => call(`/minigames/${m.id}/start`, {})}
                className={`shrink-0 w-40 rounded-lg border p-2 text-left transition-colors disabled:opacity-40 ${active?.id === m.id ? 'border-bone bg-panel' : 'border-line bg-panel hover:border-fog'}`}>
                <div className="h-16 rounded bg-ink border border-line mb-1 overflow-hidden flex items-center justify-center text-fog text-xs">
                  {m.image ? <img src={m.image} alt="" className="w-full h-full object-cover" /> : 'no image'}
                </div>
                <div className="text-xs font-semibold truncate">{m.name}</div>
                <div className="text-[10px] text-fog">
                  {session.mode === 'gameshow' && m.round_number != null && <>Round {m.round_number}</>}
                  {left !== null && (exhausted ? 'No attempts remaining' : `${left} attempt(s) left`)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ledger drawer */}
      <div className="shrink-0 border-t border-line">
        <button onClick={() => setDrawer(!drawer)} className="w-full px-4 py-2 text-left text-xs uppercase tracking-wider text-fog hover:text-bone">
          {drawer ? '▾ Hide ledger' : '▸ Live ledger'}
        </button>
        {drawer && <div className="max-h-48 overflow-y-auto border-t border-line"><LedgerFeed compact /></div>}
      </div>
      {toastNode}
    </div>
  );
}
