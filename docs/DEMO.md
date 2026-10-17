# Chalk — demo script (90 seconds)

Everything below has been run end to end on the build in this repo. Numbers in
brackets are what the current demo data produced.

## Before you hit record

1. `npm run build:all && npm start` (or open the deployed URL).
2. Open the app once and let it warm: the first quote pays for the TabPFN fit.
3. Have **one or two photos** ready on the phone — a kitchen, a hallway, a yard. Any
   real room beats a stock photo: the vision model names what is in it, and the
   photos now travel to the client's quote as the evidence behind the price.
   Two *different* rooms is the better demo — it shows each line item pointing at
   the right picture.
4. Keep one screen on **Walk** and one on **Jobs** so the history is visible.
5. **Put yourself in the client's seat.** Keep a second device (or a second
   browser window) ready — the last stop of the demo is *their* phone.
   *A phone can only open the link if the app is reachable from it:* run the demo
   from the deployed URL, or from the laptop's LAN address — `localhost:8787` is
   reachable by the laptop alone. A second **browser window** on the same machine
   works either way, and that is the safest thing to rehearse with.

## The 90 seconds

**0:00 — the promise.** Standing in the driveway, thumb on the screen:

> "A cleaner prices a job in the driveway, or they lose it. Watch what happens in
> the fifteen seconds after I take a photo."

**0:05 — Walk screen.** Snap the photo. Hold to talk (or type):

> "End of lease clean, three bedroom terrace. Kitchen is greasy, oven inside and
> out, two bathrooms, carpets in all three bedrooms need steaming, blinds are
> dusty. Stairs only, no lift, tight street parking."

**0:20 — Price this job.** Let the loading dialog run; it names the models as
they come back. *Do not narrate over it* — the wait is the point:

> "Photos are read by an open-weight vision model, the scope by an open-weight
> text model, and the price by TabPFN, in context over this pro's own 42 past
> jobs." *(current build, measured across runs: 11–25s warm from words alone —
> eyes 0.1s, scope 2.4–9.3s, price 4.4–9.9s, words 3.4–5.0s. With a photo on a
> cold process it is ~28s: eyes 8.8s, scope 4.3s, price 9.6s, words 5.0s. The
> attribution block prints exactly this split under every quote, so the number is
> checkable on screen.)*

**0:45 — the quote.** Scroll the receipt:

> "Every line is hours and complexity — the oven is 5 out of 5. Total $457
> [`$411`–`$600` depending on the walkthrough]. This is what I send the client."

**0:55 — the pro's side of the desk.** Point at three numbers:

> "67% odds they say yes. My usual price for this work, from my own history.
> And a market check from live listings." — then the band: *"At $388 I win the job
> 9 times in 10. At $558 it's a coin flip. That's the decision made visible."*

**1:05 — the undercharge warning.** If it fires:

> "If I'd quoted $421, Chalk tells me I just undercut myself by $175."

**1:10 — send it.** Tap **Copy link** in the *Send it* card, and say the quiet
part out loud:

> "One link. She sees the work, the price, what I assumed — and never my odds,
> my usual price, or my margin. That page is the whole reason this isn't a
> calculator."

**1:20 — her phone.** Open the link on the second device (nothing to scan, just
paste it). Do **not** scroll past the evidence strip — it is the beat that makes
the price an argument instead of a number:

> "Here's the pitch she actually reads: the photos I took on the walk, what the
> vision model saw in each one, and every line item sitting next to the picture
> that justifies it. This is why she can't argue with it."

Then tap **Accept this quote**:

> "And that's the client side. She's just told me yes — and she's just taught the
> model something."

**1:30 — back on your phone.** The Jobs list already says **WON**, the win rate
moved, and that row is now part of the history TabPFN fits over:

> "The next quote I run gets priced over this answered job. Open-weight models
> all the way down, every layer named, and any layer can be unplugged — it still
> works and it still tells you the truth. That's Chalk: quote the job before you
> leave the driveway."

## If a key is missing on the day

- **No vision model:** the quote still works, and the attribution says
  `words only — no photos`. Say so out loud — honest degradation is a feature.
- **No TabPFN token:** pricing says `heuristic` and lists the rows it weighted.
- **TabPFN is slow:** after 12s the quote falls back to the heuristic, labels it,
  and the model's answer prices the next quote. Nothing hangs on stage.
- **No text model:** scope says `deterministic estimate (no model reachable)`.
- **No MongoDB:** memory is in-process for the session; the client link still
  works (it is a route in the same app, backed by the same store).
- **Total disaster:** `SERVE_WEB=1 CHALK_PROVIDER=ollama npm start` and run the
  whole thing on the laptop.

## Stills worth capturing

1. Walk screen mid-dictation.
2. The loading dialog while it works (the model names are the story).
3. The quote receipt with the line items.
4. The band card (`$388 · 91%` … `$558 · 35%`).
5. The attribution block at the bottom — models + per-stage timings.
6. **The evidence strip on the client's phone** — captioned photos, with a
   thumbnail beside each line item. If you only capture one frame, capture this.
7. **The client's phone** — the same quote with no odds on it, next to the
   pro's phone with the **Send it** card and the link. Two faces of one record.
8. The **WON** badge in Jobs right after the client taps Accept.
9. The **You** screen: win rate, margin log, job history.
