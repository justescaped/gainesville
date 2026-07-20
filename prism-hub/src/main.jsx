import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { HubProvider } from './hub.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <HubProvider>
      <App />
    </HubProvider>
  </BrowserRouter>
);
