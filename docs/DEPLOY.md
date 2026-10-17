# Deploying Chalk

Chalk's demo target is **Vercel**, on purpose:

- **No timeout to fight.** With Fluid compute, Hobby functions may run for
  **300 seconds** (default *and* maximum); Pro goes to 800s, with an extended
  beta maximum of 1800s. A Chalk quote — vision, scope, TabPFN pricing, prose —
  finishes in **~15s warm**, so there is a 20× margin even on the free plan.
  ([Vercel: function duration](https://vercel.com/docs/functions/configuring-functions/duration),
  [functions limits](https://vercel.com/docs/functions/limitations))
- **One deployable.** The API function plus the built PWA, one URL, no second
  service to keep awake.
- **No cold-start tax after the first request.** The TabPFN fit is warmed on the
  first boot (see `services/agent/src/index.ts`), and quotes are cached, so a
  repeat demo is instant.

## 1. Push the repo

```bash
git init            # the repo you create on GitHub
git add .
git commit -m "Chalk"
git remote add origin git@github.com:<you>/chalk.git
git push -u origin main
```

## 2. Import to Vercel

Vercel reads [`vercel.json`](../vercel.json) automatically:

| Setting | Value | Why |
|---|---|---|
| Install | `npm install` | workspaces |
| Build | `npm run build:all` | web build + agent build |
| Output | `apps/web/dist` | static PWA |
| Function | `api/index.mjs` (`maxDuration: 300`) | Hono adapter over the built agent |
| Rewrites | `/api/*` → `/api`, `/audio/*` → `/api`, `*` → `/index.html` | one function, SPA fallback |

Or from the CLI:

```bash
npm i -g vercel
vercel                 # preview deployment
vercel --prod          # production
```

Node **22+** is required (declared in `engines`); set `NODE_VERSION=22` in the
Vercel project settings if the dashboard keeps an older default.

## 3. Environment variables

Nothing here is required for the app to boot — every layer degrades and says so.
Set what you have, in **Project → Settings → Environment Variables**, for both
Preview and Production.

| Variable | Value | Unlocks |
|---|---|---|
| `CHALK_PROVIDER` | `featherless` (or `ollama`, `google`, `nebius`, `openrouter`, `custom`) | which endpoint answers first |
| `CHALK_MODEL` | `Qwen/Qwen3-30B-A3B-Instruct-2507` | scope + quote prose |
| `CHALK_VISION_MODEL` | `Qwen/Qwen3-VL-30B-A3B-Instruct` | reading photos |
| `FEATHERLESS_API_KEY` | `…` | the above two models |
| `GOOGLE_API_KEY` | `…` | Gemma 4 fallback (free tier) |
| `NEBIUS_API_KEY` | `…` | third endpoint + Gemma 3 27B vision |
| `TABPFN_TOKEN` | `…` | **hosted TabPFN-3.5** — the pricing model |
| `MONGODB_URI`, `MONGODB_DB` | `…`, `chalk` | job memory across deploys |
| `TIGER_URL` | `postgres://…` | margin time-series |
| `ELEVENLABS_API_KEY` | `…` | read-back voice |
| `SERPAPI_KEY` | `…` | live market benchmark |
| `SENTRY_DSN` | `…` | traces |
| `TEMPORAL_ADDRESS` | `…` | durable follow-ups (needs a worker somewhere) |

**Do not set `SERVE_WEB` or `PORT` on Vercel.** `SERVE_WEB=1` tells the agent to
host the built PWA from its own process, which is right for the single-process local
demo and wrong here: the platform serves `apps/web/dist` itself. Leave both unset so
the function only answers `/api/*`.

### Adding them without pasting secrets anywhere

The CLI reads the values straight out of your local `.env` — no value is ever echoed,
logged, or typed into a chat:

```bash
while IFS= read -r line; do
  case "$line" in \#*|'') continue;; esac
  name="${line%%=*}"; value="${line#*=}"
  case "$name" in SERVE_WEB|PORT) continue;; esac
  [ -n "$value" ] || continue
  printf '%s' "$value" | vercel env add "$name" production >/dev/null && echo "set $name"
done < .env
```

Repeat with `preview` in place of `production` if you want the same keys on preview
deployments. Afterwards, `vercel env ls` shows **names only** — check that list rather
than any value.
| `PUBLIC_BASE_URL` | `https://your-app.vercel.app` | lets follow-up workflows call back |

Notes:

- **Do not** commit `.env`. It is gitignored; `.env.example` is the template.
- `SERVE_WEB` is only for local/self-hosted runs — on Vercel the platform serves
  `apps/web/dist` itself, and `VERCEL_PROJECT_PRODUCTION_URL` supplies the public
  URL automatically.
- The TabPFN fit lives in the function's memory and in a small in-process cache.
  A cold start re-uploads and re-fits the pro's history once (~4s), then every
  quote on that instance is warm.

## 4. Verify a deployment

```bash
curl -s https://<your-app>.vercel.app/api/health
```

Expect `tabpfnCloud: true`, a `model`, a `visionModel`, and `storage`. Then open
the URL, walk a job with a photo and some words, and read the attribution block
under **How Chalk read this job** — it names the vision model, the pricing path
(`model · TabPFN-3.5 …`) and the writing model, with per-stage timings.

## 5. Other hosts

Nothing in the code assumes Vercel.

- **Any Node host (Fly, Railway, Render, a VPS).** `npm run build:all && npm start`
  with `SERVE_WEB=1` — the agent serves the built PWA itself. One process.
- **The local TabPFN service**, if you would rather run real weights than call the
  hosted API: deploy `services/tabpfn` (Python 3.11+, `requirements.txt`, or
  `requirements-model.txt` for the full model) and point `TABPFN_URL` at it.
  Chalk tries it automatically after the hosted API.
- **Temporal.** `npm run temporal:worker` anywhere the worker can reach both the
  Temporal cluster and `PUBLIC_BASE_URL`. Without it, follow-ups are described,
  not scheduled — and the UI says exactly that.

## 6. Costs

For a demo: Vercel Hobby is free, TabPFN's hosted API is pay-per-use with a free
allowance, and the open-weight endpoints used here have free tiers. The
heuristic pricing path and `CHALK_PROVIDER=ollama` cost nothing at all.
