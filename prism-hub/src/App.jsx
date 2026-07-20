import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AdminShell from './admin/AdminShell.jsx';
import Stage from './stage/Stage.jsx';
import Player from './player/Player.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/admin/*" element={<AdminShell />} />
      <Route path="/stage" element={<Stage />} />
      <Route path="/player" element={<Player />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
