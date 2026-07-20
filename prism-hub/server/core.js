// core.js — minigame manifests, Node-RED outbound dispatcher, server timer.
const fs = require('fs');
const path = require('path');
const { getSetting, logNodeRed } = require('./db');

// ============================================================
// MINIGAME MANIFESTS — JSON files in /minigames, loaded at boot.
// Adding minigame #7–#20 later = drop a file in this folder.
// ============================================================
const MANIFEST_DIR = path.join(__dirname, '..', 'minigames');
const manifests = new Map();

function loadManifests() {
  manifests.clear();
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  for (const file of fs.readdirSync(MANIFEST_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, file), 'utf8'));
      if (m && m.id) manifests.set(m.id, m);
    } catch (err) {
      console.error(`[manifests] skipping ${file}: ${err.message}`);
    }
  }
  console.log(`[manifests] loaded ${manifests.size} minigame(s)`);
}

function saveManifest(m) {
  manifests.set(m.id, m);
  fs.writeFileSync(path.join(MANIFEST_DIR, `${m.id}.json`), JSON.stringify(m, null, 2));
}

function allManifests() {
  return [...manifests.values()].sort((a, b) => (a.round_number ?? 999) - (b.round_number ?? 999));
}

function getManifest(id) { return manifests.get(id) || null; }

// ============================================================
// NODE-RED OUTBOUND — fire-and-forget HTTP POSTs, 2s timeout.
// A Node-RED failure must NEVER block or crash the Hub, so every
// error path here ends in a log row, not a throw. Resolves true when
// the call got a 2xx/3xx — the mole system uses this for `delivered`.
// ============================================================
async function fireNodeRed(event, payload, urlOverride) {
  const base = getSetting('nodered_base_url').trim().replace(/\/$/, '');
  const url = (urlOverride && urlOverride.trim()) || (base ? `${base}/prism/${event}` : '');
  if (!url) {
    logNodeRed('out', event, null, payload, 'skipped (no URL configured)');
    return false;
  }
  const body = { event, ts: new Date().toISOString(), ...payload };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    logNodeRed('out', event, url, body, res.status);
    return res.status < 400;
  } catch (err) {
    logNodeRed('out', event, url, body, `error: ${err.name === 'AbortError' ? 'timeout (2s)' : err.message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// SERVER-AUTHORITATIVE TIMER — the only clock in the building.
// Broadcasts remaining ms ~10x/sec. Clients render, never count.
// ============================================================
function createTimer(onBroadcast, onExpire) {
  const t = { duration_ms: 0, remaining_ms: 0, running: false, expired: false, _lastTick: 0, _interval: null };

  function snapshot() {
    return { duration_ms: t.duration_ms, remaining_ms: Math.max(0, Math.round(t.remaining_ms)), running: t.running, expired: t.expired };
  }
  function broadcast() { onBroadcast(snapshot()); }

  function tick() {
    const now = Date.now();
    if (t.running) {
      t.remaining_ms -= now - t._lastTick;
      if (t.remaining_ms <= 0) {
        t.remaining_ms = 0;
        t.running = false;
        t.expired = true;
        stopLoop();
        broadcast();
        onExpire();
        return;
      }
    }
    t._lastTick = now;
    broadcast();
  }
  function startLoop() {
    if (!t._interval) { t._lastTick = Date.now(); t._interval = setInterval(tick, 100); }
  }
  function stopLoop() {
    if (t._interval) { clearInterval(t._interval); t._interval = null; }
  }

  return {
    snapshot,
    load(seconds) { // set a new duration without starting
      stopLoop();
      t.duration_ms = Math.max(0, seconds * 1000);
      t.remaining_ms = t.duration_ms;
      t.running = false; t.expired = false;
      broadcast();
    },
    start() {
      if (t.remaining_ms <= 0) t.remaining_ms = t.duration_ms;
      t.running = true; t.expired = false;
      startLoop(); broadcast();
    },
    pause() { t.running = false; stopLoop(); broadcast(); },
    reset() {
      stopLoop();
      t.remaining_ms = t.duration_ms; t.running = false; t.expired = false;
      broadcast();
    },
    add(seconds) {
      t.remaining_ms = Math.max(0, t.remaining_ms + seconds * 1000);
      if (t.remaining_ms > 0) t.expired = false;
      if (t.remaining_ms === 0 && t.running) { t.running = false; t.expired = true; stopLoop(); onExpire(); }
      broadcast();
    }
  };
}

loadManifests();
module.exports = { loadManifests, saveManifest, allManifests, getManifest, fireNodeRed, createTimer, MANIFEST_DIR };
