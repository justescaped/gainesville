import React from 'react';

// Phase 3 will turn this into the per-team player surface (Color Grid input,
// personal score, hints). For now it's a deliberate placeholder so the route
// and the deployment target both exist.
export default function Player() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8">
      <div className="text-5xl font-black tracking-tight">PRISM DILEMMA</div>
      <div className="text-fog uppercase tracking-[0.3em]">Player surface</div>
      <div className="text-bone/60 max-w-sm mt-2">
        The interactive player experience — Color Grid, live score, and hints — arrives in Phase 3.
      </div>
    </div>
  );
}
