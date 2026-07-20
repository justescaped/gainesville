import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Btn, Field, inputCls, teamHex, GRID_GLYPH, useToast } from '../hub.jsx';

// Color Grid puzzle builder (Minigames → Color Grid → Puzzles).
// Cells render exactly as the Stage will show them: saturated square + glyph.

const CYCLE = ['empty', 'red', 'blue', 'green', 'yellow'];
const PAINTS = ['red', 'blue', 'green', 'yellow', 'empty'];

export function Cell({ color, size = 44, onClick, outline = null }) {
  const filled = color && color !== 'empty';
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`rounded-md flex items-center justify-center select-none ${onClick ? '' : 'cursor-default'}`}
      style={{
        width: size, height: size,
        background: filled ? teamHex(color) : '#141416',
        border: outline ? `3px solid ${outline}` : '1px solid #26262A',
        color: 'rgba(0,0,0,0.55)', fontSize: size * 0.45
      }}>
      {filled ? GRID_GLYPH[color] : ''}
    </button>
  );
}

function emptyPattern(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 'empty'));
}

function resizePattern(pattern, rows, cols) {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => pattern[r]?.[c] ?? 'empty'));
}

function PuzzleEditor({ puzzle, toast, onDone }) {
  const [p, setP] = useState(puzzle ? { ...puzzle } : {
    name: '', rows: 4, cols: 4, pattern: emptyPattern(4, 4),
    difficulty: 'medium', modes: ['gameshow', 'escaperoom'], active: true
  });
  const [paint, setPaint] = useState(null);  // null = tap-to-cycle mode
  const set = (patch) => setP((cur) => ({ ...cur, ...patch }));
  const setSize = (rows, cols) => {
    const R = Math.min(8, Math.max(2, rows)), C = Math.min(8, Math.max(2, cols));
    set({ rows: R, cols: C, pattern: resizePattern(p.pattern, R, C) });
  };
  const tap = (r, c) => {
    const next = p.pattern.map((row) => [...row]);
    next[r][c] = paint !== null ? paint : CYCLE[(CYCLE.indexOf(next[r][c]) + 1) % CYCLE.length];
    set({ pattern: next });
  };
  const fillAll = (color) => set({ pattern: p.pattern.map((row) => row.map(() => color)) });
  const randomize = () => set({
    pattern: p.pattern.map((row) => row.map(() => CYCLE[Math.floor(Math.random() * CYCLE.length)]))
  });

  const save = async () => {
    try {
      if (puzzle) await api(`/grid/puzzles/${puzzle.id}`, 'PUT', p);
      else await api('/grid/puzzles', 'POST', p);
      onDone();
    } catch (e) { toast(e.message); }
  };

  return (
    <div className="rounded-xl border border-bone/40 bg-panel p-4 space-y-4">
      <div className="flex gap-4 flex-wrap items-end">
        <Field label="Name">
          <input className={`${inputCls} w-52`} value={p.name} autoFocus onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Rows">
          <input className={`${inputCls} w-16 text-center num`} inputMode="numeric" value={p.rows}
            onChange={(e) => setSize(Number(e.target.value) || 2, p.cols)} />
        </Field>
        <Field label="Cols">
          <input className={`${inputCls} w-16 text-center num`} inputMode="numeric" value={p.cols}
            onChange={(e) => setSize(p.rows, Number(e.target.value) || 2)} />
        </Field>
        <Field label="Difficulty">
          <select className={`${inputCls} !w-auto`} value={p.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
            <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm pb-3">
          <input type="checkbox" className="w-5 h-5" checked={!!p.active} onChange={(e) => set({ active: e.target.checked })} />
          Active
        </label>
      </div>

      <div className="flex gap-6 flex-wrap">
        {/* editor grid — this preview is exactly what the Stage renders */}
        <div>
          <div className="text-xs uppercase tracking-wider text-fog mb-1">
            {paint === null ? 'Tap a cell to cycle its color' : `Painting: ${paint}`}
          </div>
          <div className="inline-grid gap-1 p-2 rounded-lg bg-ink border border-line"
            style={{ gridTemplateColumns: `repeat(${p.cols}, auto)` }}>
            {p.pattern.map((row, r) => row.map((color, c) => (
              <Cell key={`${r}-${c}`} color={color} onClick={() => tap(r, c)} />
            )))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-fog mb-1">Palette mode</div>
            <div className="flex gap-1">
              <Btn className="!min-h-[40px] !px-3 text-xs" kind={paint === null ? 'primary' : 'default'} onClick={() => setPaint(null)}>Cycle</Btn>
              {PAINTS.map((c) => (
                <button key={c} onClick={() => setPaint(c)}
                  className={`w-10 h-10 rounded-md border-2 ${paint === c ? 'border-bone' : 'border-line'}`}
                  style={{ background: c === 'empty' ? '#141416' : teamHex(c) }}
                  title={c} />
              ))}
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            <Btn className="!min-h-[38px] !px-3 text-xs" onClick={() => fillAll(paint && paint !== 'empty' ? paint : 'red')}>Fill all</Btn>
            <Btn className="!min-h-[38px] !px-3 text-xs" onClick={() => fillAll('empty')}>Clear all</Btn>
            <Btn className="!min-h-[38px] !px-3 text-xs" onClick={randomize}>Randomize</Btn>
          </div>
          <Field label="Modes">
            <div className="flex gap-2">
              {['gameshow', 'escaperoom'].map((m) => (
                <Btn key={m} className="!min-h-[38px] !px-3 text-xs"
                  kind={p.modes.includes(m) ? 'primary' : 'default'}
                  onClick={() => {
                    const modes = p.modes.includes(m) ? p.modes.filter((x) => x !== m) : [...p.modes, m];
                    if (modes.length) set({ modes });
                  }}>
                  {m === 'gameshow' ? 'Game show' : 'Escape room'}
                </Btn>
              ))}
            </div>
          </Field>
        </div>
      </div>

      <div className="flex gap-2">
        <Btn kind="primary" className="flex-1" onClick={save}>{puzzle ? 'Save puzzle' : 'Create puzzle'}</Btn>
        <Btn onClick={onDone}>Cancel</Btn>
      </div>
    </div>
  );
}

export default function GridPuzzles() {
  const [toast, toastNode] = useToast();
  const [puzzles, setPuzzles] = useState(null);
  const [editing, setEditing] = useState(null);   // null | 'new' | puzzle
  const [diffFilter, setDiffFilter] = useState('');

  const refresh = () => api('/grid/puzzles').then((d) => setPuzzles(d.puzzles)).catch((e) => toast(e.message));
  useEffect(() => { refresh(); }, []);
  if (!puzzles) return null;

  const act = (fn) => fn.then(refresh).catch((e) => toast(e.message));
  const shown = puzzles.filter((p) => !diffFilter || p.difficulty === diffFilter);

  return (
    <div className="h-full overflow-y-auto p-5 max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-bold text-lg">Color Grid — Puzzles</h2>
        <Link to="/admin/minigames" className="text-xs text-fog hover:text-bone">← back to Minigames</Link>
        <span className="flex-1" />
        <select className={`${inputCls} !w-auto !min-h-[40px]`} value={diffFilter} onChange={(e) => setDiffFilter(e.target.value)}>
          <option value="">All difficulties</option>
          <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
        </select>
        <Btn kind="primary" onClick={() => setEditing('new')}>+ New puzzle</Btn>
      </div>

      {editing === 'new' && <PuzzleEditor toast={toast} onDone={() => { setEditing(null); refresh(); }} />}

      <div className="grid grid-cols-2 gap-3">
        {shown.map((p) => (
          editing?.id === p.id
            ? <div key={p.id} className="col-span-2"><PuzzleEditor puzzle={p} toast={toast} onDone={() => { setEditing(null); refresh(); }} /></div>
            : (
              <div key={p.id} className={`rounded-xl border border-line bg-panel p-3 flex gap-3 ${p.active ? '' : 'opacity-50'}`}>
                <div className="inline-grid gap-[2px] shrink-0 self-start p-1 rounded bg-ink border border-line"
                  style={{ gridTemplateColumns: `repeat(${p.cols}, auto)` }}>
                  {p.pattern.map((row, r) => row.map((color, c) => (
                    <Cell key={`${r}-${c}`} color={color} size={Math.min(18, 120 / Math.max(p.rows, p.cols))} />
                  )))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{p.name}</div>
                  <div className="text-xs text-fog">
                    {p.rows}×{p.cols} · {p.difficulty}{!p.active && ' · inactive'}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <Btn className="!min-h-[34px] !px-2.5 text-xs" onClick={() => setEditing(p)}>Edit</Btn>
                    <Btn className="!min-h-[34px] !px-2.5 text-xs" onClick={() => act(api(`/grid/puzzles/${p.id}/duplicate`, 'POST'))}>Duplicate</Btn>
                    <Btn className="!min-h-[34px] !px-2.5 text-xs" kind={p.active ? 'default' : 'primary'}
                      onClick={() => act(api(`/grid/puzzles/${p.id}`, 'PUT', { active: !p.active }))}>
                      {p.active ? 'Disable' : 'Enable'}
                    </Btn>
                    <Btn className="!min-h-[34px] !px-2.5 text-xs" kind="danger"
                      onClick={() => { if (confirm(`Delete "${p.name}"?`)) act(api(`/grid/puzzles/${p.id}`, 'DELETE')); }}>✕</Btn>
                  </div>
                </div>
              </div>
            )
        ))}
      </div>
      {toastNode}
    </div>
  );
}
