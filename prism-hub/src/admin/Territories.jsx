import React, { useState } from 'react';
import { useHub, api, Btn, teamHex, inputCls, useToast } from '../hub.jsx';

const OWNERS = ['none', 'red', 'blue', 'green', 'yellow'];

function TerritoryRow({ t, toast }) {
  const [name, setName] = useState(t.name);
  const [nrId, setNrId] = useState(t.nodered_id);
  const put = (body) => api(`/territories/${t.id}`, 'PUT', body).catch((e) => toast(e.message));
  return (
    <div className="rounded-xl border border-line bg-panel p-4 space-y-3">
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== t.name && put({ name })} />
        <Btn kind={t.locked ? 'primary' : 'default'} onClick={() => put({ locked: !t.locked })} title="Locked territories are immune to steals">
          {t.locked ? '🔒 Locked' : 'Unlocked'}
        </Btn>
        <Btn kind="danger" onClick={() => confirm(`Delete "${t.name}"?`) && api(`/territories/${t.id}`, 'DELETE').catch((e) => toast(e.message))}>Delete</Btn>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-fog w-14">Owner</span>
        {OWNERS.map((o) => (
          <button key={o} onClick={() => put({ owner: o })}
            title={o}
            className={`w-11 h-11 rounded-lg border-2 transition-colors ${t.owner === o ? 'border-bone' : 'border-line hover:border-fog'}`}
            style={{ background: o === 'none' ? 'transparent' : teamHex(o) }}>
            {o === 'none' && <span className="text-fog text-xs">—</span>}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wider text-fog w-14">Node-RED id</span>
        <input className={`${inputCls} !min-h-[38px] flex-1 font-mono text-xs`} value={nrId}
          onChange={(e) => setNrId(e.target.value)} onBlur={() => nrId !== t.nodered_id && put({ nodered_id: nrId })} />
      </label>
    </div>
  );
}

export default function Territories() {
  const { state } = useHub();
  const [toast, toastNode] = useToast();
  const [newName, setNewName] = useState('');
  if (!state) return null;

  return (
    <div className="h-full overflow-y-auto p-5 max-w-3xl space-y-4">
      <div className="text-fog text-sm">
        Ownership changes fire a Node-RED webhook with the territory's <code>nodered_id</code> — the lights follow from there.
        Locked territories can't be stolen by power-ups, but you can always reassign them here.
      </div>
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1`} placeholder="New territory name…" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Btn kind="primary" onClick={async () => {
          try { await api('/territories', 'POST', { name: newName }); setNewName(''); } catch (e) { toast(e.message); }
        }}>Add territory</Btn>
      </div>
      {state.territories.map((t) => <TerritoryRow key={t.id} t={t} toast={toast} />)}
      {toastNode}
    </div>
  );
}
