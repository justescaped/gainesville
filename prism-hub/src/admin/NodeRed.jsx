import React, { useEffect, useState } from 'react';
import { api, Btn, useToast } from '../hub.jsx';

const TEST_EVENTS = [
  'session_started', 'session_ended', 'minigame_start', 'minigame_end', 'timer_expired',
  'territory_changed', 'powerup_used', 'chroma_changed',
  'mole.assigned', 'mole.resolved', 'grid.started', 'grid.scored', 'run.completed', 'run.record_set'
];

function LogTable({ rows, showStatus }) {
  const [open, setOpen] = useState(null);
  if (!rows.length) return <div className="text-fog text-sm p-3">Nothing yet.</div>;
  return (
    <ul className="divide-y divide-line text-sm">
      {rows.map((r) => {
        const bad = r.status && !/^(2\d\d|accepted)/.test(r.status);
        return (
          <li key={r.id} className="px-3 py-2">
            <button className="w-full flex items-center gap-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="text-xs text-fog num shrink-0">{r.created_at.slice(11, 19)}</span>
              <span className="font-mono text-xs flex-1 truncate">{r.event}</span>
              {showStatus && <span className={`text-xs shrink-0 ${bad ? 'text-tred' : 'text-tgreen'}`}>{r.status ?? '—'}</span>}
            </button>
            {open === r.id && (
              <pre className="mt-2 text-[11px] bg-ink border border-line rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {r.url ? `→ ${r.url}\n` : ''}{JSON.stringify(JSON.parse(r.payload || 'null'), null, 2)}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function NodeRed() {
  const [toast, toastNode] = useToast();
  const [log, setLog] = useState({ inbound: [], outbound: [] });
  const refresh = () => api('/nodered/log').then(setLog).catch((e) => toast(e.message));
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, []);

  const lastOut = log.outbound[0];
  const healthy = lastOut && /^2\d\d/.test(lastOut.status || '');

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      <div className="rounded-xl border border-line bg-panel p-4 flex items-center gap-3">
        <span className={`w-3 h-3 rounded-full ${!lastOut ? 'bg-fog' : healthy ? 'bg-tgreen' : 'bg-tred'}`} />
        <div className="text-sm">
          {!lastOut
            ? 'No outbound calls yet — set a base URL in Settings, then fire a test below.'
            : healthy
              ? `Last outbound call succeeded (${lastOut.status}).`
              : `Last outbound call failed: ${lastOut.status}. Check the base URL in Settings and that Node-RED is reachable.`}
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-fog mb-2">Fire a test event</div>
        <div className="flex flex-wrap gap-2">
          {TEST_EVENTS.map((ev) => (
            <Btn key={ev} className="!min-h-[40px] text-xs font-mono"
              onClick={() => api('/nodered/test', 'POST', { event: ev }).then(refresh).catch((e) => toast(e.message))}>
              {ev}
            </Btn>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-line bg-panel overflow-hidden">
          <div className="px-3 py-2 border-b border-line text-xs uppercase tracking-wider text-fog">Inbound — last 50 (Node-RED → Hub)</div>
          <div className="max-h-[50vh] overflow-y-auto"><LogTable rows={log.inbound} showStatus /></div>
        </div>
        <div className="rounded-xl border border-line bg-panel overflow-hidden">
          <div className="px-3 py-2 border-b border-line text-xs uppercase tracking-wider text-fog">Outbound — last 50 (Hub → Node-RED)</div>
          <div className="max-h-[50vh] overflow-y-auto"><LogTable rows={log.outbound} showStatus /></div>
        </div>
      </div>
      {toastNode}
    </div>
  );
}
