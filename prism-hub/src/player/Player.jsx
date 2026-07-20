import React from 'react';

// Deliberately a stub. The Phase 3 revision removed the player surface from
// scope: mole objectives are delivered through Node-RED to whatever device the
// room uses (bench screen, receipt printer, TTS), so team tablets are not
// needed. The route stays reserved in case that ever changes.
export default function Player() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8">
      <div className="text-5xl font-black tracking-tight">PRISM DILEMMA</div>
      <div className="text-fog uppercase tracking-[0.3em]">Not in use</div>
    </div>
  );
}
