# Chalk — demo script (about 90 seconds)

Everything below has been run end to end on the deployed build. The numbers in
brackets are what the current demo data actually produced, most recently on
2026-10-18 against `https://chalk-nine-flax.vercel.app`.

## Before you hit record

1. `npm run build:all && npm start`, or open the deployed URL.
2. **Warm it once.** The first quote in a cold process pays for the TabPFN fit,
   and it now waits up to 45 seconds for that first call instead of quietly
   falling back. Run one throwaway quote before you record so the take you keep
   is the warm one.
3. Have **two photos of two different rooms** ready — a kitchen and an oven, a
   lounge and a stair. Two rooms is the better demo: it shows each line item
   pointing at the right picture, and one picture proves nothing about
   attribution.
4. Keep one screen on **Walk** and one on **Jobs** so the history is visible.
5. **Put yourself in the client's seat.** Keep a second device or window ready —
   the last stop of the demo is *their* phone. A phone can only open the link if
   the app is reachable from it: use the deployed URL or the laptop's LAN
   address, not `localhost:8787`.
6. Record the wall clock. If the quote takes 31 seconds, the video says 31.
   Do not cut the wait — the wait is the product's claim.

## The 90 seconds

**0:00 — the promise.** Standing in the driveway, thumb on the screen:

> "A cleaner prices a job in the driveway, or they lose it. Watch what happens
> before I get back to the van."

**0:05 — Walk screen.** Snap the photos. Hold to talk, or type:

> "End of lease, two-bed. Kitchen hob and the oven have not been degreased in
> years. Landlord inspects Friday, they want the deposit back."

**0:20 — Price this job.** Let the step ticker run; it names the models as they
come back. *Do not narrate over it.*

> "Photos are read by an open-weight vision model, the scope by an open-weight
> text model, and the price by TabPFN, in context over this pro's own last 46
> jobs." *(measured on the deployed build, two photos: 22.1s end to end — eyes
> 2.8s, scope 3.7s, price 11.3s, words 4.3s. The attribution block prints
> exactly this split under every quote, so the number is checkable on screen.)*

**0:45 — the quote.** Scroll the receipt:

> "Every line is hours and complexity — the oven is 5 out of 5. Total $302, fair
> range $264 to $344. And look where each line's picture is."

**0:55 — the pro's side of the desk.** Point at three numbers:

> "67% odds they say yes. My usual price for this work, from my own history —
> $382. And a market check from live listings." — then the band: *"At $257 I win
> it 9 times in 10. At $368 it's a third. That's the decision made visible."*

If the ladder is the drawn one, **say so on camera** — the card already does:

> "That shape is drawn through a single estimate, not five classifier answers.
> Over the forty-odd jobs in her ledger the win/lose signal is too noisy to see a price effect, so the
> app refuses to show you a model answer it does not have."

**1:05 — the undercharge warning.** It fires on this walkthrough:

> "I'm quoting $80 under what I actually charge for this size of job. It tells me
> that before the client sees it."

**1:10 — send it.** Tap **Copy link** in the *Send it* card:

> "One link. She sees the work, the price, what I assumed — and never my odds, my
> usual price, or my margin. That page is the whole reason this isn't a
> calculator."

**1:20 — her phone.** Open the link on the second device. Do **not** scroll past
the evidence strip:

> "Here's the pitch she actually reads: the photos I took on the walk, what the
> vision model saw in each one — `kitchen: greasy hob, tiled splashback`,
> `oven: heavily burnt interior, open door` — and every line item sitting next to
> the picture that justifies it."

Then tap **Accept this quote**:

> "She's just told me yes — and she's just taught the model something."

**1:30 — back on your phone.** The Jobs list says **WON**, the win rate moved,
and that row is now part of the history TabPFN fits over:

> "The next quote gets priced over this answered job."

**1:35 — the scoreboard (optional, but it is the strongest beat).** Go to **You**
and scroll to *Open vs closed, measured*:

> "And because 'open weights are better' is a claim, I measured it. Same
> walkthrough, five models, scored apart. Open won the photographs at 82% versus
> 81% for the cheap closed model, for a seventh of the price. Closed won the
> clock. And the 4B on this laptop found a quarter of the work and delivered
> eleven percent of it — so the laptop is the camera, not the accountant."

## If a key is missing on the day

- **No vision model:** the quote still works, and the attribution says
  `words only — no photos`. Say so out loud — honest degradation is a feature.
- **No TabPFN token:** pricing says `heuristic` and lists the rows it weighted.
- **TabPFN is slow:** the first call in a cold process waits up to 45s; after
  that the bound is 12s, and past it the local layer answers, labels itself, and
  the slow call prices the *next* quote. Nothing hangs on stage.
- **No text model:** scope says `deterministic estimate (no model reachable)`.
- **No MongoDB:** memory is in-process for the session; the client link still
  works, because it is a route in the same app backed by the same store.
- **No benchmark run stored:** the You tab says so and prints the command to
  produce one, rather than showing an empty table.
- **Total disaster:** `SERVE_WEB=1 CHALK_PROVIDER=ollama npm start` and run the
  whole thing on the laptop.

## Stills worth capturing

The six in `docs/images/` are current and were taken from the deployed build.

1. Walk screen with two photos and the pro's own words (`01-walk.png`).
2. The quote receipt with the line items and the fair range (`02-quote.png`).
3. Her side of the desk — odds, usual price, undercharge warning, the ladder
   (`03-quote-private.png`).
4. **The client's page** — captioned photos, a thumbnail beside each line, and no
   odds anywhere (`04-client.png`). If you capture one frame, capture this.
5. The Jobs list with the **WON** badge and the moved win rate (`05-jobs.png`).
6. The scoreboard, as the app renders it (`06-board.png`).
7. The attribution block at the bottom of a quote — models plus per-stage
   timings. This is the frame that makes every number in the write-up checkable.
