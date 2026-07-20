import React, { useEffect, useState } from 'react';
import { api, Btn, Field, inputCls, ColorDot, fmtTime, useToast } from '../hub.jsx';

// History — Phase 3, Part 3. All-time and monthly leaderboards, the full run
// list, and the session archive (the record you pull up when someone disputes
// a score on stream).

function dur(sec) { return fmtTime(sec * 1000); }
function when(ts) { return ts?.slice(0, 16).replace('T', ' ') ?? ''; }

function Board({ runs, onOpen }) {
  if (!runs.length) return <div className="text-fog text-sm p-4">No runs yet.</div>;
  return (
    <ul className="divide-y divide-line">
      {runs.map((r, i) => (
        <li key={r.id}>
          <button className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-panel" onClick={() => onOpen(r)}>
            <span className={`num w-10 text-xl font-black ${i === 0 ? 'text-tyellow' : i < 3 ? 'text-bone' : 'text-fog'}`}>{i + 1}</span>
            <span className="flex-1 min-w-0">
              <span className="font-semibold">{r.team_name}</span>
              {r.player_names?.length > 0 && <span className="text-fog text-sm ml-2">{r.player_names.join(', ')}</span>}
            </span>
            <span className="num text-2xl font-bold">{r.final_chroma}</span>
            <span className="num text-fog w-20 text-right">{dur(r.duration_seconds)}</span>
            <span className="text-fog text-xs w-32 text-right">{when(r.ended_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RecentList({ runs, onOpen }) {
  if (!runs.length) return <div className="text-fog text-sm p-4">No runs match.</div>;
  return (
    <ul className="divide-y divide-line">
      {runs.map((r) => (
        <li key={r.id}>
          <button className={`w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-panel ${r.visible ? '' : 'opacity-50'}`} onClick={() => onOpen(r)}>
            <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-ink border border-line shrink-0">
              {r.mode === 'gameshow' ? 'Show' : 'Escape'}
            </span>
            <span className="flex-1 min-w-0 truncate font-semibold">{r.team_name}</span>
            {!r.visible && <span className="text-xs text-tred">hidden</span>}
            <span className="num text-xl font-bold">{r.final_chroma}</span>
            <span className="num text-fog w-20 text-right">{dur(r.duration_seconds)}</span>
            <span className="text-fog text-xs w-32 text-right">{when(r.ended_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Archive({ run, onBack, onSaved, toast }) {
  const [detail, setDetail] = useState(null);
  const [edit, setEdit] = useState({
    team_name: run.team_name,
    player_names: (run.player_names || []).join(', '),
    notes: run.notes || '',
    visible: !!run.visible
  });
  useEffect(() => { api(`/history/${run.id}/archive`).then(setDetail).catch((e) => toast(e.message)); }, [run.id]);

  const save = async () => {
    try {
      await api(`/history/${run.id}`, 'PUT', {
        team_name: edit.team_name,
        player_names: edit.player_names.trim() ? edit.player_names.split(',').map((s) => s.trim()).filter(Boolean) : null,
        notes: edit.notes,
        visible: edit.visible
      });
      toast('Saved.');
      onSaved();
    } catch (e) { toast(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Btn className="!min-h-[38px]" onClick={onBack}>← Back</Btn>
        <div className="text-lg font-bold">{run.team_name}</div>
        <span className="num text-2xl font-black">{run.final_chroma}</span>
        <span className="text-fog text-sm">{run.mode} · {dur(run.duration_seconds)} · {when(run.ended_at)}</span>
      </div>

      <div className="rounded-xl border border-line bg-panel p-4 grid grid-cols-2 gap-3">
        <Field label="Team name">
          <input className={inputCls} value={edit.team_name} onChange={(e) => setEdit({ ...edit, team_name: e.target.value })} />
        </Field>
        <Field label="Player names (comma-separated)">
          <input className={inputCls} value={edit.player_names} onChange={(e) => setEdit({ ...edit, player_names: e.target.value })} />
        </Field>
        <Field label="Notes">
          <input className={inputCls} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
        </Field>
        <div className="flex items-end gap-3 pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-5 h-5" checked={edit.visible} onChange={(e) => setEdit({ ...edit, visible: e.target.checked })} />
            Visible on public boards
          </label>
          <Btn kind="primary" className="!min-h-[40px]" onClick={save}>Save</Btn>
        </div>
      </div>

      {!detail ? <div className="text-fog text-sm">Loading archive…</div> : (
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-line bg-panel overflow-hidden">
            <div className="px-3 py-2 border-b border-line text-xs uppercase tracking-wider text-fog">
              Chroma ledger — {detail.ledger.length} entries
            </div>
            <ul className="max-h-[45vh] overflow-y-auto divide-y divide-line text-sm">
              {detail.ledger.map((e) => (
                <li key={e.id} className={`px-3 py-1.5 flex items-center gap-2 ${e.voided ? 'opacity-40 line-through' : ''}`}>
                  <ColorDot color={e.team_color} size={10} />
                  <span className={`num w-14 text-right font-bold ${e.amount >= 0 ? 'text-tgreen' : 'text-tred'}`}>
                    {e.amount >= 0 ? '+' : ''}{e.amount}
                  </span>
                  <span className="flex-1 truncate">{e.reason}</span>
                  <span className="text-fog text-xs">{e.source}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-panel overflow-hidden">
              <div className="px-3 py-2 border-b border-line text-xs uppercase tracking-wider text-fog">Mole assignments</div>
              {detail.mole_assignments.length === 0
                ? <div className="text-fog text-sm p-3">None this session.</div>
                : (
                  <ul className="divide-y divide-line text-sm">
                    {detail.mole_assignments.map((m) => (
                      <li key={m.id} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ColorDot color={m.team_color} size={10} />
                          <b>{m.team_name}</b>
                          <span className="text-fog text-xs">{m.minigame_id}</span>
                          <span className={`ml-auto text-xs font-bold uppercase ${
                            m.outcome === 'hit' ? 'text-tgreen' : m.outcome === 'missed' ? 'text-tred' : 'text-fog'}`}>{m.outcome}</span>
                        </div>
                        <div className="text-fog italic mt-0.5">“{m.objective_text}”</div>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
            <div className="rounded-xl border border-line bg-panel overflow-hidden">
              <div className="px-3 py-2 border-b border-line text-xs uppercase tracking-wider text-fog">Minigames played</div>
              <div className="p-3 text-sm">
                {detail.run.minigames_played.length ? detail.run.minigames_played.join(', ') : <span className="text-fog">None recorded.</span>}
              </div>
            </div>
            {detail.grid_rounds.length > 0 && (
              <div className="rounded-xl border border-line bg-panel overflow-hidden">
                <div className="px-3 py-2 border-b border-line text-xs uppercase tracking-wider text-fog">Grid rounds</div>
                <ul className="divide-y divide-line text-sm">
                  {detail.grid_rounds.map((g) => (
                    <li key={g.id} className="px-3 py-2 flex items-center gap-3">
                      <span className="flex-1">{g.puzzle_name || g.puzzle_id}</span>
                      <span className="text-fog text-xs">{g.mode}</span>
                      <span className="text-fog text-xs">{g.scores ? `scored` : 'unscored'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function History() {
  const [toast, toastNode] = useToast();
  const [tab, setTab] = useState('alltime');
  const [data, setData] = useState(null);
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [open, setOpen] = useState(null);

  const refresh = () => {
    if (tab === 'alltime') api('/history/alltime').then((d) => setData(d.runs)).catch((e) => toast(e.message));
    else if (tab === 'monthly') {
      api(`/history/monthly${month ? `?month=${month}` : ''}`)
        .then((d) => { setData(d.runs); setMonths(d.months); })
        .catch((e) => toast(e.message));
    } else {
      api(`/history/recent${modeFilter ? `?mode=${modeFilter}` : ''}`)
        .then((d) => setData(d.runs)).catch((e) => toast(e.message));
    }
  };
  useEffect(() => { setData(null); refresh(); }, [tab, month, modeFilter]);

  if (open) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <Archive run={open} toast={toast} onBack={() => setOpen(null)} onSaved={() => { setOpen(null); refresh(); }} />
        {toastNode}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5 max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-bold text-lg">History</h2>
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-sm">
          {[['alltime', 'All-Time'], ['monthly', 'Monthly'], ['recent', 'Recent']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 ${tab === k ? 'bg-bone text-ink font-semibold' : 'text-fog hover:text-bone'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'monthly' && (
          <select className={`${inputCls} !w-auto !min-h-[40px]`} value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">This month</option>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {tab === 'recent' && (
          <select className={`${inputCls} !w-auto !min-h-[40px]`} value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
            <option value="">Both modes</option>
            <option value="escaperoom">Escape room</option>
            <option value="gameshow">Game show</option>
          </select>
        )}
        <span className="flex-1" />
        <a href="/api/history/export.csv" download
          className="min-h-[40px] px-4 rounded-lg border border-line bg-panel text-sm flex items-center hover:border-fog">
          Export CSV
        </a>
      </div>
      {tab !== 'recent' && (
        <div className="text-xs text-fog">
          Escape-room runs only, best Chroma first (ties: faster run wins). Tap a run to open its archive. Hidden runs are excluded.
        </div>
      )}

      <div className="rounded-xl border border-line bg-panel/50 overflow-hidden">
        {!data ? <div className="text-fog text-sm p-4">Loading…</div>
          : tab === 'recent' ? <RecentList runs={data} onOpen={setOpen} /> : <Board runs={data} onOpen={setOpen} />}
      </div>
      {toastNode}
    </div>
  );
}
