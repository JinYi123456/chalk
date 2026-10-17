# Chalk — an open-weight AI that quotes the job before you leave the driveway

> A solo pro walks a job, snaps a few photos, and talks through what they see.
> Chalk turns that into a priced, itemized quote in about fifteen seconds —
> priced by a model fitted on *that pro's own past jobs*, and able to run
> entirely on their own machine.

This is the design and build document. It is written for a reader who has never
seen the project. Everything here is intended to be true of the shipped app.

---

## 1. The problem

A solo home-service pro — a cleaner, a handyman, a mover, a detailer, a mobile
lawn guy — lives and dies by the quote. Two of the most expensive failures in
that business happen at the same moment, standing in a client's driveway:

1. **The slow quote loses the job.** The pro says "I'll send you a number
   tonight." By tonight the client has two other quotes. Speed wins.
2. **The fast quote loses the margin.** Quoting from gut memory on the spot
   means the price is either padded (and lost) or short (and worked at a loss).
   The pro *knows* their numbers, but not while a client is watching.

Generic AI helpers don't fix this. Writing a quote still means leaving the site,
remembering the scope, and guessing. And the tools that *could* reason about it —
a cloud LLM with your whole job history — are the one thing a trade business
should never hand over: **their margins are the most valuable data they own.**

## 2. What Chalk is

Chalk is a phone-first app with three moves:

| Move | What happens |
|---|---|
| **Walk** | Photograph what you see, talk through the job (or type it). Photos are read by an open-weight vision model; the words are yours. |
| **Price** | A **TabPFN** tabular model reads *your own history* — 40+ past jobs, your rates per task type, your win rate at each price band — and returns a fair price, a range, and the probability this client says yes. |
| **Send** | An open-weight **Gemma**/**Qwen** writes a client-ready, itemized quote in your voice, with assumptions, a validity window, and a follow-up plan. |
| **Answer** | One link (`/q/<id>`) the pro texts. The client opens the itemised quote on their own phone and taps **Accept** or **Not right now**. |

The link is what closes the loop. It is the same stored record rendered through a
client-safe face: work, price, assumptions, validity, **and the walkthrough
photos as evidence** — the vision model's caption on each, and a thumbnail beside
every line item it justifies. Never the win odds, the pro's usual price or their
margin. The answer comes back as a won or lost job, which is what feeds the next
refit.

The evidence is why the quote is an argument rather than a number. Photos are
downscaled on the phone before upload (a 5 MB shot becomes ~120 KB, which also
shortens the vision call), stored with the quote, and excluded from every list
response so the pro's job list stays about 15 kB. A photo index that points at a
picture the pro never took is dropped, never guessed — a wrong photo beside a
line item is worse than none. The one consequence worth naming: a quote holds
photographs of somebody's home, so a real deployment needs a retention and
deletion story, and the README says so.

Then Chalk keeps the promise: a durable **Temporal** workflow nudges you about
the quote, a **Tiger Data** time-series records won/lost, and **MongoDB** becomes
the memory of every job you've ever quoted — so the next quote is smarter.

### The open-weight argument (the whole point)

- **Privacy that is architectural, not promised.** Client photos, notes, and
  your entire pricing history stay on the device. There is no server that could
  leak them, because the model runs where the data already is.
- **The economics only work open.** A closed vision API that charges per image
  turns a pro's busy season into a bill. Chalk's marginal cost per quote is
  **$0** — run Gemma on the laptop, or on any open-weight endpoint.
- **Your model, swappable.** Ollama today, Qwen tomorrow, a **Tinker**-fine-tuned
  quote-voice next week. Nothing in the stack locks the business to a vendor.
- **Honest degradation.** Pull any plug — model, pricing service, market lookup —
  and Chalk keeps working, labelled. It never silently guesses.

## 3. Who pays for it, and why

Solo field-service pros already pay for this category: **Jobber, Housecall Pro,
Thumbtack**. They pay for lead flow and for admin. What none of them do is
*price a job on-site from your own track record, privately*. Chalk's pitch to
that pro is one line:

> *"You just sent a priced quote before the other guy finished his walkthrough —
> and it was priced off the jobs you've already won."*

Viability signals Chalk is built to make visible:

- a **win-probability** on every quote (so the pro can see when they're priced
  out of a job before they send it),
- an **undercharging warning** when a quote sits below what the pro's own
  history says they charge for that work,
- a **margin log** (Tiger Data) that turns "did I make money this month?" into
  a chart instead of a feeling.

## 4. UX — the walkthrough is the interface

Design principles: **one thumb, outdoors, gloves on, sun on the screen.**

- **Walk screen** is a big shutter and a hold-to-talk button. Two actions. No
  forms before the job is captured.
- **The quote reads like a receipt, not a paragraph.** Line items a client can
  skim, a total, a range, and — for the pro only — the *private* numbers
  (win probability, your usual rate, the market benchmark) on a separate,
  clearly-marked side of the card.
- **Colour carries meaning**: chalk-white on slate for the pro's private
  view, a warm paper card for the client-facing quote.
- **Nothing sends itself.** Every quote is reviewed before it goes out — and the
  thing that goes out is a link the pro chose to share, never an automatic
  message. The client's page is a route in the same app (`/q/<id>`), not a
  second product, so there is exactly one version of the truth.

## 5. Architecture

```
apps/web                 Vite + React PWA — walk · quote · job · profile
   │  /api/*
services/agent           Hono + Mastra — scope extraction · quote writing ·
   │                     market lookups · memory · voice · follow-ups
   ├─► Prior Labs        hosted TabPFN-3.5 (REST) — the pricing model,
   │                     fitted in-context over the pro's own history
   ├─► services/tabpfn   FastAPI — the same model on local weights (CPU)
   ├─► Temporal worker   durable quote follow-up workflow
   ├─► MongoDB Atlas     job memory (+ $vectorSearch when configured)
   ├─► Tiger Data        won/lost + margin time-series (pgvector-ready)
   ├─► ElevenLabs        quote read-back / hands-free voice notes
   ├─► SerpApi           local market rate benchmark
   ├─► Sentry            agent traces (one trace per compiled quote)
   └─► Tinker            fine-tuned quote-voice sampler (optional)
```

Every edge is a **leaf**: sever it and the product still works, labelled.

Deployment is a single Vercel project — a Node function for `/api/*` and the
built PWA beside it. With Fluid compute the function may run for 300 seconds on
the free plan; a warm quote takes about **15 seconds** (vision ~0.1–4.8s, scope
~2.4–7s, TabPFN ~4.4s, prose ~3.4–4.5s), and the UI prints that breakdown per
quote so the number is never taken on trust.

Two latency rules make that hold up on a bad day. The hosted TabPFN call gets a
**bounded 12-second wait** — its predict latency swings from ~4s to over a
minute, and beyond 12s the local layer answers (labelled) while the slow call
finishes and prices the *next* quote from cache. And the boot warm-up and the
first quote share a single fit promise, so the history is uploaded and fitted
once. See `docs/DEPLOY.md`.

## 6. Judging-criteria map

| Criterion | Where Chalk answers it |
|---|---|
| **Design & UX** | The walkthrough-as-interface; the receipt-shaped quote; two faces of one record — the pro's desk and the client link at `/q/<id>` |
| **Functionality & Execution** | Real end-to-end loop on real models; tests as contract; honest fallbacks |
| **Innovation & Creativity** | On-site pricing from the pro's *own* history with a tabular foundation model, and a win-probability curve that turns a price into a decision — asked of the classifier per price and refused when it does not slope |
| **Impact & Viability** | Speed wins jobs, the pricing model protects margin, the margin log proves it |
| **The Pitch** | "Quote the job before you leave the driveway — priced off the work you've already won." |

## 7. What Chalk deliberately is *not*

- Not a CRM, not a scheduler, not a payments product. It does one job: **the
  quote** — because that is the moment money is won or lost.
- Not a replacement for the pro's judgement. Chalk proposes; the pro decides.
  Every number ships with the reasoning that produced it.
- Not a black box. Each layer reports which engine answered (`model`,
  `precomputed`, `heuristic`) so a pro can trust it more over time, not less.
