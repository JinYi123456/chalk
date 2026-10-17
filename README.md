# Chalk

**The open-weight AI that quotes the job before you leave the driveway.**

A solo pro walks a job, photographs it, and talks through what they'd do. Chalk
turns that into an itemized, client-ready quote in about fifteen seconds — priced
in-context over *that pro's own past jobs* by a TabPFN tabular model, read off the
photos by open-weight vision, and written in their voice by an open-weight
language model. (Measured, and printed per quote: 11–25s warm without a photo,
~28s with one on a cold process — the attribution block shows the real split.)
Every layer says which model actually answered.

Built for the **Hacktoberfest Open-Source AI Challenge — Week 2: Side Hustle**
(`#hf26challenge`).

---

## The problem

Standing in a client's driveway, a solo cleaner or handyman faces two expensive
failures at once:

1. **Quote too slow → lose the job.** "I'll send you a number tonight" means the
   client has two other quotes by tonight.
2. **Quote too fast → lose the margin.** Pricing from gut memory while a client
   watches means the number is padded (and lost) or short (and worked at a loss).

Chalk removes the trade-off: the walkthrough *is* the quote.

## The loop

| Move | What happens | Open-weight model |
|---|---|---|
| **Walk** | Photos + the pro's own words (typed or dictated) | `Qwen3-VL-30B-A3B-Instruct` reads the site — surfaces, sizes, conditions |
| **Price** | Itemized scope → a fair price, an honest range, the odds this client says yes | `TabPFN-3.5` in-context over the pro's own 40+ past jobs (regression for the price, classification for the win odds) |
| **Send** | Client message in the pro's voice, private rationale, assumptions, validity window | `Qwen3-30B-A3B-Instruct-2507` (or Gemma 4 locally) |
| **Answer** | One link (`/q/<id>`) the pro texts: the itemised quote on the client's own phone, with *Accept* / *Not right now* | — (same record, client-safe face) |

The client's page carries the **evidence**: each walkthrough photo, captioned by the vision model
(`kitchen: dusty wooden floor, kitchen cabinets`), and a thumbnail beside every line item it
justifies — the scope attributes each task to the photo that shows it, and a photo index that
points at nothing is dropped rather than guessed. Photos are downscaled on the phone before
upload, stored with the quote, and **never** included in list responses: the pro's job list is
15 kB, the client's quote page is the only thing that loads them.

The link is the part that closes the loop. When the client taps **Accept**, the
quote comes back as a won job: win rate moves, the row joins the pro's history,
and TabPFN refits over it — so the odds on the *next* quote are built from real
answers, not from the pro's memory of them. The client never sees the odds, the
usual price, or the margin; only the pro's screen has those.

After that it keeps the promise: a durable Temporal workflow nudges about the
quote, Tiger Data records won/lost and margin over time, MongoDB becomes the
memory of every job quoted — so the next quote is smarter.

## Why open weights are the point

- **The economics only work open.** A per-image closed vision API turns a pro's
  busy season into a bill. Open-weight endpoints, or a laptop running Ollama,
  keep the marginal cost of a quote near zero.
- **The pro's margin history is the family silver.** It should be able to live
  where the pro does. `CHALK_PROVIDER=ollama` runs the whole thing locally.
- **Swappable by design.** Any OpenAI-compatible endpoint works — Ollama,
  llama.cpp, LM Studio, a hosted open-weight catalog — or a **Tinker**-fine-tuned
  quote voice (see `services/tinker`).
- **Honest degradation.** Sever any layer — vision, pricing, market lookup,
  memory, voice — and Chalk keeps working *and says so*, in the UI, per layer.

## Architecture

```
apps/web                    Vite + React PWA — Walk · Quote · Jobs · You
   │                        + the client's quote page at /q/<id> (public, no margin)
   │  /api/*  /audio/*
services/agent              Hono + Mastra (Node, type-stripped ESM)
   ├─ lib/vision.ts         photo → site read            (open-weight vision)
   ├─ lib/scope.ts          site + words → itemized scope (open-weight text)
   ├─ lib/pricing.ts        ← TabPFN cloud → local FastAPI → heuristic
   ├─ lib/quote-agent.ts    Mastra agent: prose + tools (market_rate, similar_jobs)
   ├─ lib/memory.ts         MongoDB Atlas job memory (+ $vectorSearch when set)
   ├─ lib/tiger.ts          Tiger Data / Postgres time-series for margin
   ├─ lib/temporal.ts       durable follow-up workflows (optional)
   ├─ lib/sentry.ts         one trace per compiled quote
   ├─ lib/tts.ts            ElevenLabs read-back
   └─ lib/tinker.ts         fine-tuned voice sampler (optional)
services/tabpfn             FastAPI — TabPFN pricing service (local weights)
services/tinker             Tinker fine-tune for the pro's quote voice
api/index.mjs               Vercel function entry (Hono adapter)
```

Every edge above is a **leaf**: sever it and the product still works, labelled.

## Quickstart

```bash
git clone <your-fork> chalk && cd chalk
npm install

cp .env.example .env      # every key is optional; fill in what you have
npm run build:all         # web build + agent build
npm start                 # agent on :8787, serving the built web app
```

Open <http://127.0.0.1:8787>. `SERVE_WEB=1` makes the agent host the PWA, so a
single process runs the whole demo.

Development, with hot reload on both sides:

```bash
npm run dev               # agent :8787 (tsx watch) + web :5183 (vite, proxies /api)
```

### The pricing model

The tabular model is the heart of Chalk and runs three ways, in order:

1. **Hosted TabPFN-3.5** (Prior Labs REST) — no torch needed. Set `TABPFN_TOKEN`.
   The pro's history is uploaded and fitted once per history revision, then both
   heads (price quantiles, win probabilities) predict in parallel. Warm at boot,
   de-duplicated so warm-up and the first quote never fit twice, and capped at a
   12-second wait: Prior Labs' predict latency swings from ~4s to over a minute,
   and a pro standing in a hallway gets the honest local answer instead of a
   spinner. The slow call keeps running and prices the *next* quote.
2. **Local TabPFN service** — `services/tabpfn` (FastAPI). Real weights on CPU:
   ```bash
   uv run --project services/tabpfn python services/tabpfn/app/main.py   # :8790
   ```
   Set `TABPFN_URL=http://127.0.0.1:8790`.
3. **Transparent heuristic** — distance-weighted over the same rows, clearly
   labelled `heuristic` in the UI. Never silent.

### Environment

Everything is optional and the app reports the ones it is missing
(`/api/health`). See [.env.example](.env.example) for the full list. The useful ones:

| Variable | Purpose |
|---|---|
| `CHALK_PROVIDER` | `ollama` \| `google` \| `featherless` \| `nebius` \| `openrouter` \| `custom` |
| `CHALK_MODEL`, `CHALK_VISION_MODEL` | model ids for text and images |
| `*_API_KEY` | endpoint credentials (any subset) |
| `TABPFN_TOKEN` | Prior Labs hosted TabPFN-3.5 |
| `MONGODB_URI` | job memory (falls back to in-process) |
| `TIGER_URL` | margin time-series (Postgres) |
| `ELEVENLABS_API_KEY` | hands-free read-back |
| `SERPAPI_KEY` | live market benchmark |
| `SENTRY_DSN` | agent traces |
| `TEMPORAL_ADDRESS` | durable follow-ups |

## Deploy

The demo target is **Vercel**: no function timeout to fight, and the whole app
is one deployable. See [docs/DEPLOY.md](docs/DEPLOY.md).

```bash
vercel                       # preview
vercel --prod                # production
```

`vercel.json` sets `maxDuration: 300` for the API function (Fluid compute), the
build, and the SPA rewrites. Node functions must be Node 22+.

## Tests

```bash
npm test                     # agent: 38 specs (pricing, vision, partners, util)
npm run test:py              # tabpfn service: FastAPI + service logic
```

Tests run hermetic: they force offline mode so no API key or database is needed.

## Honest by construction

| Layer | If it is missing | What the UI says |
|---|---|---|
| Vision | no photos, or no vision model reachable | `words only — no photos` / `photos unreadable` |
| Scope | no text model reachable | `deterministic estimate (no model reachable)` |
| Pricing | no TabPFN anywhere | `heuristic` + the weighting it used |
| Market | no SerpApi key | benchmark card simply absent |
| Memory | no MongoDB | in-process store, count shown |
| Range | model interval wider than the pro's own ledger | clipped to the ledger, never below half the price |
| Win-odds ladder | classifier sees no usable price signal at this ledger size | drawn shape, and the card says so — never a flat line sold as a model answer |
| Voice | no ElevenLabs / Tinker | button disabled, plan still listed |
| Follow-ups | no Temporal | `Follow-ups are off on this build` |

`/api/health` returns the whole live picture, and the header always names the
model that answered last.

## Repo map

```
apps/web/            PWA (React 18, no UI framework — plain CSS, mobile-first)
services/agent/      Hono API + agent logic + tests
services/tabpfn/     FastAPI TabPFN pricing service
services/tinker/     Tinker fine-tune for the quote voice
docs/                deploy guide, demo script
submission/          the challenge article
api/                 Vercel function entry
DESIGN.md            the design and build document
```

## Licence

MIT for everything in this repo — see [LICENSE](LICENSE). Three things the words around it matter for:

- **The local TabPFN-3.5 weights are non-commercial** under Prior Labs' own licence; the **hosted
  API is a separate product** with its own terms. Chalk treats the hosted path as the default and
  the local service as the offline fallback, so nothing here assumes a commercial right to the weights.
- **Qwen, Gemma and their hosted endpoints** each carry their own licences (Gemma under the Gemma
  terms, Qwen under Apache-2.0 for the sizes used here).
- **Client photos are personal data.** A quote stores the photos the pro took of someone's home, so a
  real deployment needs a retention and deletion story. Today: they live with the quote in the
  configured store and can be dropped by deleting the quote.
