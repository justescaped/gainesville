import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHub, api, Btn, Field, inputCls, useToast } from '../hub.jsx';

// Minutes + seconds pair for timer entry (spec: "5m 30s", not raw seconds).
function TimerInput({ seconds, onChange }) {
  const m = Math.floor((seconds || 0) / 60);
  const s = (seconds || 0) % 60;
  return (
    <div className="flex items-center gap-2">
      <input className={`${inputCls} w-20 text-center num`} inputMode="numeric" value={m}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0) * 60 + s)} />
      <span className="text-fog">m</span>
      <input className={`${inputCls} w-20 text-center num`} inputMode="numeric" value={s}
        onChange={(e) => onChange(m * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0)))} />
      <span className="text-fog">s</span>
    </div>
  );
}

function RulesEditor({ rules, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(rules).map(([key, val]) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <span className="w-40 text-fog truncate">{key.replaceAll('_', ' ')}</span>
          <input className={`${inputCls} !min-h-[38px] w-24 text-center num`} inputMode="numeric" value={val}
            onChange={(e) => onChange({ ...rules, [key]: Number(e.target.value) || 0 })} />
        </label>
      ))}
    </div>
  );
}

// ---------- Phase 2: quiz minigame settings ----------
function NumField({ label, value, onChange, w = 'w-24' }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-44 text-fog">{label}</span>
      <input className={`${inputCls} !min-h-[38px] ${w} text-center num`} inputMode="numeric" value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}

function StreakLadder({ ladder, onChange }) {
  const entries = Object.entries(ladder || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const set = (k, v) => onChange({ ...ladder, [k]: v });
  const remove = (k) => { const next = { ...ladder }; delete next[k]; onChange(next); };
  const add = () => {
    const next = entries.length ? Math.max(...entries.map(([k]) => Number(k))) + 1 : 2;
    onChange({ ...ladder, [next]: 0 });
  };
  return (
    <div>
      <span className="block text-xs uppercase tracking-wider text-fog mb-1">Streak ladder — bonus at each consecutive-correct count</span>
      <div className="space-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-sm">
            <span className="w-24 text-fog">×{k} in a row</span>
            <span className="text-fog">+</span>
            <input className={`${inputCls} !min-h-[38px] w-24 text-center num`} inputMode="numeric" value={v}
              onChange={(e) => set(k, Number(e.target.value) || 0)} />
            <Btn kind="ghost" className="!min-h-[36px] !px-2 text-xs text-tred" onClick={() => remove(k)}>✕</Btn>
          </div>
        ))}
        <Btn kind="ghost" className="!min-h-[36px] text-xs" onClick={add}>+ Add rung</Btn>
      </div>
    </div>
  );
}

function QuizGameshowSettings({ block, onChange }) {
  const set = (patch) => onChange({ ...block, ...patch });
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="text-xs uppercase tracking-wider text-fog">Question engine</div>
      <NumField label="Seconds per question" value={block.question_seconds} onChange={(v) => set({ question_seconds: v })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="w-5 h-5" checked={!!block.randomize_points}
          onChange={(e) => set({ randomize_points: e.target.checked })} />
        Randomize each question's point value
      </label>
      {block.randomize_points && (
        <div className="flex gap-6">
          <NumField label="Min points" value={block.points_min} onChange={(v) => set({ points_min: v })} />
          <NumField label="Max points" value={block.points_max} onChange={(v) => set({ points_max: v })} />
        </div>
      )}
      <StreakLadder ladder={block.streak_ladder} onChange={(l) => set({ streak_ladder: l })} />
      <NumField label="Passes per team" value={block.max_passes_per_team} onChange={(v) => set({ max_passes_per_team: v })} />
      <NumField label="Questions per game (0 = until timer)" value={block.question_count} onChange={(v) => set({ question_count: v })} />
      {block.has_mole && (
        <div className="flex gap-6">
          <NumField label="Mole target (exact)" value={block.mole_target} onChange={(v) => set({ mole_target: v })} />
          <NumField label="Mole reward" value={block.mole_reward} onChange={(v) => set({ mole_reward: v })} />
        </div>
      )}
    </div>
  );
}

function QuizEscapeSettings({ block, onChange }) {
  const set = (patch) => onChange({ ...block, ...patch });
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="text-xs uppercase tracking-wider text-fog">Question engine</div>
      <NumField label="Seconds per question" value={block.question_seconds} onChange={(v) => set({ question_seconds: v })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="w-5 h-5" checked={!!block.randomize_points}
          onChange={(e) => set({ randomize_points: e.target.checked })} />
        Randomize each question's point value
      </label>
      {block.randomize_points && (
        <div className="flex gap-6">
          <NumField label="Min points" value={block.points_min} onChange={(v) => set({ points_min: v })} />
          <NumField label="Max points" value={block.points_max} onChange={(v) => set({ points_max: v })} />
        </div>
      )}
      <StreakLadder ladder={block.streak_ladder} onChange={(l) => set({ streak_ladder: l })} />
      <NumField label="Categories per attempt" value={block.categories_per_attempt} onChange={(v) => set({ categories_per_attempt: v })} />
      <NumField label="Max attempts" value={block.max_attempts} onChange={(v) => set({ max_attempts: v })} />
      <NumField label="Questions per category" value={block.questions_per_category} onChange={(v) => set({ questions_per_category: v })} />
    </div>
  );
}

// ---------- Phase 3: Color Grid minigame settings ----------
function DifficultyFilter({ value, onChange }) {
  const filter = value ?? ['easy', 'medium', 'hard'];
  const toggle = (d) => {
    const next = filter.includes(d) ? filter.filter((x) => x !== d) : [...filter, d];
    if (next.length) onChange(next);
  };
  return (
    <div>
      <span className="block text-xs uppercase tracking-wider text-fog mb-1">Puzzle difficulty filter</span>
      <div className="flex gap-2">
        {['easy', 'medium', 'hard'].map((d) => (
          <Btn key={d} className="!min-h-[38px] !px-3 text-xs" kind={filter.includes(d) ? 'primary' : 'default'} onClick={() => toggle(d)}>{d}</Btn>
        ))}
      </div>
    </div>
  );
}

function GridGameshowSettings({ block, onChange }) {
  const set = (patch) => onChange({ ...block, ...patch });
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="text-xs uppercase tracking-wider text-fog">Color Grid</div>
      <NumField label="Reveal seconds" value={block.reveal_seconds} onChange={(v) => set({ reveal_seconds: v })} />
      <NumField label="Build seconds" value={block.build_seconds} onChange={(v) => set({ build_seconds: v })} />
      <NumField label="Points per correct cell" value={block.points_per_correct} onChange={(v) => set({ points_per_correct: v })} />
      <NumField label="Points per wrong cell (±)" value={block.points_per_wrong} onChange={(v) => set({ points_per_wrong: v })} />
      <NumField label="Perfect-grid bonus" value={block.perfect_bonus} onChange={(v) => set({ perfect_bonus: v })} />
      {block.has_mole && (
        <>
          <NumField label="Mole reward" value={block.mole_reward} onChange={(v) => set({ mole_reward: v })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-5 h-5" checked={block.randomize_mole_team !== false}
              onChange={(e) => set({ randomize_mole_team: e.target.checked })} />
            Randomize the mole team (off = Admin picks from the mole panel)
          </label>
        </>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="w-5 h-5" checked={!!block.allow_repeat_reveal}
          onChange={(e) => set({ allow_repeat_reveal: e.target.checked })} />
        Allow repeat reveal
      </label>
      {block.allow_repeat_reveal && (
        <NumField label="Repeat reveal cost (per team)" value={block.repeat_reveal_cost} onChange={(v) => set({ repeat_reveal_cost: v })} />
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="w-5 h-5" checked={!!block.show_placements}
          onChange={(e) => set({ show_placements: e.target.checked })} />
        Show placements on Stage during the build (never shows correctness)
      </label>
      <DifficultyFilter value={block.difficulty_filter} onChange={(v) => set({ difficulty_filter: v })} />
    </div>
  );
}

function GridEscapeSettings({ block, onChange }) {
  const set = (patch) => onChange({ ...block, ...patch });
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="text-xs uppercase tracking-wider text-fog">Color Grid</div>
      <NumField label="Reveal seconds" value={block.reveal_seconds} onChange={(v) => set({ reveal_seconds: v })} />
      <NumField label="Build seconds" value={block.build_seconds} onChange={(v) => set({ build_seconds: v })} />
      <NumField label="Points per correct cell" value={block.points_per_correct} onChange={(v) => set({ points_per_correct: v })} />
      <NumField label="Chroma per second remaining" value={block.per_second_remaining} onChange={(v) => set({ per_second_remaining: v })} />
      <NumField label="Perfect-grid bonus" value={block.perfect_bonus} onChange={(v) => set({ perfect_bonus: v })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="w-5 h-5" checked={!!block.require_exact}
          onChange={(e) => set({ require_exact: e.target.checked })} />
        Complete the instant the shelf matches exactly (time bonus applies)
      </label>
      <NumField label="Repeat reveal cost (0 = free hint)" value={block.repeat_reveal_cost} onChange={(v) => set({ repeat_reveal_cost: v })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="w-5 h-5" checked={!!block.show_placements}
          onChange={(e) => set({ show_placements: e.target.checked })} />
        Show placements on Stage during the build
      </label>
      <DifficultyFilter value={block.difficulty_filter} onChange={(v) => set({ difficulty_filter: v })} />
    </div>
  );
}

function Editor({ minigame, toast, onSaved }) {
  const [m, setM] = useState(minigame);
  useEffect(() => setM(minigame), [minigame]);
  const set = (patch) => setM((cur) => ({ ...cur, ...patch }));

  const uploadImage = async (file) => {
    const fd = new FormData();
    fd.append('image', file);
    try {
      const { path } = await api('/upload', 'POST', fd);
      set({ image: path });
    } catch (e) { toast(e.message); }
  };

  const save = async () => {
    try { await api(`/minigames/${m.id}`, 'PUT', m); onSaved(); toast('Saved — config pushed to Node-RED.'); }
    catch (e) { toast(e.message); }
  };

  const toggleMode = (mode) => {
    const modes = m.enabled_modes.includes(mode)
      ? m.enabled_modes.filter((x) => x !== mode)
      : [...m.enabled_modes, mode];
    if (modes.length) set({ enabled_modes: modes });
  };

  return (
    <div className="space-y-5 pb-8">
      <Field label="Name">
        <input className={inputCls} value={m.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>

      <Field label="Image (png / jpg / jpeg / gif / webp)">
        <div className="flex items-center gap-3">
          <div className="w-28 h-20 rounded-lg border border-line bg-ink overflow-hidden flex items-center justify-center text-xs text-fog">
            {m.image ? <img src={m.image} alt="" className="w-full h-full object-cover" /> : 'none'}
          </div>
          <label className="min-h-[44px] px-4 rounded-lg border border-line bg-panel flex items-center cursor-pointer hover:border-fog text-sm">
            {m.image ? 'Replace image' : 'Upload image'}
            <input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" className="hidden"
              onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])} />
          </label>
          {m.image && <Btn kind="ghost" onClick={() => set({ image: null })}>Remove</Btn>}
        </div>
      </Field>

      <Field label="Enabled modes">
        <div className="flex gap-2">
          {['gameshow', 'escaperoom'].map((mode) => (
            <Btn key={mode} kind={m.enabled_modes.includes(mode) ? 'primary' : 'default'} onClick={() => toggleMode(mode)}>
              {mode === 'gameshow' ? 'Game show' : 'Escape room'}
            </Btn>
          ))}
        </div>
      </Field>

      {m.enabled_modes.includes('gameshow') && (
        <div className="rounded-xl border border-line p-4 space-y-4">
          <div className="font-semibold">Game show rules</div>
          <Field label="Round number">
            <input className={`${inputCls} w-24 text-center num`} inputMode="numeric" value={m.round_number ?? ''}
              onChange={(e) => set({ round_number: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Timer"><TimerInput seconds={m.gameshow.timer_seconds} onChange={(v) => set({ gameshow: { ...m.gameshow, timer_seconds: v } })} /></Field>
          {Object.keys(m.gameshow.chroma_rules || {}).length > 0 && (
            <Field label="Chroma rules"><RulesEditor rules={m.gameshow.chroma_rules} onChange={(r) => set({ gameshow: { ...m.gameshow, chroma_rules: r } })} /></Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-5 h-5" checked={!!m.gameshow.has_mole}
              onChange={(e) => set({ gameshow: { ...m.gameshow, has_mole: e.target.checked } })} />
            Has a mole {m.ui_component !== 'quiz' && <span className="text-fog">(text objective, delivered via the mole webhook)</span>}
          </label>
          {m.ui_component !== 'quiz' && m.ui_component !== 'grid' && m.gameshow.has_mole && (
            <div className="flex gap-6 items-center">
              <NumField label="Mole reward (objective default)" value={m.gameshow.mole_reward} onChange={(v) => set({ gameshow: { ...m.gameshow, mole_reward: v } })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="w-5 h-5" checked={m.gameshow.randomize_mole_team !== false}
                  onChange={(e) => set({ gameshow: { ...m.gameshow, randomize_mole_team: e.target.checked } })} />
                Randomize team
              </label>
            </div>
          )}
          {m.ui_component === 'quiz' && (
            <QuizGameshowSettings block={m.gameshow} onChange={(b) => set({ gameshow: b })} />
          )}
          {m.ui_component === 'grid' && (
            <GridGameshowSettings block={m.gameshow} onChange={(b) => set({ gameshow: b })} />
          )}
        </div>
      )}

      {m.enabled_modes.includes('escaperoom') && (
        <div className="rounded-xl border border-line p-4 space-y-4">
          <div className="font-semibold">Escape room rules</div>
          <Field label="Timer"><TimerInput seconds={m.escaperoom.timer_seconds} onChange={(v) => set({ escaperoom: { ...m.escaperoom, timer_seconds: v } })} /></Field>
          {Object.keys(m.escaperoom.chroma_rules || {}).length > 0 && (
            <Field label="Chroma rules"><RulesEditor rules={m.escaperoom.chroma_rules} onChange={(r) => set({ escaperoom: { ...m.escaperoom, chroma_rules: r } })} /></Field>
          )}
          {m.ui_component === 'quiz' && (
            <QuizEscapeSettings block={m.escaperoom} onChange={(b) => set({ escaperoom: b })} />
          )}
          {m.ui_component === 'grid' && (
            <GridEscapeSettings block={m.escaperoom} onChange={(b) => set({ escaperoom: b })} />
          )}
        </div>
      )}

      {m.ui_component === 'grid' && (
        <div className="rounded-xl border border-line p-4 flex items-center justify-between">
          <div>
            <div className="font-semibold">Puzzles</div>
            <div className="text-xs text-fog">Author the target patterns this game draws from.</div>
          </div>
          <Link to="/admin/grid-puzzles"
            className="min-h-[44px] px-4 rounded-lg bg-bone text-ink font-semibold text-sm flex items-center hover:bg-white">
            Open puzzle builder →
          </Link>
        </div>
      )}

      <div className="rounded-xl border border-line p-4 space-y-4">
        <div className="font-semibold">Node-RED</div>
        <Field label="on_start URL (blank = base URL default)">
          <input className={inputCls} value={m.nodered?.on_start || ''} placeholder="http://nodered.local:1880/prism/minigame-start"
            onChange={(e) => set({ nodered: { ...m.nodered, on_start: e.target.value } })} />
        </Field>
        <Field label="on_end URL (blank = base URL default)">
          <input className={inputCls} value={m.nodered?.on_end || ''} placeholder="http://nodered.local:1880/prism/minigame-end"
            onChange={(e) => set({ nodered: { ...m.nodered, on_end: e.target.value } })} />
        </Field>
        <Field label="Inbound key (Pis tag their POSTs with this)">
          <input className={inputCls} value={m.nodered?.inbound_key || ''}
            onChange={(e) => set({ nodered: { ...m.nodered, inbound_key: e.target.value } })} />
        </Field>
      </div>

      <Btn kind="primary" className="w-full" onClick={save}>Save minigame</Btn>
    </div>
  );
}

// Round order list: drag on desktop, ▲▼ for touch. Position = round number.
function RoundOrder({ minigames, toast }) {
  const ordered = [...minigames].sort((a, b) => (a.round_number ?? 999) - (b.round_number ?? 999));
  const [dragId, setDragId] = useState(null);
  const commit = (ids) => api('/minigames/order', 'POST', { ids }).catch((e) => toast(e.message));
  const move = (i, dir) => {
    const ids = ordered.map((m) => m.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    commit(ids);
  };
  const dropOn = (targetId) => {
    if (!dragId || dragId === targetId) return;
    const ids = ordered.map((m) => m.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    commit(ids);
    setDragId(null);
  };
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-xs uppercase tracking-wider text-fog mb-2">Round order (game show)</div>
      <ul className="space-y-1">
        {ordered.map((m, i) => (
          <li key={m.id} draggable
            onDragStart={() => setDragId(m.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dropOn(m.id)}
            className="flex items-center gap-2 bg-panel border border-line rounded-lg px-3 py-2 text-sm cursor-grab">
            <span className="num text-fog w-6">{i + 1}</span>
            <span className="flex-1 truncate">{m.name}</span>
            <button className="px-2 py-1 text-fog hover:text-bone" onClick={() => move(i, -1)}>▲</button>
            <button className="px-2 py-1 text-fog hover:text-bone" onClick={() => move(i, 1)}>▼</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Minigames() {
  const { state } = useHub();
  const [toast, toastNode] = useToast();
  const [selectedId, setSelectedId] = useState(null);
  if (!state) return null;
  const minigames = state.minigames;
  const selected = minigames.find((m) => m.id === selectedId) || minigames[0];

  return (
    <div className="h-full flex">
      <div className="w-64 shrink-0 border-r border-line p-3 space-y-3 overflow-y-auto">
        {minigames.map((m) => (
          <button key={m.id} onClick={() => setSelectedId(m.id)}
            className={`w-full rounded-lg border p-2 text-left ${selected?.id === m.id ? 'border-bone bg-panel' : 'border-line hover:border-fog'}`}>
            <div className="h-20 rounded bg-ink border border-line mb-1 overflow-hidden flex items-center justify-center text-fog text-xs">
              {m.image ? <img src={m.image} alt="" className="w-full h-full object-cover" /> : 'no image'}
            </div>
            <div className="text-sm font-semibold truncate">{m.name}</div>
            <div className="text-[10px] text-fog">{m.round_number != null ? `Round ${m.round_number} · ` : ''}{m.enabled_modes.join(' + ')}</div>
          </button>
        ))}
        <RoundOrder minigames={minigames} toast={toast} />
        <div className="text-[11px] text-fog leading-relaxed px-1">
          New minigames are added by dropping a JSON manifest into <code>/minigames</code> and restarting the Hub. See docs/ADDING_A_MINIGAME.md.
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5 max-w-2xl">
        {selected && <Editor key={selected.id} minigame={selected} toast={toast} onSaved={() => {}} />}
      </div>
      {toastNode}
    </div>
  );
}
