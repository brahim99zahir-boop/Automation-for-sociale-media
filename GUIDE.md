# Guide — AI Comment-Reply System for Mosiquaire

This is the human-readable walkthrough. `CLAUDE-CODE-MASTER-PROMPT.md` is the original
instruction set this package was built from; this file tracks **actual state**: what's
already built, what's still open, and exactly what you need to do next.

## What's already done (this session, in the repo)

- `1-voice-profile/` — transcription tooling + honest results (see below — this is the one
  part that needs your input before it's usable).
- `2-server/` — **the active deployment path**: Docker Compose + Caddy (automatic free HTTPS)
  + Postgres, plus a block-by-block `setup-commands.sh`. Designed for a paid VPS but works
  identically on a permanently-free Oracle Cloud VM — see §2.
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

### 2. ✅ CHOSEN PATH: Google Apps Script (free, no credit card)

**The owner chose this route — see [`4-apps-script/SETUP.md`](./4-apps-script/SETUP.md) for
the step-by-step.** Everything below in this section (Oracle Cloud, DuckDNS, n8n) is the
alternative that was *not* chosen; it's kept in case you ever want the visual editor back.

Why Apps Script won: it needs **no credit card, no server, no domain, and no n8n
subscription**. It runs on Google's infrastructure using the Gmail account you already have,
and it talks to Google Sheets and Gmail natively — which removed two setup headaches the n8n
route had (the Google Cloud OAuth project and the Gmail app password).

It has the same features: AI replies in your Darija voice, Arabic client classification, the
Arabic Google Sheet log, and email approve/reject before anything is posted.

What it gives up: n8n's drag-and-drop editor. The logic is code instead
(`4-apps-script/Code.gs`), which I maintain for you. Day to day you interact with it exactly
the same way — through approval emails and the spreadsheet.

The parser fix from the live-API testing is carried over and re-verified against real Claude
responses (6/6 parsed correctly, complaints and guarantee questions correctly held for human
review).

---

### 2b. ALTERNATIVE (not chosen): free hosting for n8n

**Key fact: the n8n software itself is free forever.** n8n Community Edition (self-hosted) is
free to run for your own business — you only ever pay for the *server* it runs on. n8n Cloud's
~260 MAD/month buys convenience, not the software.

So the plan is: run n8n yourself on a **permanently free** cloud server.

#### Oracle Cloud "Always Free" — free forever, not a trial

Oracle gives every account a permanently free ARM server: **up to 4 CPUs and 12 GB RAM**,
200 GB storage, 10 TB/month traffic — far more than this system needs, and it never expires
(verified on oracle.com/cloud/free, July 2026).

Honest caveats before you start:
- **A credit/debit card is required for identity verification.** Oracle places a temporary
  authorization hold (usually removed in 3-5 days) but does **not** charge you for Always Free
  resources. Prepaid/virtual cards are rejected.
- **ARM capacity is often "out of capacity"** in popular regions — this is the single most
  common frustration. If it fails, retry later or pick a different home region. (Your home
  region can't be changed after signup, so if you get repeated failures, that matters.)
- **Accounts idle 30+ days may be suspended** — not an issue here, since the system runs 24/7.

Steps:
1. Sign up at **https://www.oracle.com/cloud/free/** — choose a home region near you
   (Frankfurt/Amsterdam are good for Morocco). Verify with your card.
2. Create a VM: **Compute → Instances → Create Instance**
   - Image: **Ubuntu 24.04** (change from the Oracle Linux default)
   - Shape: **Ampere / VM.Standard.A1.Flex**, set **2 OCPU / 12 GB RAM** (stays inside Always
     Free; anything labelled "Always Free eligible" is safe)
   - **Save the SSH private key** it offers to download — you cannot get it again, and without
     it you cannot log into your own server.
3. Open the firewall in **two** places (Oracle needs both — missing the second is the #1
   reason "it doesn't work"):
   - **In the OCI console**: Networking → your VCN → Security Lists → Default → Add Ingress
     Rules → allow TCP **80** and **443** from `0.0.0.0/0`.
   - **On the server itself**: Oracle's Ubuntu images ship with restrictive iptables rules.
     `setup-commands.sh` Block 5 handles this.
4. Note the VM's **public IP** and send it to me with your SSH key — I'll run the deploy.

#### Free domain: DuckDNS

You need a hostname for HTTPS (Meta refuses plain-IP webhooks). **https://www.duckdns.org** is
free forever: sign in with Google, pick a name like `fihakhir`, point it at your Oracle VM's IP
→ you get `fihakhir.duckdns.org`. Caddy then gets a real Let's Encrypt certificate for it
automatically, at no cost. In `.env` that's `SUBDOMAIN=fihakhir` and `DOMAIN_NAME=duckdns.org`.

#### What this actually costs per month

| Piece | Cost |
|---|---|
| n8n software (Community Edition) | **0** |
| Oracle Cloud Always Free VM | **0** |
| DuckDNS domain + Let's Encrypt HTTPS | **0** |
| Gmail SMTP (approval emails) | **0** |
| Google Sheets (client log) | **0** |
| Claude API (Haiku) | ~100-200 MAD — **the only real cost** |

**Total: ~100-200 MAD/month**, all of it AI usage. You already added $10 of Anthropic credit,
which covers a long time at Haiku prices.

If you want to reach a true **0 MAD**, the AI can be swapped to **Google Gemini's free tier**
(Gemini Flash is free up to a generous daily request limit — https://aistudio.google.com).
That means changing one node in the workflow; tell me and I'll do it. Claude Haiku will follow
your Darija voice profile more closely, so I'd only switch if the API cost is a real problem.

#### After the server is up

The workflows need one Data Table (`yt_seen_comments`, single column `comment_id`) created in
the n8n UI. When you open the imported workflows, the **Data Table**, **Google Sheets**, and
**email** nodes will show config warnings — that's expected: reselect the table/spreadsheet/
credential from each dropdown, since I could only pre-fill them by name, not by internal ID.
Treat them as solid scaffolds, not guaranteed drop-ins — validate → test → only then activate.

(If your n8n version turns out not to offer Data Tables, tell me — the Postgres database in
`docker-compose.yml` is already running and I'll switch those two nodes over to it.)

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

Follow **[`4-apps-script/SETUP.md`](./4-apps-script/SETUP.md)** — it's written click by click.
Summary:

1. Create the Apps Script project and paste in the 3 files (~7 min).
2. Run `setSecrets()` with your Anthropic key, then delete the pasted key (~2 min).
3. Run `setupSheet()` → paste the printed spreadsheet ID into `Config.gs` (~1 min).
4. Run `testWithFakeComment()` → check the email and the sheet (~2 min). Nothing touches real
   Instagram; `DRAFT_ONLY_MODE` blocks all public posting.
5. Deploy as a Web app so the approval buttons work; send me the URL.
6. **Meta developer app** for Instagram (§6) — tell me when you're here and I'll walk you
   through it screen by screen. This is the only remaining hard part.
7. Run `installTrigger()` to start the 15-minute timer.

Steps 1-5 you can do right now with no accounts to create and nothing to pay.

Independent of all the above, whenever you have a moment: answer the voice-profile authorship
question (§1) and fill the remaining FAQ gaps (§3) — payment method, delivery time,
guarantees. Those improve reply quality but don't block the deployment.

## Budget check

With the free-hosting plan in §2, the only recurring cost is the Claude Haiku API
(~100-200 MAD/month at expected comment volume) — roughly **a fifth of the 500 MAD ceiling**,
and it can go to zero by switching to Gemini's free tier. Hosting, HTTPS, email, and the
spreadsheet are all free. No other paid services are used anywhere in this package.

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
