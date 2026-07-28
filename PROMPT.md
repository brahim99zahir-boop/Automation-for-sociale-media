# Cold-start prompt

Paste everything below into a fresh Claude Code session in this repo.

---

I run **فيها خير**, a workshop in Agadir, Morocco making made-to-measure mosquito screens
(موستكير). I sell on WhatsApp: **0666567672**. This repo is my 24/7 AI system that answers
comments and DMs in my own Darija and pulls people to WhatsApp.

**Read these first, in this order. They are the state of the project — do not re-derive it:**

1. `4-apps-script/SETUP.md` — how it deploys and runs
2. `1-voice-profile/reply-playbook.md` — how it writes
3. `3-workflows/facts-for-ai.md` — what it may state as fact
4. `1-voice-profile/tiktok-analysis.md` — measured findings from 708 of my real posts
5. `1-voice-profile/caption-analysis.md` — my Instagram captions and video frames

## What is already built and tested — do not rebuild

- **Google Apps Script**, runs on Google's servers every 15 min. Free, no VPS, no card.
  **It runs whether or not my PC is on.** Answered; stop re-answering it.
- **Instagram / Facebook / YouTube / TikTok** adapters, comments and DMs, behind one
  interface in `Platforms.gs`. All off until credentials exist.
- **Private dashboard** at `?dash=<64-char token>` — stop/start button, today's leads, real
  Claude cost in dirhams, 7-day chart, per-platform switches, last 60 replies. Self-contained
  HTML, RTL Arabic, dark mode.
- **Cost tracking** metered at the single API choke point. Haiku 4.5, $1/$5 per MTok.
- **Daily summary** email at 20:00 with hot leads and the day's cost.
- **Email approval** with single-use Approve/Reject links.
- **Arabic Google Sheet** log of every message.
- **63 assertions passing** via a stubbed Apps Script runtime in the scratchpad. Run them
  after any change to `4-apps-script/`.

## Hard rules, learned from real failures. Breaking these costs me customers

1. **Never invent a product fact.** Not materials, not lifespan, not delivery time, not
   guarantee length. If it isn't in `facts-for-ai.md`, bridge to WhatsApp. The model has been
   caught confidently inventing specs, and a wrong answer lands on my workshop after the
   customer has paid.
2. **Never answer "واه" to a feature question you can't verify.**
3. **Match the customer's script.** Arabic → Arabic, Arabizi → Arabizi, French → French.
   Never mix alphabets inside a sentence. This is enforced in code (`detectScript_`,
   `scriptIsClean_`), not left to the prompt — prompt rules alone only worked 5 times in 9.
4. **No tashkeel, no dashes, no curly quotes, no ellipsis characters.** Instant bot tells.
5. **Prices: العادي 550 / المضلم 650 / المزدوج 750 per m².** 439, 440 and 470 are صولد
   prices — never quote them as standard.
6. **Phone: 0666567672 only.** Do not use 0674191830.
7. **Test against the live API before shipping prompt changes.** Reviewing the prompt has
   repeatedly missed bugs that one real call exposed.
8. **Never commit secrets.** They live in Script Properties. `config.local.md` is gitignored.

## How I want you to work

- **Verify, don't assume.** Run it. If you can't, say so plainly instead of claiming it works.
- **Tell me when I'm wrong.** You found my automation was quoting prices that appeared in
  none of my 708 posts. That was worth more than any feature.
- **Don't flatter me and don't pad.** Short answers.
- **Don't bulk-add plugins or skills.** ~200 are installed and more makes the right one
  less likely to fire.
- **Ask before changing a number or a fact about my business.** Guessing costs me money.

## Open items — pick these up

**Blocked on me, ask if you need them:**
- Instagram: needs a Meta developer app (IG Professional + linked FB Page)
- Website `5-website/`: React + Tailwind + shadcn scaffold builds, but has no page and no
  real photos yet
- Confirm: is **انوكس 304L** what my screens are made of? I have a 323k-view post about it,
  and the AI currently refuses "شنو مصنوع منو؟" because materials aren't in its facts
- What is the **2/1 موستكير** model, and the **130 درهم** item?

**You can do without me:**
- Speed: `UrlFetchApp.fetchAll()` to parallelise platform fetches
- The Meta webhook path exists in `doPost` — instant replies instead of 15-minute polling
- `DRAFT_ONLY_MODE` and `ALWAYS_ASK_APPROVAL` are both still on, so nothing posts publicly

## The biggest finding, which is not a code change

My product posts average **47,294 views**. Everything else averages **10,960**. Product posts
are only **78 of my 708**. My best post ever is a plain installation walkthrough at **1.2M
views**. Posting more موستكير content beats any automation improvement — remind me of this
when I ask for more features.
