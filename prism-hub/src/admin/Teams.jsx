import React, { useState } from 'react';
import { useHub, api, Btn, ColorDot, inputCls, useToast } from '../hub.jsx';

function TeamRow({ team, toast }) {
  const [name, setName] = useState(team.name);
  const save = () => name.trim() && name !== team.name &&
    api(`/teams/${team.id}`, 'PUT', { name: name.trim() }).catch((e) => toast(e.message));
  return (
    <div className="rounded-xl border border-line bg-panel p-4 flex items-center gap-3">
      <ColorDot color={team.color} size={20} />
      <input className={`${inputCls} flex-1`} value={name}
        onChange={(e) => setName(e.target.value)} onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
      <div className="num text-2xl font-bold w-24 text-right">{team.chroma}</div>
      <div className="text-xs text-fog w-24">{team.territory_count} territories</div>
    </div>
  );
}

export default function Teams() {
  const { state } = useHub();
  const [toast, toastNode] = useToast();
  if (!state) return null;
  if (!state.session) return <div className="p-6 text-fog">Start a session to manage teams.</div>;
  return (
    <div className="h-full overflow-y-auto p-5 max-w-2xl space-y-3">
      <div className="text-fog text-sm">Names can be changed at any time — colors are fixed and drive every accent in the room.</div>
      {state.teams.map((t) => <TeamRow key={t.id} team={t} toast={toast} />)}
      {toastNode}
    </div>
  );
}
