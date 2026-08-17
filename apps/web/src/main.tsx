import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@nexus/ui/tokens.css';
import './styles/app.css';
import { TRPCProvider } from './lib/trpc';
import { AppRoutes } from './app/router';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <TRPCProvider>
      <AppRoutes />
    </TRPCProvider>
  </StrictMode>,
);
