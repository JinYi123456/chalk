// Vercel function entrypoint. Imports the compiled agent (built by `npm run
// build:all`) and hands it to Hono's Vercel adapter. The static web app is
// served by Vercel itself; this function only answers /api/* and /audio/*.
import { handle } from 'hono/vercel';
import { app } from '../services/agent/dist/app.js';

export const config = { maxDuration: 300 };

export default handle(app);
