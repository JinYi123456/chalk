import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ClientQuote } from './screens/ClientQuote.tsx';
import { Try } from './screens/Try.tsx';
import './styles.css';

const QUOTE_ID = /^\/q\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/**
 * /q/<id> is the link the pro texts to a client: same build, no nav, no
 * margin. /try is the public page that asks whether anyone would pay.
 * Everything else is the pro's app.
 */
const path = window.location.pathname;
const publicQuoteId = QUOTE_ID.exec(path)?.[1] ?? null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{publicQuoteId ? <ClientQuote id={publicQuoteId} /> : path === '/try' ? <Try /> : <App />}</StrictMode>
);
