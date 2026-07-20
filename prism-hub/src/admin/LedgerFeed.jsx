import React, { useEffect, useState } from 'react';
import { useHub, api, ColorDot, Btn } from '../hub.jsx';

// Live reverse-chronological feed of every ledger entry. Voided rows stay
// visible (struck through) with Redo — nothing is ever deleted.
export default function LedgerFeed({ compact = false }) {
  const { state } = useHub();
  const [entries, setEntries] = useState([]);
  const [err, setErr] = useState(null);

  const refresh = () => api('/ledger').then((d) => setEntries(d.entries)).catch((e) => setErr(e.message));
  // Every chroma change broadcasts state, so state is our refresh signal.
  useEffect(() => { refresh(); }, [state]);

  const act = async (id, verb) => {
    try { await api(`/ledger/${id}/${verb}`, 'POST'); } catch (e) { setErr(e.message); }
  };

  if (err) return <div className="text-tred text-sm p-3">{err}</div>;
  if (!entries.length) return <div className="text-fog text-sm p-3">No Chroma entries yet.</div>;

  return (
    <ul className="divide-y divide-line">
      {entries.map((e) => (
        <li key={e.id} className={`flex items-center gap-3 px-3 py-2 ${e.voided ? 'opacity-60' : ''}`}>
          <ColorDot color={e.team_color} />
          <span className={`num font-semibold w-16 text-right ${e.amount >= 0 ? 'text-tgreen' : 'text-tred'} ${e.voided ? 'line-through' : ''}`}>
            {e.amount > 0 ? '+' : ''}{e.amount}
          </span>
          <span className={`flex-1 min-w-0 truncate text-sm ${e.voided ? 'line-through text-fog' : ''}`}>
            {e.reason || '—'}
          </span>
          {!compact && <span className="text-[10px] uppercase tracking-wider text-fog w-20">{e.source}</span>}
          {!compact && <span className="text-xs text-fog num hidden lg:block">{e.created_at.slice(11, 19)}</span>}
          {e.voided
            ? <Btn kind="ghost" className="!min-h-[36px] !px-3 text-xs" onClick={() => act(e.id, 'unvoid')}>Redo</Btn>
            : <Btn kind="ghost" className="!min-h-[36px] !px-3 text-xs text-tred" onClick={() => act(e.id, 'void')}>Undo</Btn>}
        </li>
      ))}
    </ul>
  );
}
