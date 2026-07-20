import React from 'react';
import LedgerFeed from './LedgerFeed.jsx';
import { useHub } from '../hub.jsx';

export default function Ledger() {
  const { state } = useHub();
  return (
    <div className="h-full overflow-y-auto p-5 max-w-4xl">
      <div className="text-fog text-sm mb-3">
        Every Chroma change in this session, newest first. Undo voids an entry (totals recompute everywhere instantly);
        nothing is ever deleted. Undoing one half of a trade voids both halves.
      </div>
      {state?.session
        ? <div className="rounded-xl border border-line bg-panel overflow-hidden"><LedgerFeed /></div>
        : <div className="text-fog">No active session.</div>}
    </div>
  );
}
