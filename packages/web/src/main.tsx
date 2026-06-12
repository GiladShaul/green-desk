import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';

function scrubToken(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('token');
    return u.toString();
  } catch {
    return url;
  }
}

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (dsn) {
  Sentry.init({
    dsn,
    beforeSend(event) {
      if (event.request?.url) event.request.url = scrubToken(event.request.url);
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'navigation' && breadcrumb.data) {
        if (breadcrumb.data.to) breadcrumb.data.to = scrubToken(breadcrumb.data.to);
        if (breadcrumb.data.from) breadcrumb.data.from = scrubToken(breadcrumb.data.from);
      }
      return breadcrumb;
    },
  });
}

const AppWithSentry = dsn ? Sentry.withErrorBoundary(App, { fallback: <p>Something went wrong.</p> }) : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWithSentry />
  </StrictMode>
);
