// quizapi.js — Phase 2 endpoints: question-bank authoring, quiz control,
// and physical-button input settings. Mounted at /api ahead of the Phase 1 API.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const router = express.Router();

const { db, getSetting, setSetting } = require('../db');
const { broadcastState } = require('../state');
const quizEngine = require('../quiz');

function handle(fn) {
  return (req, res) => {
    try {
      const out = fn(req);
      res.json(out === undefined ? { ok: true } : out);
    } catch (err) { res.status(400).json({ error: err.message }); }
  };
}

const qCount = db.prepare('SELECT COUNT(*) AS c FROM questions WHERE category_id = ?');
const qActiveCount = db.prepare('SELECT COUNT(*) AS c FROM questions WHERE category_id = ? AND active = 1');
const isReferenced = (qid) => !!db.prepare('SELECT 1 FROM question_results WHERE question_id = ? LIMIT 1').get(qid);

// ============================================================
// question banks
// ============================================================
router.get('/qb', handle(() => ({
  banks: db.prepare('SELECT * FROM question_banks ORDER BY id').all().map((b) => ({
    ...b,
    categories: db.prepare('SELECT * FROM categories WHERE bank_id = ? ORDER BY sort_order, name').all(b.id)
      .map((c) => ({ ...c, question_count: qCount.get(c.id).c, active_count: qActiveCount.get(c.id).c }))
  }))
})));

router.get('/qb/:bankId/stats', handle((req) => {
  const cats = db.prepare('SELECT * FROM categories WHERE bank_id = ? ORDER BY sort_order, name').all(req.params.bankId);
  const perCategory = cats.map((c) => ({ id: c.id, name: c.name, total: qCount.get(c.id).c, active: qActiveCount.get(c.id).c }));
  return {
    total: perCategory.reduce((s, c) => s + c.total, 0),
    total_active: perCategory.reduce((s, c) => s + c.active, 0),
    per_category: perCategory,
    // a game show run needs depth — any thin active category will run a game dry
    warnings: perCategory.filter((c) => c.active > 0 && c.active < 5)
      .map((c) => `"${c.name}" has only ${c.active} active question(s) — a game may run dry (5+ recommended).`)
  };
}));

// ---------- categories ----------
router.post('/qb/:bankId/categories', handle((req) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new Error('name is required');
  if (!db.prepare('SELECT 1 FROM question_banks WHERE id = ?').get(req.params.bankId)) throw new Error('unknown bank');
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories WHERE bank_id = ?').get(req.params.bankId).m;
  const id = randomUUID();
  db.prepare('INSERT INTO categories (id, bank_id, name, color, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.bankId, name, req.body.color || null, max + 1);
  return { id };
}));

router.put('/qb/categories/:id', handle((req) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) throw new Error('category not found');
  if (req.body.name !== undefined) db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(String(req.body.name), cat.id);
  if (req.body.color !== undefined) db.prepare('UPDATE categories SET color = ? WHERE id = ?').run(req.body.color || null, cat.id);
}));

router.post('/qb/:bankId/categories/order', handle((req) => {
  const upd = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ? AND bank_id = ?');
  (req.body.ids || []).forEach((id, i) => upd.run(i, id, req.params.bankId));
}));

// Deleting a category with questions requires force=1 (the UI confirms first).
// Questions referenced by past results are NEVER hard-deleted — they're
// deactivated and left in place (orphaned category id is fine: nothing joins
// them back into the UI, but old QuestionResults still resolve).
router.delete('/qb/categories/:id', handle((req) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) throw new Error('category not found');
  const count = qCount.get(cat.id).c;
  if (count > 0 && !req.query.force) throw new Error(`"${cat.name}" contains ${count} question(s) — confirm to delete`);
  const del = db.transaction(() => {
    for (const q of db.prepare('SELECT id FROM questions WHERE category_id = ?').all(cat.id)) {
      if (isReferenced(q.id)) {
        db.prepare('UPDATE questions SET active = 0 WHERE id = ?').run(q.id);
      } else {
        db.prepare('DELETE FROM answers WHERE question_id = ?').run(q.id);
        db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
      }
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
  });
  del();
}));

// ---------- questions ----------
function validateAnswers(answers) {
  if (!Array.isArray(answers) || answers.length < 2 || answers.length > 4) {
    throw new Error('a question needs 2 to 4 answers');
  }
  const correct = answers.filter((a) => a.is_correct).length;
  if (correct !== 1) throw new Error('exactly one answer must be marked correct');
  const letters = ['A', 'B', 'C', 'D'];
  answers.forEach((a, i) => {
    if (!String(a.text || '').trim()) throw new Error(`answer ${letters[i]} needs text`);
  });
}

function insertQuestion(categoryId, body) {
  validateAnswers(body.answers);
  const qid = randomUUID();
  db.prepare('INSERT INTO questions (id, category_id, text, image, base_points, active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(qid, categoryId, String(body.text || '').trim(), body.image || null,
      Math.trunc(Number(body.base_points)) || 100, body.active === false ? 0 : 1);
  const letters = ['A', 'B', 'C', 'D'];
  body.answers.forEach((a, i) =>
    db.prepare('INSERT INTO answers (id, question_id, letter, text, is_correct) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), qid, letters[i], String(a.text).trim(), a.is_correct ? 1 : 0));
  return qid;
}

router.get('/qb/categories/:id/questions', handle((req) => ({
  questions: db.prepare('SELECT * FROM questions WHERE category_id = ? ORDER BY created_at DESC').all(req.params.id)
    .map((q) => ({ ...q, answers: db.prepare('SELECT * FROM answers WHERE question_id = ? ORDER BY letter').all(q.id) }))
})));

router.post('/qb/categories/:id/questions', handle((req) => {
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(req.params.id)) throw new Error('unknown category');
  if (!String(req.body.text || '').trim()) throw new Error('question text is required');
  return { id: db.transaction(() => insertQuestion(req.params.id, req.body))() };
}));

router.put('/qb/questions/:id', handle((req) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) throw new Error('question not found');
  validateAnswers(req.body.answers);
  const letters = ['A', 'B', 'C', 'D'];
  db.transaction(() => {
    db.prepare('UPDATE questions SET text = ?, image = ?, base_points = ?, active = ? WHERE id = ?')
      .run(String(req.body.text || q.text).trim(), req.body.image ?? null,
        Math.trunc(Number(req.body.base_points)) || q.base_points, req.body.active === false ? 0 : 1, q.id);
    db.prepare('DELETE FROM answers WHERE question_id = ?').run(q.id);
    req.body.answers.forEach((a, i) =>
      db.prepare('INSERT INTO answers (id, question_id, letter, text, is_correct) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), q.id, letters[i], String(a.text).trim(), a.is_correct ? 1 : 0));
  })();
}));

router.delete('/qb/questions/:id', handle((req) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) throw new Error('question not found');
  if (isReferenced(q.id)) {
    db.prepare('UPDATE questions SET active = 0 WHERE id = ?').run(q.id);
    return { soft_deleted: true };
  }
  db.prepare('DELETE FROM answers WHERE question_id = ?').run(q.id);
  db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
  return { soft_deleted: false };
}));

router.post('/qb/questions/:id/duplicate', handle((req) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) throw new Error('question not found');
  const answers = db.prepare('SELECT * FROM answers WHERE question_id = ? ORDER BY letter').all(q.id);
  const id = db.transaction(() => insertQuestion(q.category_id, {
    text: q.text + ' (copy)', image: q.image, base_points: q.base_points, active: false,
    answers: answers.map((a) => ({ text: a.text, is_correct: !!a.is_correct }))
  }))();
  return { id };
}));

// ---------- CSV import / export ----------
// Import body: { rows: [{question,image_filename,answer_a..d,correct_letter,base_points}], commit }
// Validation is row-level; commit inserts only the valid rows and reports both counts.
router.post('/qb/categories/:id/import', handle((req) => {
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(req.params.id)) throw new Error('unknown category');
  const rows = req.body.rows || [];
  const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
  const results = rows.map((r, i) => {
    const errors = [];
    if (!String(r.question || '').trim()) errors.push('question text missing');
    const answers = ['a', 'b', 'c', 'd']
      .map((l) => String(r[`answer_${l}`] || '').trim())
      .filter((t) => t.length > 0);
    if (answers.length < 2) errors.push('needs at least 2 answers');
    const correct = String(r.correct_letter || '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(correct)) errors.push('correct_letter must be A–D');
    else if ('ABCD'.indexOf(correct) >= answers.length) errors.push(`correct_letter ${correct} has no answer text`);
    const points = Math.trunc(Number(r.base_points));
    if (r.base_points !== undefined && String(r.base_points).trim() !== '' && (!Number.isFinite(points) || points === 0)) errors.push('base_points must be a number');
    let image = null;
    if (String(r.image_filename || '').trim()) {
      const fname = path.basename(String(r.image_filename).trim());
      if (fs.existsSync(path.join(UPLOAD_DIR, fname))) image = `/uploads/${fname}`;
      else errors.push(`image "${fname}" not found in uploads — upload it first`);
    }
    return { row: i + 1, question: r.question, errors, _answers: answers, _correct: correct, _points: points || 100, _image: image };
  });

  const valid = results.filter((r) => r.errors.length === 0);
  if (req.body.commit) {
    db.transaction(() => {
      for (const r of valid) {
        insertQuestion(req.params.id, {
          text: r.question, image: r._image, base_points: r._points,
          answers: r._answers.map((t, i) => ({ text: t, is_correct: 'ABCD'[i] === r._correct }))
        });
      }
    })();
  }
  return {
    committed: !!req.body.commit,
    imported: req.body.commit ? valid.length : 0,
    valid: valid.length,
    invalid: results.length - valid.length,
    rows: results.map(({ row, question, errors }) => ({ row, question, errors }))
  };
}));

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

router.get('/qb/:bankId/export', (req, res) => {
  const rows = db.prepare(`
    SELECT c.name AS category, q.* FROM questions q JOIN categories c ON c.id = q.category_id
    WHERE c.bank_id = ? ORDER BY c.sort_order, q.created_at`).all(req.params.bankId);
  const lines = ['category,question,image_filename,answer_a,answer_b,answer_c,answer_d,correct_letter,base_points'];
  for (const q of rows) {
    const answers = db.prepare('SELECT * FROM answers WHERE question_id = ? ORDER BY letter').all(q.id);
    const byLetter = Object.fromEntries(answers.map((a) => [a.letter, a]));
    const correct = answers.find((a) => a.is_correct)?.letter || '';
    lines.push([
      q.category, q.text, q.image ? path.basename(q.image) : '',
      byLetter.A?.text || '', byLetter.B?.text || '', byLetter.C?.text || '', byLetter.D?.text || '',
      correct, q.base_points
    ].map(csvEscape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.bankId}.csv"`);
  res.send(lines.join('\n'));
});

// ============================================================
// quiz control (admin) — physical buttons enter via Socket.IO instead
// ============================================================
router.get('/quiz', handle(() => quizEngine.snapshot()));

// Admin on-screen A/B/C/D/PASS fallback — same pipeline as the hardware.
router.post('/quiz/input', handle((req) => {
  const b = String(req.body.button || '').toUpperCase();
  if (!['A', 'B', 'C', 'D', 'PASS'].includes(b)) throw new Error('button must be A, B, C, D or PASS');
  req.app.locals.input.pressAction(b);
}));

router.post('/quiz/pick', handle((req) => quizEngine.togglePick(req.body.category_id)));
router.post('/quiz/skip', handle(() => quizEngine.adminSkip()));
router.post('/quiz/advance_turn', handle(() => quizEngine.adminAdvanceTurn()));
router.post('/quiz/mole', handle((req) => quizEngine.adminSetMole(req.body.team_id ?? null)));

// ============================================================
// input settings (Settings → Input)
// ============================================================
router.get('/input', handle((req) => ({
  map: JSON.parse(getSetting('button_map') || '{}'),
  recent: req.app.locals.input.state.recent,
  learn_arm: req.app.locals.input.state.learnArm
})));

router.put('/input/map', handle((req) => {
  const map = req.body.map || {};
  for (const k of Object.keys(map)) {
    if (!['A', 'B', 'C', 'D', 'PASS'].includes(k)) throw new Error(`unknown action: ${k}`);
  }
  setSetting('button_map', JSON.stringify(map));
}));

// Arm learn mode: the next physical press on the Stage machine binds to `action`.
// Pass action: null to disarm.
router.post('/input/learn', handle((req) => {
  const a = req.body.action;
  if (a !== null && !['A', 'B', 'C', 'D', 'PASS'].includes(a)) throw new Error('action must be A, B, C, D, PASS or null');
  req.app.locals.input.state.learnArm = a;
  return { learn_arm: a };
}));

module.exports = router;
