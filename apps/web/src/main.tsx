import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ClientQuote } from './screens/ClientQuote.tsx';
import './styles.css';

/**
 * /q/<id> is the link the pro texts to a client: same build, no nav, no
 * margin. Everything else is the pro's app.
 */
const publicQuoteId =
  /^\/q\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(window.location.pathname)?.[1] ??
  null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{publicQuoteId ? <ClientQuote id={publicQuoteId} /> : <App />}</StrictMode>
);
