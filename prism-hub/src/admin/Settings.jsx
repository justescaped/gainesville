import React, { useEffect, useState } from 'react';
import { api, socket, Btn, Field, inputCls, useToast } from '../hub.jsx';

// Settings → Input: physical button mapping. The button box is a USB HID
// keyboard on the STAGE machine, so Learn/Test only see presses while a Stage
// page is open somewhere (any browser tab on /stage works).
function InputSection({ toast }) {
  const [map, setMap] = useState(null);
  const [recent, setRecent] = useState([]);
  const [learning, setLearning] = useState(null);

  const refresh = () => api('/input').then((d) => { setMap(d.map); setRecent(d.recent); setLearning(d.learn_arm); }).catch((e) => toast(e.message));
  useEffect(() => {
    refresh();
    const onCode = (c) => setRecent((r) => [c, ...r].slice(0, 10));
    const onLearned = (d) => { setMap(d.map); setLearning(null); toast(`${d.action} mapped to ${d.code}`); };
    socket.on('input_code', onCode);
    socket.on('input_learned', onLearned);
    return () => { socket.off('input_code', onCode); socket.off('input_learned', onLearned); };
  }, []);

  const learn = async (action) => {
    const next = learning === action ? null : action;
    try { await api('/input/learn', 'POST', { action: next }); setLearning(next); }
    catch (e) { toast(e.message); }
  };

  const setKey = async (action, code) => {
    const next = { ...map, [action]: code };
    try { await api('/input/map', 'PUT', { map: next }); setMap(next); } catch (e) { toast(e.message); }
  };

  if (!map) return null;
  const ACTIONS = ['A', 'B', 'C', 'D', 'PASS'];
  return (
    <div className="rounded-xl border border-line bg-panel p-4 space-y-4">
      <div>
        <div className="font-semibold">Input — physical buttons</div>
        <div className="text-xs text-fog mt-1">
          The button box plugs into the Stage machine and types keys. Map each action below, or tap <b>Learn</b> and
          press the physical button (a /stage page must be open on that machine).
        </div>
      </div>
      <div className="space-y-2">
        {ACTIONS.map((a) => (
          <div key={a} className="flex items-center gap-2">
            <span className="w-14 font-black">{a}</span>
            <input className={`${inputCls} !min-h-[40px] w-40 font-mono text-sm`} value={map[a] || ''}
              onChange={(e) => setKey(a, e.target.value)} />
            <Btn className="!min-h-[40px]" kind={learning === a ? 'primary' : 'default'} onClick={() => learn(a)}>
              {learning === a ? 'Press the button…' : 'Learn'}
            </Btn>
          </div>
        ))}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-fog mb-1">Test — last 10 received keycodes</div>
        {recent.length === 0
          ? <div className="text-fog text-sm">Nothing received yet. Press a button while /stage is open.</div>
          : (
            <ul className="rounded-lg border border-line divide-y divide-line text-sm font-mono">
              {recent.map((r, i) => (
                <li key={i} className="px-3 py-1.5 flex gap-3">
                  <span className="text-fog num">{new Date(r.ts).toLocaleTimeString()}</span>
                  <span className="flex-1">{r.code}</span>
                  <span className={r.action ? 'text-tgreen' : 'text-fog'}>{r.action || 'unmapped'}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

export default function Settings() {
  const [toast, toastNode] = useToast();
  const [s, setS] = useState(null);
  const set = (patch) => setS((cur) => ({ ...cur, ...patch }));

  useEffect(() => { api('/settings').then(setS).catch((e) => toast(e.message)); }, []);
  if (!s) return null;

  const save = async () => {
    try { await api('/settings', 'PUT', s); toast('Settings saved.'); }
    catch (e) { toast(e.message); }
  };

  return (
    <div className="h-full overflow-y-auto p-5 max-w-xl space-y-5">
      <h2 className="font-bold text-lg">Settings</h2>

      <div className="rounded-xl border border-line bg-panel p-4 space-y-4">
        <Field label="Admin PIN">
          <input className={inputCls} value={s.admin_pin} onChange={(e) => set({ admin_pin: e.target.value })} />
        </Field>
        <div className="text-xs text-fog -mt-2">Gates this admin surface. Applies next time the PIN screen loads.</div>
      </div>

      <div className="rounded-xl border border-line bg-panel p-4 space-y-4">
        <Field label="Inbound token">
          <input className={inputCls} value={s.inbound_token} onChange={(e) => set({ inbound_token: e.target.value })} />
        </Field>
        <div className="text-xs text-fog -mt-2">
          Node-RED and Pis must send this in the <code className="font-mono">X-Prism-Token</code> header on every inbound webhook.
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel p-4 space-y-4">
        <Field label="Node-RED base URL">
          <input className={inputCls} placeholder="http://nodered.local:1880" value={s.nodered_base_url} onChange={(e) => set({ nodered_base_url: e.target.value })} />
        </Field>
        <div className="text-xs text-fog -mt-2">
          Outbound events POST to <code className="font-mono">&lt;base&gt;/prism/&lt;event&gt;</code> unless a minigame overrides the URL. Leave blank to disable outbound calls.
        </div>
        <Field label="Manifest push URL">
          <input className={inputCls} placeholder="http://nodered.local:1880/prism/minigame-config" value={s.manifest_push_url} onChange={(e) => set({ manifest_push_url: e.target.value })} />
        </Field>
        <div className="text-xs text-fog -mt-2">
          When you save a minigame, its full config is POSTed here so Pi-hosted minigames can pick up rule changes. Leave blank to skip.
        </div>
        <Field label="Mole delivery URL">
          <input className={inputCls} placeholder="http://nodered.local:1880/prism/mole" value={s.mole_webhook_url} onChange={(e) => set({ mole_webhook_url: e.target.value })} />
        </Field>
        <div className="text-xs text-fog -mt-2">
          <code className="font-mono">mole.assigned</code> / <code className="font-mono">mole.resolved</code> events go here — usually a different
          device than everything else (bench screen, receipt printer, TTS). Blank = the base URL above.
        </div>
      </div>

      <Btn kind="primary" className="w-full" onClick={save}>Save settings</Btn>

      <InputSection toast={toast} />
      {toastNode}
    </div>
  );
}
