import React, { useEffect } from 'react';
import { useHub, socket, teamHex, fmtTime } from '../hub.jsx';
import QuizStage from './QuizStage.jsx';

// The Stage is the only screen the audience sees. Design rule: the world is
// greyscale; the ONLY saturated colour in the room comes from team identity.
// Everything here is sized to read from ~20 feet. No controls, no cursor.

function Banner({ banner }) {
  if (!banner) return null;
  return (
    <div className="banner-in fixed top-0 inset-x-0 z-30 bg-bone text-ink text-center py-6 px-8 text-4xl font-bold tracking-tight shadow-2xl">
      {banner.text}
    </div>
  );
}

function PowerupIcons({ powerups }) {
  const held = powerups.filter((p) => !p.used);
  if (!held.length) return null;
  return (
    <div className="flex gap-2 justify-center mt-3">
      {held.map((p) => (
        <div key={p.id} title={p.name} className="w-10 h-10 rounded-lg bg-white/5 border border-white/15 overflow-hidden flex items-center justify-center text-lg">
          {p.icon ? <img src={p.icon} alt="" className="w-full h-full object-cover" /> : '★'}
        </div>
      ))}
    </div>
  );
}

// ---- game show, between minigames: the four-team board ----
function TeamBoard({ teams }) {
  const leader = Math.max(...teams.map((t) => t.chroma), 0);
  return (
    <div className="grid grid-cols-2 gap-6 w-full h-full p-8">
      {teams.map((t) => {
        const leading = t.chroma === leader && leader > 0;
        return (
          <div key={t.id}
            className="rounded-3xl border-2 flex flex-col items-center justify-center relative overflow-hidden"
            style={{ borderColor: teamHex(t.color), background: `${teamHex(t.color)}0D` }}>
            {leading && <div className="absolute top-4 right-5 text-xs uppercase tracking-[0.3em]" style={{ color: teamHex(t.color) }}>Leader</div>}
            <div className="text-3xl font-semibold text-bone/80">{t.name}</div>
            <div className="num text-8xl font-black my-1" style={{ color: teamHex(t.color) }}>{t.chroma}</div>
            <div className="text-bone/50 uppercase tracking-widest text-sm">
              {t.territory_count} territor{t.territory_count === 1 ? 'y' : 'ies'}
            </div>
            <PowerupIcons powerups={t.powerups} />
          </div>
        );
      })}
    </div>
  );
}

// ---- any mode, minigame running: full-screen focus ----
function ActiveMinigame({ minigame, timer, teams }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {minigame.image && <img src={minigame.image} alt="" className="max-h-[28vh] rounded-2xl border border-white/10 object-contain" />}
        <div className="text-6xl font-black tracking-tight text-center px-8">{minigame.name}</div>
        <div className={`num text-[14rem] leading-none font-black ${timer.expired ? 'timer-expired' : 'text-bone'}`}>
          {fmtTime(timer.remaining_ms)}
        </div>
      </div>
      {teams.length > 1 && (
        <div className="shrink-0 flex justify-center gap-10 pb-8">
          {teams.map((t) => (
            <div key={t.id} className="flex items-center gap-3">
              <span className="w-4 h-4 rounded-full" style={{ background: teamHex(t.color) }} />
              <span className="text-bone/70 text-2xl">{t.name}</span>
              <span className="num text-3xl font-bold" style={{ color: teamHex(t.color) }}>{t.chroma}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- escape room, between minigames: solo team vs the record ----
function SoloBoard({ team, bests }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4">
      <div className="text-4xl font-semibold text-bone/80">{team.name}</div>
      <div className="num text-[12rem] leading-none font-black" style={{ color: teamHex('solo') }}>{team.chroma}</div>
      <div className="text-bone/50 uppercase tracking-[0.3em] text-lg">Chroma</div>
      <PowerupIcons powerups={team.powerups} />
      <div className="flex gap-16 mt-8">
        <div className="text-center">
          <div className="text-bone/40 uppercase tracking-widest text-sm">This month</div>
          <div className="num text-5xl font-bold text-bone/90">{bests.monthly ?? '—'}</div>
        </div>
        <div className="text-center">
          <div className="text-bone/40 uppercase tracking-widest text-sm">All-time best</div>
          <div className="num text-5xl font-bold text-bone/90">{bests.alltime ?? '—'}</div>
        </div>
      </div>
    </div>
  );
}

export default function Stage() {
  const { state, timer, quiz, banner } = useHub();

  // Physical button box: it's a USB HID keyboard plugged into the machine
  // showing this page. Forward every non-repeat keydown's raw event.code to the
  // Hub — mapping, debounce, and meaning are decided server-side, never here.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return; // a held button must not machine-gun
      socket.emit('raw_button', { code: e.code });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!state) return <div className="h-full flex items-center justify-center text-fog">Connecting…</div>;
  const { session, teams, minigames, bests } = state;

  return (
    <div className="h-full bg-ink text-bone overflow-hidden cursor-none select-none relative">
      <Banner banner={banner} />

      {!session && (
        <div className="h-full flex flex-col items-center justify-center gap-4">
          <div className="text-7xl font-black tracking-tight">PRISM DILEMMA</div>
          <div className="text-fog uppercase tracking-[0.4em]">Standby</div>
        </div>
      )}

      {session && (() => {
        const active = session.active_minigame_id ? minigames.find((m) => m.id === session.active_minigame_id) : null;
        // Quiz minigames take over with their own state machine views.
        if (active && quiz.active) return <QuizStage quiz={quiz} teams={teams} />;
        if (active) return <ActiveMinigame minigame={active} timer={timer} teams={teams} />;

        if (session.mode === 'escaperoom') {
          return <SoloBoard team={teams[0]} bests={bests} />;
        }
        // game show, between games: board + round/next-up footer
        const next = [...minigames]
          .filter((m) => m.enabled_modes.includes('gameshow') && (m.round_number ?? 0) >= session.current_round)
          .sort((a, b) => (a.round_number ?? 999) - (b.round_number ?? 999))[0];
        return (
          <div className="h-full flex flex-col">
            <div className="text-center pt-6 pb-2 shrink-0">
              <span className="text-fog uppercase tracking-[0.3em] text-xl">Round {session.current_round}</span>
              {next && <span className="text-bone/60 text-xl ml-6">Next up: {next.name}</span>}
            </div>
            <div className="flex-1 min-h-0"><TeamBoard teams={teams} /></div>
          </div>
        );
      })()}
    </div>
  );
}
