import React, { useEffect, useState } from 'react';
import { useHub, api, Btn, Field, inputCls, useToast } from '../hub.jsx';

// Mole Objectives — the library of one-sentence secret goals. The Hub never
// shows these on Stage; on assignment they go out over the mole.assigned
// webhook to whatever delivery device Node-RED points at.

function ObjectiveEditor({ objective, minigames, onDone, toast }) {
  const [o, setO] = useState({
    text: objective?.text || '',
    minigame_ids: objective?.minigame_ids || [],
    reward: objective?.reward ?? '',
    weight: objective?.weight ?? 1,
    active: objective ? !!objective.active : true
  });
  const set = (patch) => setO((cur) => ({ ...cur, ...patch }));
  const toggleGame = (id) => set({
    minigame_ids: o.minigame_ids.includes(id) ? o.minigame_ids.filter((x) => x !== id) : [...o.minigame_ids, id]
  });

  const save = async () => {
    try {
      const body = { ...o, reward: o.reward === '' ? null : Number(o.reward) };
      if (objective) await api(`/mole/objectives/${objective.id}`, 'PUT', body);
      else await api('/mole/objectives', 'POST', body);
      onDone();
    } catch (e) { toast(e.message); }
  };

  return (
    <div className="rounded-xl border border-bone/40 bg-panel p-4 space-y-3">
      <Field label="Objective — one sentence, host-verifiable">
        <textarea className={`${inputCls} py-2 min-h-[70px]`} value={o.text} autoFocus
          placeholder="Get blue into at least 2 corners."
          onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <Field label="Applies to (none selected = any minigame)">
        <div className="flex flex-wrap gap-2">
          {minigames.map((m) => (
            <Btn key={m.id} className="!min-h-[38px] !px-3 text-xs"
              kind={o.minigame_ids.includes(m.id) ? 'primary' : 'default'}
              onClick={() => toggleGame(m.id)}>
              {m.name}
            </Btn>
          ))}
        </div>
      </Field>
      <div className="flex gap-4 items-end">
        <Field label="Reward (blank = minigame default)">
          <input className={`${inputCls} w-32 text-center num`} inputMode="numeric" value={o.reward}
            onChange={(e) => set({ reward: e.target.value })} />
        </Field>
        <Field label="Weight (draw odds)">
          <input className={`${inputCls} w-24 text-center num`} inputMode="numeric" value={o.weight}
            onChange={(e) => set({ weight: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
        <label className="flex items-center gap-2 text-sm pb-3">
          <input type="checkbox" className="w-5 h-5" checked={o.active} onChange={(e) => set({ active: e.target.checked })} />
          Active
        </label>
      </div>
      <div className="flex gap-2">
        <Btn kind="primary" className="flex-1" onClick={save}>{objective ? 'Save' : 'Add objective'}</Btn>
        <Btn onClick={onDone}>Cancel</Btn>
      </div>
    </div>
  );
}

export default function MoleObjectives() {
  const { state } = useHub();
  const [toast, toastNode] = useToast();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);   // null | 'new' | objective
  const [filter, setFilter] = useState('');

  const refresh = () => api('/mole/objectives').then(setData).catch((e) => toast(e.message));
  useEffect(() => { refresh(); }, []);
  if (!data || !state) return null;

  const minigames = state.minigames;
  const gameName = (id) => minigames.find((m) => m.id === id)?.name || id;
  const shown = data.objectives.filter((o) =>
    !filter || o.minigame_ids.length === 0 || o.minigame_ids.includes(filter));

  const act = (fn) => fn.then(refresh).catch((e) => toast(e.message));

  return (
    <div className="h-full overflow-y-auto p-5 max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-bold text-lg">Mole Objectives</h2>
        <span className="flex-1" />
        <select className={`${inputCls} !w-auto !min-h-[40px]`} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All minigames</option>
          {minigames.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <Btn kind="primary" onClick={() => setEditing('new')}>+ New objective</Btn>
      </div>
      <div className="text-xs text-fog">
        Objectives are delivered to the mole via the <b>mole.assigned</b> webhook (Settings → Mole delivery URL) —
        never shown on Stage. Write them one sentence long and judgeable by the host.
      </div>

      {data.warnings.map((w, i) => (
        <div key={i} className="rounded-lg border border-tyellow/50 bg-tyellow/10 text-tyellow text-sm px-3 py-2">⚠ {w}</div>
      ))}

      {editing === 'new' && <ObjectiveEditor minigames={minigames} toast={toast} onDone={() => { setEditing(null); refresh(); }} />}

      <ul className="space-y-2">
        {shown.map((o) => (
          <li key={o.id}>
            {editing?.id === o.id
              ? <ObjectiveEditor objective={o} minigames={minigames} toast={toast} onDone={() => { setEditing(null); refresh(); }} />
              : (
                <div className={`rounded-xl border border-line bg-panel p-3 flex items-center gap-3 ${o.active ? '' : 'opacity-50'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{o.text}</div>
                    <div className="text-xs text-fog mt-0.5">
                      {o.minigame_ids.length ? o.minigame_ids.map(gameName).join(', ') : 'Any minigame'}
                      {' · '}reward {o.reward == null ? 'default' : <span className="num">{o.reward}</span>}
                      {o.weight > 1 && <> · weight <span className="num">{o.weight}</span></>}
                      {!o.active && ' · inactive'}
                    </div>
                  </div>
                  <Btn className="!min-h-[38px] !px-3 text-xs" onClick={() => setEditing(o)}>Edit</Btn>
                  <Btn className="!min-h-[38px] !px-3 text-xs" onClick={() => act(api(`/mole/objectives/${o.id}/duplicate`, 'POST'))}>Duplicate</Btn>
                  <Btn className="!min-h-[38px] !px-3 text-xs" kind={o.active ? 'default' : 'primary'}
                    onClick={() => act(api(`/mole/objectives/${o.id}`, 'PUT', { active: !o.active }))}>
                    {o.active ? 'Disable' : 'Enable'}
                  </Btn>
                  <Btn className="!min-h-[38px] !px-3 text-xs" kind="danger"
                    onClick={() => { if (confirm('Delete this objective?')) act(api(`/mole/objectives/${o.id}`, 'DELETE')); }}>✕</Btn>
                </div>
              )}
          </li>
        ))}
      </ul>
      {toastNode}
    </div>
  );
}
