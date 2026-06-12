import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (dsn) {
  Sentry.init({ dsn });
}

const AppWithSentry = dsn ? Sentry.withErrorBoundary(App, { fallback: <p>Something went wrong.</p> }) : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWithSentry />
  </StrictMode>
);
