import React, { useState } from 'react';
import { useHub, api, Btn, Field, inputCls, ColorDot, useToast } from '../hub.jsx';

// Modal flow for using a power-up that needs a target (territory or team).
function UseModal({ instance, team, state, onClose, toast }) {
  const needsTerritory = instance.effect_type === 'steal_territory';
  const needsTeam = instance.effect_type === 'announcement_only' && instance.config?.needs_target_team;
  const [territoryId, setTerritoryId] = useState(null);
  const [targetTeamId, setTargetTeamId] = useState(null);

  const fire = async () => {
    try {
      await api(`/powerups/instances/${instance.id}/use`, 'POST', { territory_id: territoryId, target_team_id: targetTeamId });
      onClose();
    } catch (e) { toast(e.message); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-ink/80 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-panel border border-line rounded-2xl p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg">{team.name} · {instance.name}</div>
        {needsTerritory && (
          <div className="space-y-2">
            <div className="text-sm text-fog">Pick a territory to steal (locked ones are immune):</div>
            {state.territories.map((t) => (
              <button key={t.id} disabled={!!t.locked || t.owner === team.color}
                onClick={() => setTerritoryId(t.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border disabled:opacity-40 ${territoryId === t.id ? 'border-bone bg-ink' : 'border-line hover:border-fog'}`}>
                <ColorDot color={t.owner} />
                <span className="flex-1 text-left">{t.name}</span>
                {t.locked ? <span className="text-xs text-fog">locked</span> : null}
              </button>
            ))}
          </div>
        )}
        {needsTeam && (
          <div className="space-y-2">
            <div className="text-sm text-fog">Pick the target team:</div>
            {state.teams.filter((t) => t.id !== team.id).map((t) => (
              <button key={t.id} onClick={() => setTargetTeamId(t.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border ${targetTeamId === t.id ? 'border-bone bg-ink' : 'border-line hover:border-fog'}`}>
                <ColorDot color={t.color} /><span>{t.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={(needsTerritory && !territoryId) || (needsTeam && !targetTeamId)} onClick={fire}>Use power-up</Btn>
        </div>
      </div>
    </div>
  );
}

function DefEditor({ def, toast, onDone }) {
  const blank = { id: '', name: '', description: '', icon: null, modes: ['gameshow'], effect_type: 'announcement_only', config: {} };
  const [d, setD] = useState(def || blank);
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));
  const uploadIcon = async (file) => {
    const fd = new FormData(); fd.append('image', file);
    try { const { path } = await api('/upload', 'POST', fd); set({ icon: path }); } catch (e) { toast(e.message); }
  };
  const save = async () => {
    try {
      const id = d.id || d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      await api('/powerups/defs', 'POST', { ...d, id });
      onDone();
    } catch (e) { toast(e.message); }
  };
  return (
    <div className="rounded-xl border border-line p-4 space-y-3 bg-panel">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><input className={inputCls} value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Effect">
          <select className={inputCls} value={d.effect_type} onChange={(e) => set({ effect_type: e.target.value })}>
            <option value="announcement_only">announcement_only</option>
            <option value="chroma_bonus">chroma_bonus</option>
            <option value="steal_territory">steal_territory</option>
          </select>
        </Field>
      </div>
      <Field label="Description"><input className={inputCls} value={d.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div className="flex items-center gap-3">
        <Field label="Icon">
          <div className="flex items-center gap-2">
            <div className="w-12 h-12 rounded-lg border border-line bg-ink overflow-hidden flex items-center justify-center text-[10px] text-fog">
              {d.icon ? <img src={d.icon} alt="" className="w-full h-full object-cover" /> : '—'}
            </div>
            <label className="min-h-[44px] px-3 rounded-lg border border-line flex items-center cursor-pointer hover:border-fog text-sm">
              Upload<input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" className="hidden" onChange={(e) => e.target.files[0] && uploadIcon(e.target.files[0])} />
            </label>
          </div>
        </Field>
        <Field label="Modes">
          <div className="flex gap-2">
            {['gameshow', 'escaperoom'].map((m) => (
              <Btn key={m} className="!min-h-[38px]" kind={d.modes.includes(m) ? 'primary' : 'default'}
                onClick={() => set({ modes: d.modes.includes(m) ? d.modes.filter((x) => x !== m) : [...d.modes, m] })}>
                {m}
              </Btn>
            ))}
          </div>
        </Field>
      </div>
      {d.effect_type === 'chroma_bonus' && (
        <Field label="Bonus amount">
          <input className={`${inputCls} w-32 num`} inputMode="numeric" value={d.config.amount ?? 0}
            onChange={(e) => set({ config: { ...d.config, amount: Number(e.target.value) || 0 } })} />
        </Field>
      )}
      {d.effect_type === 'announcement_only' && (
        <>
          <Field label="Banner template — {team} = user, {target} = chosen team">
            <input className={inputCls} value={d.config.template ?? '{team} used a power-up'}
              onChange={(e) => set({ config: { ...d.config, template: e.target.value } })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-5 h-5" checked={!!d.config.needs_target_team}
              onChange={(e) => set({ config: { ...d.config, needs_target_team: e.target.checked } })} />
            Requires picking a target team
          </label>
        </>
      )}
      <div className="flex gap-2 justify-end">
        <Btn onClick={onDone}>Cancel</Btn>
        <Btn kind="primary" onClick={save}>Save power-up</Btn>
      </div>
    </div>
  );
}

export default function Powerups() {
  const { state } = useHub();
  const [toast, toastNode] = useToast();
  const [editing, setEditing] = useState(null); // null | 'new' | def object
  const [modal, setModal] = useState(null);     // { instance, team }
  if (!state) return null;
  const { powerup_defs, teams, session } = state;

  return (
    <div className="h-full overflow-y-auto p-5 space-y-6 max-w-4xl">
      {/* catalog */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold">Catalog</h2>
          <Btn onClick={() => setEditing('new')}>+ New power-up</Btn>
        </div>
        {editing && <div className="mb-3"><DefEditor def={editing === 'new' ? null : editing} toast={toast} onDone={() => setEditing(null)} /></div>}
        <div className="grid grid-cols-2 gap-2">
          {powerup_defs.map((d) => (
            <div key={d.id} className="rounded-xl border border-line bg-panel p-3 flex gap-3">
              <div className="w-12 h-12 rounded-lg border border-line bg-ink overflow-hidden flex items-center justify-center text-[10px] text-fog shrink-0">
                {d.icon ? <img src={d.icon} alt="" className="w-full h-full object-cover" /> : '★'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{d.name}</div>
                <div className="text-xs text-fog truncate">{d.description}</div>
                <div className="text-[10px] text-fog mt-1">{d.effect_type} · {d.modes.join(', ')}</div>
              </div>
              <div className="flex flex-col gap-1">
                <Btn kind="ghost" className="!min-h-[36px] !px-2 text-xs" onClick={() => setEditing(d)}>Edit</Btn>
                <Btn kind="ghost" className="!min-h-[36px] !px-2 text-xs text-tred"
                  onClick={() => confirm(`Delete "${d.name}" and every granted copy?`) && api(`/powerups/defs/${d.id}`, 'DELETE').catch((e) => toast(e.message))}>Delete</Btn>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* team inventories */}
      {session ? (
        <div className="space-y-3">
          <h2 className="font-bold">Team inventories</h2>
          {teams.map((team) => (
            <div key={team.id} className="rounded-xl border border-line bg-panel p-3">
              <div className="flex items-center gap-2 mb-2">
                <ColorDot color={team.color} /><span className="font-semibold">{team.name}</span>
                <span className="flex-1" />
                <select className={`${inputCls} !min-h-[38px] !w-auto text-sm`} defaultValue=""
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    try { await api('/powerups/grant', 'POST', { team_id: team.id, def_id: e.target.value }); } catch (err) { toast(err.message); }
                    e.target.value = '';
                  }}>
                  <option value="">Grant…</option>
                  {powerup_defs.filter((d) => d.modes.includes(session.mode)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              {team.powerups.length === 0
                ? <div className="text-fog text-sm">No power-ups held.</div>
                : (
                  <div className="flex flex-wrap gap-2">
                    {team.powerups.map((p) => (
                      <div key={p.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${p.used ? 'border-line opacity-50' : 'border-fog'}`}>
                        <span className="text-sm">{p.name}</span>
                        {p.used
                          ? <span className="text-[10px] uppercase text-fog">used</span>
                          : <>
                              <Btn kind="primary" className="!min-h-[34px] !px-3 text-xs" onClick={() => {
                                // No-target power-ups fire immediately; only steal/target ones open the modal.
                                const needsPick = p.effect_type === 'steal_territory' || (p.effect_type === 'announcement_only' && p.config?.needs_target_team);
                                if (needsPick) setModal({ instance: p, team });
                                else api(`/powerups/instances/${p.id}/use`, 'POST', {}).catch((e) => toast(e.message));
                              }}>Use</Btn>
                              <Btn kind="ghost" className="!min-h-[34px] !px-2 text-xs text-tred"
                                onClick={() => api(`/powerups/instances/${p.id}`, 'DELETE').catch((e) => toast(e.message))}>✕</Btn>
                            </>}
                      </div>
                    ))}
                  </div>
                )}
            </div>
          ))}
        </div>
      ) : <div className="text-fog text-sm">Start a session to grant power-ups.</div>}

      {modal && <UseModal instance={modal.instance} team={modal.team} state={state} toast={toast} onClose={() => setModal(null)} />}
      {toastNode}
    </div>
  );
}
