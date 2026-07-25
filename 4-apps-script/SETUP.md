# Setup — Google Apps Script version (free, no credit card, no server)

This runs the whole system on Google's servers using your existing Gmail account.
No VPS, no domain, no Docker, no n8n subscription, no credit card.

**What it costs:** only the Claude API (~100-200 MAD/month). Everything else is free.

---

## Step 1 — Create the project (2 min)

1. Go to **https://script.google.com** and sign in as `brahim99zahir@gmail.com`.
2. Click **New project** (مشروع جديد).
3. Rename it (top left) to **فيها خير — نظام الرد الآلي**.

## Step 2 — Add the code (5 min)

The project starts with one file called `Code.gs`. You need three files total.

1. **`Code.gs`** — select everything already in it and delete it, then paste the full
   contents of [`Code.gs`](./Code.gs) from this repo.
2. **`Config.gs`** — click the **+** next to "Files" → **Script** → name it `Config`
   → paste [`Config.gs`](./Config.gs).
3. **`SystemPrompt.gs`** — same again → name it `SystemPrompt`
   → paste [`SystemPrompt.gs`](./SystemPrompt.gs).

Click the **save** icon (💾).

> Apps Script adds the `.gs` ending itself — just type the name without it.

## Step 3 — Store your API key (2 min)

Secrets are kept out of the code so they're never exposed.

1. Open `Config.gs`, scroll to `setSecrets()`.
2. Paste your Anthropic API key between the quotes on the `anthropicKey` line.
   (Leave `metaToken` empty for now — that comes in Step 7.)
3. In the toolbar, choose the function **`setSecrets`** and click **Run**.
4. Google asks for permission the first time: **Review permissions** → pick your account →
   **Advanced** → **Go to … (unsafe)** → **Allow**.
   *(It says "unsafe" for every personal script that isn't Google-verified — that's expected
   for your own code.)*
5. Check the log says `Anthropic key set: true`.
6. **Now delete the key you pasted** and save again. It's stored safely already.

## Step 4 — Create the client spreadsheet (1 min)

1. Choose the function **`setupSheet`** → **Run**.
2. Open **View → Logs**. It prints a spreadsheet ID.
3. Copy that ID into `SPREADSHEET_ID` in `Config.gs`, and save.

You now have a sheet named **عملاء فيها خير** with right-to-left Arabic headers:
التاريخ | المنصة | اسم العميل | التعليق | نوع العميل | الرد | الحالة

## Step 5 — Test it safely (2 min)

1. Choose **`testWithFakeComment`** → **Run**.
2. Within a few seconds you should get an **email** with a test comment, the AI's Darija
   reply, the client type, and green **وافق وانشر** / red **ارفض** buttons.
3. Check the spreadsheet — a new row appears.

This uses a fake comment, so nothing touches your real Instagram. **`DRAFT_ONLY_MODE` is on
by default**, so even clicking Approve posts nothing yet.

## Step 6 — Publish the web app (needed for the approval buttons) (2 min)

1. Top right: **Deploy** → **New deployment**.
2. Click the gear ⚙ next to "Select type" → **Web app**.
3. Set **Execute as: Me**, **Who has access: Anyone**.
   *(Required — the buttons are clicked from your email, and Meta must be able to reach it.
   The links carry a random one-time token, so nobody can guess them.)*
4. **Deploy** → copy the **Web app URL**. Send it to me for the Meta webhook step.

Re-run `testWithFakeComment` and the buttons in the email will now work.

## Step 7 — Connect Instagram (the last piece)

This needs a Meta developer app — tell me when you're at this step and I'll walk you through
each screen. You'll end with two values:

- an **Instagram User ID** → paste into `IG_USER_ID` in `Config.gs`
- a **long-lived Page access token** → paste into `metaToken` in `setSecrets()`, Run, then
  delete it from the code again

## Step 8 — Turn on the timer

Choose **`installTrigger`** → **Run**. The system now checks for new comments every 15 minutes,
24/7, whether or not your PC is on.

---

## The two safety switches (in `Config.gs`)

| Setting | Default | Meaning |
|---|---|---|
| `DRAFT_ONLY_MODE` | `true` | **Nothing is ever posted publicly.** Replies are drafted, logged, emailed. Leave on until you trust it. |
| `ALWAYS_ASK_APPROVAL` | `true` | Every reply waits for your approval, even harmless ones. Set `false` once ~9 out of 10 drafts are good as-is. |

Going live is deliberately two steps: first set `ALWAYS_ASK_APPROVAL = false` (auto-replies to
easy questions, complaints still come to you), then later `DRAFT_ONLY_MODE = false`.

Complaints, refund/return questions, payment-method questions, guarantee questions, and
international-shipping questions **always** come to you, regardless of these switches.

## Free quota limits (consumer Gmail account)

| Limit | Amount | Your expected use |
|---|---|---|
| API calls/day | 20,000 | ~200 |
| Emails/day | 100 | a few |
| Script runtime/day | 90 min | ~10 min |

Comfortably inside the free tier.

## Troubleshooting

**"Missing secret: ANTHROPIC_API_KEY"** — `setSecrets()` wasn't run, or was run with an empty
value. Redo Step 3.

**Approval buttons show "انتهت الصلاحية"** — the link was already used. Each link works once,
on purpose, so a reply can't be posted twice.

**No email arrives** — check spam, and confirm `OWNER_EMAIL` in `Config.gs`.

**Errors** — any failure emails you automatically with the location and message. Details are
also in **Executions** in the left sidebar of the editor.
