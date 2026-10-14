import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ContainerSignInProvider } from './components/agents/containerSignIn.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      {/* The Agents tab's container sign-in (crew#1006): only seats crew marks `sign_in: 'container'`. */}
      <ContainerSignInProvider>
        <App />
      </ContainerSignInProvider>
    </ErrorBoundary>
  </StrictMode>,
);
