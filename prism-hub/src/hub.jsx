// hub.jsx — the one socket connection every surface shares, plus small UI atoms.
// The server pushes 'state' (everything) and 'timer' (10Hz while running).
// No surface ever computes time or totals locally.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const HubCtx = createContext(null);

// One shared socket for the whole app. Exported so pages that need raw events
// (Stage button forwarding, Settings → Input test panel) can subscribe directly.
export const socket = io();

export function HubProvider({ children }) {
  const [state, setState] = useState(null);
  const [timer, setTimer] = useState({ duration_ms: 0, remaining_ms: 0, running: false, expired: false });
  const [quiz, setQuiz] = useState({ active: false });
  const [banner, setBanner] = useState(null);
  const [connected, setConnected] = useState(false);
  const bannerTimeout = useRef(null);

  useEffect(() => {
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', setState);
    socket.on('timer', setTimer);
    socket.on('quiz', setQuiz);
    socket.on('banner', (b) => {
      setBanner(b);
      clearTimeout(bannerTimeout.current);
      bannerTimeout.current = setTimeout(() => setBanner(null), (b.duration || 8) * 1000);
    });
    return () => { socket.off('state'); socket.off('timer'); socket.off('quiz'); socket.off('banner'); };
  }, []);

  return <HubCtx.Provider value={{ state, timer, quiz, banner, connected }}>{children}</HubCtx.Provider>;
}

export const useHub = () => useContext(HubCtx);

export async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- team color helpers ----------
export const TEAM_HEX = { red: '#FF3B3B', blue: '#2E86FF', green: '#21D07A', yellow: '#FFC61A', solo: '#E8E8E6', none: '#3A3A3F' };
export const teamHex = (color) => TEAM_HEX[color] || '#8A8A90';

export function fmtTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- shared UI atoms (tablet-first: everything is a big target) ----------
export function Btn({ children, onClick, kind = 'default', className = '', disabled, title }) {
  const kinds = {
    default: 'bg-panel border border-line hover:border-fog active:bg-line',
    primary: 'bg-bone text-ink font-semibold hover:bg-white active:bg-fog',
    danger: 'bg-panel border border-tred/60 text-tred hover:bg-tred/10 active:bg-tred/20',
    ghost: 'bg-transparent border border-transparent hover:border-line active:bg-panel'
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[44px] px-4 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-bone ${kinds[kind]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-fog mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputCls = 'w-full min-h-[44px] bg-ink border border-line rounded-lg px-3 text-bone focus:outline-none focus:border-fog';

export function ColorDot({ color, size = 14 }) {
  return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: teamHex(color) }} />;
}

// Simple toast for API errors so touch users get feedback.
export function useToast() {
  const [msg, setMsg] = useState(null);
  const t = useRef(null);
  const show = (m) => { setMsg(String(m)); clearTimeout(t.current); t.current = setTimeout(() => setMsg(null), 3500); };
  const node = msg ? (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-tred/90 text-white px-4 py-3 rounded-lg text-sm shadow-lg">{msg}</div>
  ) : null;
  return [show, node];
}
