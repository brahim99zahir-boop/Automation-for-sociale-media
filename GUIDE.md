# Guide — AI Comment-Reply System for Mosiquaire

This is the human-readable walkthrough. `CLAUDE-CODE-MASTER-PROMPT.md` is the original
instruction set this package was built from; this file tracks **actual state**: what's
already built, what's still open, and exactly what you need to do next.

## What's already done (this session, in the repo)

- `1-voice-profile/` — transcription tooling + honest results (see below — this is the one
  part that needs your input before it's usable).
- `2-server/` — a self-hosted deployment path (Docker Compose + Caddy + Postgres) kept as a
  fallback for later. **Not currently used** — see `2-server/NOTE.md`. You chose n8n Cloud
  instead, which needs no server at all.
- `3-workflows/` — three importable n8n workflows (`01-comment-reply-engine.json`,
  `02-meta-webhook-router.json`, `03-error-handler.json`) and `product-faq.md` filled with
  your real Mosiquaire facts.
- `system-prompt.txt` — the combined voice profile + FAQ + output-format instructions that
  gets injected into the workflows.
- `config.local.md` (git-ignored) — everything you told me in Phase 0, in one place.

## What's NOT done, and why — read this before anything else

### 1. The voice profile is a draft with an open question for you

I tried to build `voice-profile.md` from your 11 Instagram Reels, and it didn't work — see
`1-voice-profile/transcribe-videos.md` for the full account. Short version: the reels are
silent product-demo clips with background music, not talking-to-camera narration, and
Whisper (both `medium` and `large-v3`) hallucinated nonsense rather than transcribing real
speech. I won't fabricate a voice profile, so instead I built a draft from the two text
samples you pasted in chat.

**I need you to answer one thing**: the price-list message you sent ("صافي، راني حدثت جميع
الأثمنة فـ Knowledge وفـ Catalog...") reads like an AI tool telling *you* it updated its
knowledge base — not like something said to a customer. Did you write that yourself, or is
it output from some other assistant/chatbot? If it's the latter, it shouldn't be used as a
voice sample at all. See the "Confidence note" at the top of `1-voice-profile/voice-profile.md`
for the full reasoning.

**What would actually fix this**: send me either (a) more real WhatsApp/DM replies you've
personally written to customers — pricing questions, delivery questions, a complaint, a happy
customer, ideally 8-10 of them — or (b) links to videos where you talk to camera for 30+
seconds (testimonials, "why I started this," Q&A) instead of silent product demos.

### 2. n8n Cloud account not created yet

You decided to use **n8n Cloud** (~260 MAD/month Starter plan) instead of self-hosting on a
VPS — no server, Docker, domain, or SSH needed. Here's what's left:

1. Go to **https://n8n.io/cloud/** (or **https://app.n8n.cloud/register**) and sign up — the
   14-day free trial doesn't require a card.
2. Pick a subdomain for your instance (e.g. `yourname.app.n8n.cloud`) — n8n Cloud handles
   HTTPS automatically, nothing to configure.
3. Once you're in, go to **Settings → n8n API** and create an API key — send it to me and
   I'll import and wire up the 3 workflows for you.
4. **Create the 3 Data Tables** the workflows use (Data Tables is n8n's built-in structured
   storage — replaces the Postgres database the self-hosted path would have used). In the n8n
   UI: **Data Tables → Create Table**, and make these three:

   | Table name | Columns |
   |---|---|
   | `yt_seen_comments` | `comment_id` (string) |
   | `pending_reviews` | `platform` (string), `comment_id` (string), `post_id` (string), `draft_reply` (string), `status` (string) |
   | `yt_poll_state` | `channel_id` (string), `last_checked_at` (string) — not currently used by a node, kept for a future rate-limit/pagination improvement; safe to skip for now |

   Data Tables auto-generate their own `id` column, so you don't need to add one.
5. When you open the imported workflow, a few **Data Table nodes will show a config warning**
   (`Filter: Not Already Seen`, `Mark As Seen`, `Insert Pending Review`, `Fetch Pending Review`,
   `Mark Rejected`, `Mark Posted`) — this is expected. Each one's "notes" field explains what to
   re-check: reselect the actual table from the dropdown (I could only pre-fill it by name, not
   by its real internal ID) and confirm the column mapping looks right. I couldn't fully verify
   n8n's exact Data Table parameter schema from documentation alone, so treat these six nodes as
   a solid starting scaffold, not a guaranteed drop-in — the master prompt's own rule applies
   here too: validate → verify wiring → test → only then activate.

### 3. Three "confirm with the business owner" gaps in the FAQ

`3-workflows/product-faq.md` has your real prices, delivery area, atelier address, and
WhatsApp number — but **delivery fee, delivery time, and payment method** weren't specified,
so I marked them "confirm with the business owner" rather than inventing numbers. Until
you fill those in, the workflows are wired to route any question touching those three topics
to human review instead of auto-answering.

### 4. Telegram bot needs finishing

You said you already created a bot via @BotFather but don't know the rest. Here's exactly
what's left:

1. In your BotFather chat, find the token it gave you when you ran `/newbot` (a string like
   `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`). If you don't have it anymore, message
   @BotFather → `/mybots` → your bot → **API Token**.
2. Open a chat with your own bot (search its @username) and send it any message — bots can't
   message you first.
3. Fetch your chat ID: open this URL in a browser (replace `<TOKEN>`):
   `https://api.telegram.org/bot<TOKEN>/getUpdates`. Look for `"chat":{"id": ...}` in the
   response — that number is your `telegramChatId`.
4. Give me the token (for the n8n Telegram credential) and the chat ID (goes into the
   workflows' Config node) when you have them.

### 5. Accounts only you can create

Anthropic API key, Google Cloud OAuth (for YouTube), and a Meta developer app (for
Instagram/Facebook) all need your personal login/browser. Once you have a VPS and the n8n
instance is live, I'll give you exact click-by-click steps for each and verify each one with
a real API call before we move on — see `CLAUDE-CODE-MASTER-PROMPT.md` Phase 3.

## The order to actually do things in

1. Answer the voice-profile authorship question (§1 above) and send more real samples if
   needed — this can happen anytime, in parallel with everything else.
2. Fill in the 3 FAQ gaps in `3-workflows/product-faq.md` (§3) whenever you have the answers.
3. Get the Telegram bot token + chat ID (§4) — takes 5 minutes, no cost.
4. Sign up for n8n Cloud, create the 3 Data Tables, create an API key, send it to me (§2) —
   I'll import and wire up the 3 workflows.
5. Then the account setup (Anthropic/YouTube/Meta) and the test gates in
   `CLAUDE-CODE-MASTER-PROMPT.md` Phase 5 — nothing posts publicly without your explicit OK
   on the first real test, per the non-negotiable rules at the top of that file.

## Budget check

n8n Cloud Starter (~260 MAD/month) + Claude Haiku API calls (~100-200 MAD at expected comment
volume) lands around **360-460 MAD/month** — under the 500 MAD ceiling, but with less margin
than the self-hosted path would have had (~65 MAD/month total). If comment volume grows enough
to push past this, `2-server/` is ready as a cheaper fallback (see `2-server/NOTE.md`). No
other paid services are used anywhere in this package.

## A note on how the n8n workflows are wired (for when you're reviewing them)

- `01-comment-reply-engine.json` has 3 entry points that all converge on shared logic: a
  Schedule Trigger polls YouTube (no comment webhook exists for YouTube), an Execute Workflow
  trigger receives normalized Instagram/Facebook events from workflow 2, and a Telegram
  Trigger listens for your Approve/Reject button taps. A single **Config** node near the top
  holds the 4 IDs (`channelId`, `igUserId`, `fbPageId`, `telegramChatId`) and the full system
  prompt — that's the one place Phase 4 patches with your real values.
- Sensitive comments don't use n8n's `Wait` node (that would hold an execution open
  indefinitely, which is fragile across restarts) — instead the draft is saved to a Data
  Table and the Telegram approval button's callback starts a fresh, independent execution that
  finishes the job. This is the standard n8n human-in-the-loop pattern.
- `02-meta-webhook-router.json` handles both the one-time GET verification challenge Meta
  sends and the ongoing POST events for both Instagram and Facebook (they share one webhook).
- `03-error-handler.json` is wired as both other workflows' error workflow — any node failure
  anywhere sends you a Telegram alert with the workflow name, failing node, and error message.
- Two n8n Data Tables back this (create them in the n8n Cloud UI per §2 above):
  `yt_seen_comments` (dedup for YouTube polling) and `pending_reviews` (the human-approval
  queue). No external database needed — this is n8n Cloud's built-in structured storage.
