// Vercel function entrypoint. Imports the compiled agent (built by `npm run
// build:all`) and hands it to Hono's Vercel adapter. The static web app is
// served by Vercel itself; this function only answers /api/* and /audio/*.
//
// Exported as named HTTP methods, not a default export: this is a Node.js
// *web handler*, so a default export would be read as the legacy
// `(req, res) => void` signature, whose return value Vercel discards — the
// request then hangs until the function times out.
import { handle } from 'hono/vercel';
import { app } from '../services/agent/dist/app.js';

const fetchHandler = handle(app);

export const GET = fetchHandler;
export const POST = fetchHandler;
export const PUT = fetchHandler;
export const PATCH = fetchHandler;
export const DELETE = fetchHandler;
export const OPTIONS = fetchHandler;
export const HEAD = fetchHandler;
