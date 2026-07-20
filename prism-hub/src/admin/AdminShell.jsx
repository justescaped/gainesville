import React, { useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useHub, api, Btn, inputCls } from '../hub.jsx';
import Live from './Live.jsx';
import Minigames from './Minigames.jsx';
import QuestionBanks from './QuestionBanks.jsx';
import MoleObjectives from './MoleObjectives.jsx';
import GridPuzzles from './GridPuzzles.jsx';
import History from './History.jsx';
import Territories from './Territories.jsx';
import Powerups from './Powerups.jsx';
import Teams from './Teams.jsx';
import Ledger from './Ledger.jsx';
import NodeRed from './NodeRed.jsx';
import Settings from './Settings.jsx';

const NAV = [
  ['', 'Live'],
  ['minigames', 'Minigames'],
  ['questions', 'Question Banks'],
  ['mole', 'Mole Objectives'],
  ['territories', 'Territories'],
  ['powerups', 'Power-ups'],
  ['teams', 'Teams'],
  ['ledger', 'Ledger'],
  ['history', 'History'],
  ['nodered', 'Node-RED'],
  ['settings', 'Settings']
];

function PinGate({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(null);
  const submit = async () => {
    try {
      await api('/auth', 'POST', { pin });
      sessionStorage.setItem('prism_admin', '1');
      onUnlock();
    } catch (e) { setErr(e.message); setPin(''); }
  };
  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-72 space-y-4 text-center">
        <div className="text-2xl font-bold tracking-widest">PRISM DILEMMA</div>
        <div className="text-fog text-sm">Enter the admin PIN</div>
        <input
          type="password" inputMode="numeric" autoFocus value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className={`${inputCls} text-center text-2xl tracking-[0.5em]`}
        />
        {err && <div className="text-tred text-sm">{err}</div>}
        <Btn kind="primary" className="w-full" onClick={submit}>Unlock</Btn>
      </div>
    </div>
  );
}

export default function AdminShell() {
  const { connected } = useHub();
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('prism_admin') === '1');
  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;

  return (
    <div className="h-full flex">
      <nav className="w-40 shrink-0 border-r border-line flex flex-col">
        <div className="px-4 py-4 border-b border-line">
          <div className="font-bold leading-tight">PRISM<br />DILEMMA</div>
          <div className={`mt-1 text-[10px] uppercase tracking-wider ${connected ? 'text-tgreen' : 'text-tred'}`}>
            {connected ? '● live' : '● offline'}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {NAV.map(([path, label]) => (
            <NavLink
              key={label} to={`/admin/${path}`} end={path === ''}
              className={({ isActive }) =>
                `block px-4 py-3 text-sm border-l-2 ${isActive ? 'border-bone text-bone bg-panel' : 'border-transparent text-fog hover:text-bone'}`}
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="flex-1 min-w-0 overflow-hidden">
        <Routes>
          <Route index element={<Live />} />
          <Route path="minigames" element={<Minigames />} />
          <Route path="questions" element={<QuestionBanks />} />
          <Route path="mole" element={<MoleObjectives />} />
          <Route path="grid-puzzles" element={<GridPuzzles />} />
          <Route path="history" element={<History />} />
          <Route path="territories" element={<Territories />} />
          <Route path="powerups" element={<Powerups />} />
          <Route path="teams" element={<Teams />} />
          <Route path="ledger" element={<Ledger />} />
          <Route path="nodered" element={<NodeRed />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
