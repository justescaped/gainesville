import React, { useEffect, useRef, useState } from 'react';
import { api, Btn, Field, inputCls, useToast } from '../hub.jsx';

// Question Banks — authoring for the Phase 2 question engine. Two banks
// (Trivia Twist / Puzzle Pass) share one editor. Categories hold any number of
// questions; the only guardrail is a "may run dry" warning under 5 active.

// ---------- tiny CSV parser (quotes + escaped quotes) ----------
function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// ---------- question editor ----------
function QuestionEditor({ question, categoryId, toast, onDone }) {
  const blank = {
    text: '', image: null, base_points: 100, active: true,
    answers: [{ text: '', is_correct: true }, { text: '', is_correct: false }]
  };
  const [q, setQ] = useState(question ? {
    text: question.text, image: question.image, base_points: question.base_points, active: !!question.active,
    answers: question.answers.map((a) => ({ text: a.text, is_correct: !!a.is_correct }))
  } : blank);
  const set = (patch) => setQ((c) => ({ ...c, ...patch }));

  const setAnswer = (i, patch) => set({ answers: q.answers.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  // Exactly one correct, always: marking a new one unmarks the old one.
  const markCorrect = (i) => set({ answers: q.answers.map((a, j) => ({ ...a, is_correct: j === i })) });
  const addAnswer = () => q.answers.length < 4 && set({ answers: [...q.answers, { text: '', is_correct: false }] });
  const removeAnswer = (i) => {
    if (q.answers.length <= 2) return;
    let next = q.answers.filter((_, j) => j !== i);
    if (!next.some((a) => a.is_correct)) next = next.map((a, j) => ({ ...a, is_correct: j === 0 }));
    set({ answers: next });
  };

  const uploadImage = async (file) => {
    const fd = new FormData(); fd.append('image', file);
    try { const { path } = await api('/upload', 'POST', fd); set({ image: path }); } catch (e) { toast(e.message); }
  };

  const save = async () => {
    try {
      if (question) await api(`/qb/questions/${question.id}`, 'PUT', q);
      else await api(`/qb/categories/${categoryId}/questions`, 'POST', q);
      onDone(true);
    } catch (e) { toast(e.message); }
  };

  const letters = ['A', 'B', 'C', 'D'];
  return (
    <div className="rounded-xl border border-bone/40 bg-panel p-4 space-y-3">
      <Field label="Question text">
        <textarea className={`${inputCls} py-2 min-h-[70px]`} value={q.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <div className="flex items-center gap-3">
        <Field label="Image (shown between text and answers)">
          <div className="flex items-center gap-2">
            <div className="w-24 h-16 rounded-lg border border-line bg-ink overflow-hidden flex items-center justify-center text-[10px] text-fog">
              {q.image ? <img src={q.image} alt="" className="w-full h-full object-cover" /> : 'none'}
            </div>
            <label className="min-h-[44px] px-3 rounded-lg border border-line flex items-center cursor-pointer hover:border-fog text-sm">
              {q.image ? 'Replace' : 'Upload'}
              <input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" className="hidden"
                onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])} />
            </label>
            {q.image && <Btn kind="ghost" className="!min-h-[38px]" onClick={() => set({ image: null })}>Remove</Btn>}
          </div>
        </Field>
        <Field label="Base points">
          <input className={`${inputCls} w-24 text-center num`} inputMode="numeric" value={q.base_points}
            onChange={(e) => set({ base_points: Number(e.target.value) || 0 })} />
        </Field>
        <label className="flex items-center gap-2 text-sm mt-5">
          <input type="checkbox" className="w-5 h-5" checked={q.active} onChange={(e) => set({ active: e.target.checked })} />
          Active
        </label>
      </div>
      <div className="space-y-2">
        <span className="block text-xs uppercase tracking-wider text-fog">Answers (2–4, tap the letter to mark correct)</span>
        {q.answers.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <button onClick={() => markCorrect(i)}
              className={`w-11 h-11 rounded-lg font-black shrink-0 border-2 ${a.is_correct ? 'bg-tgreen text-ink border-tgreen' : 'border-line text-fog hover:border-fog'}`}
              title={a.is_correct ? 'Correct answer' : 'Mark as correct'}>
              {letters[i]}
            </button>
            <input className={`${inputCls} !min-h-[44px] flex-1`} value={a.text} placeholder={`Answer ${letters[i]}`}
              onChange={(e) => setAnswer(i, { text: e.target.value })} />
            <Btn kind="ghost" className="!min-h-[40px] !px-3 text-tred" disabled={q.answers.length <= 2} onClick={() => removeAnswer(i)}>✕</Btn>
          </div>
        ))}
        {q.answers.length < 4 && <Btn kind="ghost" className="!min-h-[40px]" onClick={addAnswer}>+ Add answer</Btn>}
      </div>
      <div className="flex gap-2 justify-end">
        <Btn onClick={() => onDone(false)}>Cancel</Btn>
        <Btn kind="primary" onClick={save}>{question ? 'Save question' : 'Add question'}</Btn>
      </div>
    </div>
  );
}

// ---------- CSV import modal ----------
function ImportModal({ category, toast, onClose }) {
  const [rows, setRows] = useState(null);      // parsed objects
  const [preview, setPreview] = useState(null); // server validation
  const fileRef = useRef(null);

  const HEADERS = ['question', 'image_filename', 'answer_a', 'answer_b', 'answer_c', 'answer_d', 'correct_letter', 'base_points'];

  const onFile = async (file) => {
    const text = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.length) return toast('CSV is empty');
    // header row optional — detect it
    let start = 0;
    const first = parsed[0].map((c) => c.trim().toLowerCase());
    if (first[0] === 'question') start = 1;
    const objs = parsed.slice(start).map((r) => Object.fromEntries(HEADERS.map((h, i) => [h, r[i] ?? ''])));
    setRows(objs);
    try {
      setPreview(await api(`/qb/categories/${category.id}/import`, 'POST', { rows: objs, commit: false }));
    } catch (e) { toast(e.message); }
  };

  const commit = async () => {
    try {
      const res = await api(`/qb/categories/${category.id}/import`, 'POST', { rows, commit: true });
      toast(`Imported ${res.imported} question(s)${res.invalid ? `, skipped ${res.invalid} invalid row(s)` : ''}.`);
      onClose(true);
    } catch (e) { toast(e.message); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-ink/80 flex items-center justify-center p-6" onClick={() => onClose(false)}>
      <div className="bg-panel border border-line rounded-2xl p-5 w-full max-w-2xl max-h-[85vh] overflow-y-auto space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg">Import CSV → {category.name}</div>
        <div className="text-xs text-fog">
          Columns: <code className="font-mono">question,image_filename,answer_a,answer_b,answer_c,answer_d,correct_letter,base_points</code>.
          Header row optional. Image filenames must already exist in uploads (upload images first).
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="text-sm"
          onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
        {preview && (
          <>
            <div className="text-sm">
              <b className="text-tgreen">{preview.valid}</b> valid · <b className={preview.invalid ? 'text-tred' : 'text-fog'}>{preview.invalid}</b> with errors
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line divide-y divide-line text-sm">
              {preview.rows.map((r) => (
                <div key={r.row} className="px-3 py-2 flex gap-3">
                  <span className="text-fog num w-8 shrink-0">#{r.row}</span>
                  <span className="flex-1 truncate">{r.question || <i className="text-fog">no text</i>}</span>
                  {r.errors.length
                    ? <span className="text-tred text-xs">{r.errors.join('; ')}</span>
                    : <span className="text-tgreen text-xs">ok</span>}
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Btn onClick={() => onClose(false)}>Cancel</Btn>
              <Btn kind="primary" disabled={!preview.valid} onClick={commit}>
                Import {preview.valid} valid row(s)
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- main page ----------
export default function QuestionBanks() {
  const [toast, toastNode] = useToast();
  const [banks, setBanks] = useState([]);
  const [bankId, setBankId] = useState('trivia_twist');
  const [catId, setCatId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [stats, setStats] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | question object
  const [importing, setImporting] = useState(false);
  const [newCat, setNewCat] = useState('');

  const refreshBanks = () => api('/qb').then((d) => setBanks(d.banks)).catch((e) => toast(e.message));
  const refreshStats = () => api(`/qb/${bankId}/stats`).then(setStats).catch(() => {});
  const refreshQuestions = () => catId
    ? api(`/qb/categories/${catId}/questions`).then((d) => setQuestions(d.questions)).catch((e) => toast(e.message))
    : setQuestions([]);

  useEffect(() => { refreshBanks(); }, []);
  useEffect(() => { refreshStats(); setCatId(null); }, [bankId]);
  useEffect(() => { refreshQuestions(); setEditing(null); }, [catId]);

  const bank = banks.find((b) => b.id === bankId);
  const cat = bank?.categories.find((c) => c.id === catId);
  const refreshAll = () => { refreshBanks(); refreshStats(); refreshQuestions(); };

  const moveCat = async (i, dir) => {
    const ids = bank.categories.map((c) => c.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api(`/qb/${bankId}/categories/order`, 'POST', { ids }); refreshBanks(); } catch (e) { toast(e.message); }
  };

  const deleteCat = async (c) => {
    const msg = c.question_count > 0
      ? `"${c.name}" contains ${c.question_count} question(s). Delete the category and its questions?`
      : `Delete "${c.name}"?`;
    if (!confirm(msg)) return;
    try {
      await api(`/qb/categories/${c.id}?force=1`, 'DELETE');
      if (catId === c.id) setCatId(null);
      refreshAll();
    } catch (e) { toast(e.message); }
  };

  return (
    <div className="h-full flex">
      {/* left: banks + categories */}
      <div className="w-72 shrink-0 border-r border-line flex flex-col">
        <div className="p-3 grid grid-cols-2 gap-2 border-b border-line">
          {banks.map((b) => (
            <Btn key={b.id} kind={bankId === b.id ? 'primary' : 'default'} onClick={() => setBankId(b.id)}>
              {b.name}
            </Btn>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {bank?.categories.map((c, i) => (
            <div key={c.id}
              className={`rounded-lg border p-2 ${catId === c.id ? 'border-bone bg-panel' : 'border-line hover:border-fog'}`}>
              <button className="w-full text-left" onClick={() => setCatId(c.id)}>
                <span className="font-semibold text-sm" style={{ color: c.color || undefined }}>{c.name}</span>
                <span className="text-xs text-fog float-right num">{c.active_count}/{c.question_count}</span>
              </button>
              <div className="flex gap-1 mt-1">
                <button className="px-2 py-1 text-fog hover:text-bone text-xs" onClick={() => moveCat(i, -1)}>▲</button>
                <button className="px-2 py-1 text-fog hover:text-bone text-xs" onClick={() => moveCat(i, 1)}>▼</button>
                <button className="px-2 py-1 text-fog hover:text-bone text-xs" onClick={async () => {
                  const name = prompt('Rename category', c.name);
                  if (name && name.trim()) { await api(`/qb/categories/${c.id}`, 'PUT', { name: name.trim() }).catch((e) => toast(e.message)); refreshBanks(); }
                }}>rename</button>
                <span className="flex-1" />
                <button className="px-2 py-1 text-tred/70 hover:text-tred text-xs" onClick={() => deleteCat(c)}>delete</button>
              </div>
            </div>
          ))}
          <div className="flex gap-1">
            <input className={`${inputCls} !min-h-[40px] flex-1 text-sm`} placeholder="New category…" value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newCat.trim()) {
                  try { await api(`/qb/${bankId}/categories`, 'POST', { name: newCat.trim() }); setNewCat(''); refreshAll(); }
                  catch (err) { toast(err.message); }
                }
              }} />
          </div>
        </div>
        {/* bank stats */}
        {stats && (
          <div className="border-t border-line p-3 text-xs space-y-1">
            <div className="text-fog uppercase tracking-wider">Bank stats</div>
            <div><b className="num">{stats.total_active}</b> active / <span className="num">{stats.total}</span> total questions</div>
            {stats.warnings.map((w, i) => <div key={i} className="text-tyellow">⚠ {w}</div>)}
            <a className="text-fog underline" href={`/api/qb/${bankId}/export`} download>Export bank CSV</a>
          </div>
        )}
      </div>

      {/* right: questions in the selected category */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {!cat && <div className="text-fog">Pick a category on the left, or create one.</div>}
        {cat && (
          <>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-lg flex-1">{cat.name}</h2>
              <Btn onClick={() => setImporting(true)}>Import CSV</Btn>
              <Btn kind="primary" onClick={() => setEditing('new')}>+ New question</Btn>
            </div>
            {editing === 'new' && (
              <QuestionEditor categoryId={cat.id} toast={toast}
                onDone={(saved) => { setEditing(null); if (saved) refreshAll(); }} />
            )}
            {questions.map((q) => (
              editing && editing !== 'new' && editing.id === q.id
                ? <QuestionEditor key={q.id} question={q} categoryId={cat.id} toast={toast}
                    onDone={(saved) => { setEditing(null); if (saved) refreshAll(); }} />
                : (
                  <div key={q.id} className={`rounded-xl border border-line bg-panel p-3 flex gap-3 ${q.active ? '' : 'opacity-50'}`}>
                    {q.image && <img src={q.image} alt="" className="w-20 h-14 object-cover rounded-lg border border-line shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{q.text}</div>
                      <div className="text-xs text-fog mt-1">
                        {q.answers.map((a) => (
                          <span key={a.id} className={`mr-3 ${a.is_correct ? 'text-tgreen' : ''}`}>{a.letter}: {a.text}</span>
                        ))}
                      </div>
                      <div className="text-[10px] text-fog mt-1"><span className="num">{q.base_points}</span> pts{q.active ? '' : ' · inactive'}</div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <Btn kind="ghost" className="!min-h-[34px] !px-2 text-xs" onClick={() => setEditing(q)}>Edit</Btn>
                      <Btn kind="ghost" className="!min-h-[34px] !px-2 text-xs" onClick={async () => {
                        try { await api(`/qb/questions/${q.id}/duplicate`, 'POST'); refreshAll(); } catch (e) { toast(e.message); }
                      }}>Duplicate</Btn>
                      <Btn kind="ghost" className="!min-h-[34px] !px-2 text-xs text-tred" onClick={async () => {
                        if (!confirm('Delete this question?')) return;
                        try {
                          const r = await api(`/qb/questions/${q.id}`, 'DELETE');
                          if (r.soft_deleted) toast('Question was used in past games — deactivated instead of deleted.');
                          refreshAll();
                        } catch (e) { toast(e.message); }
                      }}>Delete</Btn>
                    </div>
                  </div>
                )
            ))}
          </>
        )}
      </div>

      {importing && cat && <ImportModal category={cat} toast={toast} onClose={(changed) => { setImporting(false); if (changed) refreshAll(); }} />}
      {toastNode}
    </div>
  );
}
