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

   (Only one table now — the approval queue that previously needed a `pending_reviews` table
   was replaced by n8n's built-in email-approval feature, which pauses the execution itself.)

   Data Tables auto-generate their own `id` column, so you don't need to add one.
5. When you open the imported workflow, the **Data Table nodes will show a config warning**
   (`Filter: Not Already Seen`, `Mark As Seen`) — this is expected. Reselect the actual table
   from the dropdown (I could only pre-fill it by name, not by its real internal ID) and
   confirm the column mapping. Same for the **Google Sheets nodes** (`Log To Google Sheets`,
   `Log: Rejected`) and the **email nodes** (`Email: Ask Approval`, `Send Error Alert`) — pick
   the credential and spreadsheet from the dropdowns after import. Treat these as solid
   scaffolds, not guaranteed drop-ins — validate → verify wiring → test → only then activate.

### 3. Three "confirm with the business owner" gaps in the FAQ

`3-workflows/product-faq.md` has your real prices, delivery area, atelier address, and
WhatsApp number — but **delivery fee, delivery time, and payment method** weren't specified,
so I marked them "confirm with the business owner" rather than inventing numbers. Until
you fill those in, the workflows are wired to route any question touching those three topics
to human review instead of auto-answering.

### 4. Approvals & alerts come by EMAIL (Telegram was dropped)

The owner decided against Telegram. Instead, the workflows use n8n's built-in
**email approval**: when a comment needs human review, an email arrives at
**brahim99zahir@gmail.com** with the comment, the AI's draft reply, the client type, and
**Approve / Disapprove buttons**. Clicking Approve posts the reply; Disapprove logs it as
rejected and posts nothing. Error alerts also arrive by email.

What you need for this: a **Gmail App Password** (n8n sends the emails through your own
Gmail via SMTP):

1. Your Google account needs 2-Step Verification on: https://myaccount.google.com/security
2. Then create an App Password: https://myaccount.google.com/apppasswords — name it "n8n",
   copy the 16-character password it shows.
3. In n8n: **Credentials → Add credential → SMTP** —
   Host: `smtp.gmail.com`, Port: `465`, SSL/TLS: on,
   User: `brahim99zahir@gmail.com`, Password: the 16-character app password.
4. Select this credential on the `Email: Ask Approval` node (workflow 1) and the
   `Send Error Alert` node (workflow 3).

### 5. Google Sheets client log (in Arabic)

Every processed comment is logged to a Google Sheet with the client classified in Arabic
(نوع العميل: مهتم بالشراء / سؤال عن الثمن / استفسار عن التوصيل / شكوى / زبون سعيد / سؤال
عام / أخرى).

1. Create a Google Sheet (e.g. named **عملاء فيها خير**) with these headers in row 1,
   columns A→G:
   `التاريخ` | `المنصة` | `اسم العميل` | `التعليق` | `نوع العميل` | `الرد` | `الحالة`
2. In n8n: **Credentials → Add credential → Google Sheets OAuth2 API** — this needs a Google
   Cloud project (console.cloud.google.com → new project → enable **Google Sheets API** →
   OAuth consent screen → OAuth Client ID (Web application) → paste n8n's redirect URI from
   the credential screen → connect with your Google account). I'll walk you through it
   click-by-click when you're there.
3. Select the credential + your spreadsheet + sheet on the `Log To Google Sheets` and
   `Log: Rejected` nodes.

The `الحالة` column records: "تم الرد تلقائيًا" (auto-replied), "تمت الموافقة يدويًا"
(approved by you), or "مرفوض — لم يُنشر" (rejected, nothing posted).

### 6. Accounts only you can create

Meta developer app (for Instagram/Facebook) still needs your personal login/browser — I'll
give exact click-by-click steps when the n8n side is done. Anthropic is ✅ done (key verified
2026-07-24). Google Cloud OAuth is needed for the Sheets credential above (and for YouTube
later, if you ever add a channel).

## The order to actually do things in

1. Answer the voice-profile authorship question (§1 above) and send more real samples if
   needed — this can happen anytime, in parallel with everything else.
2. Fill in the remaining FAQ gaps (§3): payment method, delivery time, guarantees.
3. Sign up for n8n Cloud, import the 3 workflows, create the `yt_seen_comments` Data Table (§2).
4. Create the Gmail App Password + SMTP credential for email approvals (§4).
5. Create the Arabic client-log spreadsheet + Google Sheets credential (§5).
6. Then the Meta developer app (§6) and the test gates in `CLAUDE-CODE-MASTER-PROMPT.md`
   Phase 5 — nothing posts publicly without your explicit OK on the first real test, per the
   non-negotiable rules at the top of that file.

## Budget check

n8n Cloud Starter (~260 MAD/month) + Claude Haiku API calls (~100-200 MAD at expected comment
volume) lands around **360-460 MAD/month** — under the 500 MAD ceiling, but with less margin
than the self-hosted path would have had (~65 MAD/month total). If comment volume grows enough
to push past this, `2-server/` is ready as a cheaper fallback (see `2-server/NOTE.md`). No
other paid services are used anywhere in this package.

## A note on how the n8n workflows are wired (for when you're reviewing them)

- `01-comment-reply-engine.json` has 2 entry points that converge on shared logic: a
  Schedule Trigger polls YouTube (no comment webhook exists for YouTube; dormant until a
  channel is configured), and an Execute Workflow trigger receives normalized
  Instagram/Facebook events from workflow 2. A single **Config** node near the top holds the
  platform IDs, the approval email, and the full system prompt — the one place to update
  with real values.
- The AI classifies every commenter (`client_type`, in Arabic) as well as drafting the reply.
  Sensitive comments (`needs_human: true`) go through n8n's built-in **email approval**: the
  execution pauses (n8n persists waiting executions — they survive restarts), an email with
  Approve/Disapprove buttons arrives, and the click resumes the same execution. Approved →
  posts the reply; disapproved → logs as rejected, posts nothing.
- Every outcome is appended to the Arabic Google Sheet (§5): auto-replied, approved, or
  rejected.
- `02-meta-webhook-router.json` handles both the one-time GET verification challenge Meta
  sends and the ongoing POST events for both Instagram and Facebook (they share one webhook).
- `03-error-handler.json` is wired as both other workflows' error workflow — any node failure
  anywhere sends an email alert with the workflow name, failing node, and error message.
- One n8n Data Table backs the YouTube dedup (`yt_seen_comments`, per §2). No external
  database needed.
