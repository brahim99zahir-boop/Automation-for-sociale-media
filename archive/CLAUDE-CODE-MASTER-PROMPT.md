# MASTER PROMPT FOR CLAUDE CODE
# How to use: open Claude Code on your PC, inside the unzipped `automation-package` folder,
# and say: "Read CLAUDE-CODE-MASTER-PROMPT.md and execute it. Start with Phase 0."
# Claude Code will do everything it can, and STOP to ask you whenever it needs something only you can provide.

---

## MISSION

Build and deploy a 24/7 AI comment-reply system for a content creator who sells a product:
- Replies to YouTube, Instagram, and Facebook comments in HIS exact voice (Darija/French mix preserved).
- Runs on a VPS with self-hosted n8n (Docker + Caddy HTTPS), so the user's PC can be off.
- Sensitive messages (complaints, orders, refunds) go to Telegram for human approval before posting.
- TikTok: draft-only mode (no official reply API — never use browser bots, they get accounts banned).
- Budget hard limit: 500 MAD (~$50)/month total. Target: VPS ~50 MAD + Claude API ~100-200 MAD.

All the assets already exist in this folder:
- `1-voice-profile/` — transcription commands + the voice-profile prompt
- `2-server/` — docker-compose.yml, Caddyfile, .env.example, setup-commands.sh
- `3-workflows/` — 3 importable n8n workflow JSONs + product-faq-template.md
- `GUIDE.md` — the human-readable version of this plan

## NON-NEGOTIABLE RULES

1. **Never post a public reply without the user's explicit OK on the first test.** Tests fire real side effects.
2. **Secrets:** generate every secret fresh on the target server (`openssl rand -base64 32`). Never commit `.env`, never echo the encryption key into logs beyond handing it to the user once, `chmod 600 .env`. Never inline secrets into compose/Caddyfile/workflow JSON.
3. **Never expose ports 5678/5432/6379.** Only Caddy 80/443 is public.
4. **Stop and ask** at every `[HUMAN]` checkpoint. Do not guess account IDs, tokens, or domains.
5. **Validate → verify wiring → test → only then activate** every n8n workflow. Never activate off a clean import alone.
6. **Stay in budget:** use Claude Haiku for replies (`claude-haiku-4-5`). Do not add paid services without asking.
7. If a command fails twice, show the user the error and your diagnosis before trying a third approach.

---

## PHASE 0 — Preflight interview

Ask the user for this list, then write the answers into a local `config.local.md` (git-ignored if a repo exists):

- [HUMAN] 10-30 links to the creator's videos (YouTube preferred; TikTok/IG links OK)
- [HUMAN] The languages he speaks in videos (Darija? French? mix?)
- [HUMAN] Does the user already have: a VPS? a domain? If yes, get SSH target (`user@ip`) + key path, and the domain.
- [HUMAN] Product facts for the FAQ: product name, price in MAD, delivery cities/price/time, how to order, payment methods, guarantees.
- [HUMAN] Telegram: has the user created a bot with @BotFather? (If not, walk them through it now: /newbot → token; then user messages the bot; fetch chat id via `https://api.telegram.org/bot<TOKEN>/getUpdates`.)

Verify tools on this PC: `python3 --version`, `pip`, `ffmpeg -version`. Install what's missing (`pip install yt-dlp faster-whisper`). On Windows without ffmpeg: `winget install ffmpeg`.

## PHASE 1 — Voice profile (fully automatable by you)

1. Download subtitles/audio per `1-voice-profile/transcribe-videos.md`:
   - YouTube: try `yt-dlp --write-auto-subs --skip-download` first (free, fast). Inspect a sample — if the Darija auto-subs are garbage, fall back to audio + Whisper.
   - Other platforms: `yt-dlp -x --audio-format mp3`, then transcribe with faster-whisper (`large-v3` on GPU / `medium` on CPU). Show progress; this can take an hour on CPU — offer to run overnight.
2. Concatenate all transcripts into `transcripts-all.txt`.
3. **You (Claude Code) now ACT AS the analyst:** apply `1-voice-profile/voice-profile-prompt.txt` to `transcripts-all.txt` yourself and write the result to `voice-profile.md`. Follow the prompt's rules exactly — keep his language mix, never invent expressions.
4. Fill `3-workflows/product-faq-template.md` with the facts from Phase 0 → save as `product-faq.md`.
5. Build `system-prompt.txt` = voice-profile.md + product-faq.md + this footer:
   "You reply to social media comments AS this creator. Follow the voice profile exactly. Use only facts from the FAQ. Reply in the commenter's language. 1-3 sentences max. Output ONLY JSON: {\"reply\": \"...\", \"needs_human\": true|false}."
6. **Quality gate:** generate 10 sample replies to invented comments, show them to the user. [HUMAN] approves or gives corrections; fold corrections back into voice-profile.md. Do not proceed until approved.

## PHASE 2 — Server deploy (you drive over SSH)

[HUMAN] must first: buy the VPS (recommend Hetzner CX22, Ubuntu 24.04) and set DNS A record `n8n.<domain>` → server IP. Wait for them.

Then execute `2-server/setup-commands.sh` **block by block over SSH** (never blind-paste the whole file):
1. Preflight: `curl -s ifconfig.me` vs `dig +short n8n.<domain>` — must match or STOP.
2. Install Docker via get.docker.com; verify `docker compose version`.
3. `mkdir -p /opt/n8n/caddy_config /opt/n8n/local_files`; scp up `docker-compose.yml`, `Caddyfile` (into caddy_config/), `.env.example` → `/opt/n8n/.env`.
4. Fill `.env`: DATA_FOLDER=/opt/n8n, domain parts, SSL_EMAIL, GENERIC_TIMEZONE=Africa/Casablanca; generate N8N_ENCRYPTION_KEY on the box with sed substitution; `grep REPLACE_WITH_ .env` must return nothing; `chmod 600 .env`. Hand the key to the user ONCE: "[HUMAN] save this in a password manager now."
5. ufw: OpenSSH + 80 + 443 only.
6. `docker compose up -d`.
7. Verify in order: `docker compose ps` → internal `wget -qO- http://localhost:5678/healthz` → caddy log shows "certificate obtained" (allow 1-2 min) → public `curl -fsS --retry 5 --retry-delay 10 https://n8n.<domain>/healthz`.
8. [HUMAN] IMMEDIATELY open the URL and create the owner account (first signup owns the instance), then enable 2FA, then create an **n8n API key** (Settings → API) and give it to you for Phase 4.

## PHASE 3 — External accounts (guide the human, verify each result)

You cannot create these. For each, give exact click-path instructions, then VERIFY with a test API call before moving on:

1. **Anthropic:** [HUMAN] console.anthropic.com → API key + ~$10 credit. Verify: one tiny `POST /v1/messages` call with haiku.
2. **YouTube:** [HUMAN] Google Cloud project → enable YouTube Data API v3 → OAuth client (Web app). The redirect URI comes FROM n8n's credential screen — sequence: create the n8n "YouTube OAuth2" credential first to read the URI, paste into Google, then connect **logged in as the creator**. Verify: `GET channels?mine=true` returns his channel; record channelId.
3. **Meta:** [HUMAN] IG must be Professional + linked to the FB Page. developers.facebook.com → Business app → Webhooks + Instagram products → long-lived Page token with `instagram_manage_comments`, `pages_manage_engagement`, `pages_read_engagement`, `pages_show_list`. Verify with Graph calls: `me/accounts` → pageId → `?fields=instagram_business_account` → igUserId. Recommend a System User token (non-expiring) if they have Business Manager.
4. **Telegram:** already done in Phase 0; verify by sending a "setup test" message via the bot API.

## PHASE 4 — Configure n8n (you drive via the n8n REST API)

Using the n8n API key against `https://n8n.<domain>/api/v1`:
1. Import the three workflow JSONs (`POST /workflows`).
2. Programmatically patch each workflow's **Settings** node values: channelId / igUserId / fbPageId / telegramChatId, and inject the full `system-prompt.txt` into `systemPrompt` (JSON-escape it properly).
3. Credentials **cannot** be created with secret values via API on all versions — if `POST /credentials` is unavailable or unsafe, instruct [HUMAN] to create the 4 credentials in the UI (Anthropic, YouTube OAuth2, Telegram, Query Auth `access_token`=Meta token) and to select them on the flagged nodes. List exactly which node needs which credential.
4. Wire workflows 1 & 2 to use workflow 3 as their Error Workflow (workflow settings.errorWorkflow).
5. **Meta webhook subscription:** activate workflow 2 first, give [HUMAN] the production URL `https://n8n.<domain>/webhook/meta-events`, they paste it in Meta App → Webhooks with any verify token, subscribe Page→`feed` and Instagram→`comments`. The GET branch answers the challenge automatically. Confirm Meta shows "verified".

## PHASE 5 — Test gates, then launch

1. **YouTube dry test:** [HUMAN] posts a harmless comment from a second account on one of his videos. Execute workflow 1 manually; inspect every node's output; confirm the reply text with the user BEFORE the post-reply node runs the first time (temporarily disable "Post Reply", show the draft, then enable and re-run after OK).
2. **IG/FB test:** [HUMAN] comments from a second account; watch the live execution; same confirmation ritual.
3. **Approval path test:** post a fake complaint ("my order never arrived") → verify it arrives on Telegram with Approve/Reject and that Reject posts nothing.
4. **Error path test:** temporarily break one credential, confirm Telegram alert fires, restore it.
5. **Training weeks:** set the prompt so `needs_human` is always true for 1-2 weeks. Collect the user's corrections, fold them into voice-profile.md, re-inject into the Settings nodes. When ~9/10 drafts pass untouched, restore normal routing.
6. Schedule with the user: weekly backup command + monthly `docker compose pull && up -d` (both at the bottom of setup-commands.sh). Remind: Meta long-lived tokens die in ~60 days unless they used a System User token.

## DEFINITION OF DONE

- `https://n8n.<domain>/healthz` returns ok; owner account + 2FA set; encryption key backed up off-box.
- 3 workflows active; a real YouTube and a real IG comment each received a correct in-voice reply.
- A complaint routed to Telegram and was NOT auto-posted.
- Error alert verified. Monthly cost re-estimated and confirmed under 500 MAD.

---

# WHAT ONLY YOU (THE HUMAN) MUST DO — the short checklist

1. Give Claude Code the video links + product facts (Phase 0 interview).
2. Buy the VPS (~50 MAD/mo) and a domain; point `n8n.yourdomain.com` at it.
3. Create the free accounts when asked: Telegram bot, Anthropic (+$10), Google Cloud OAuth, Meta developer app — Claude Code gives you exact clicks and verifies each one.
4. Sign up FIRST on your new n8n URL, save the encryption key, create the n8n API key.
5. Log in as the creator during the YouTube OAuth connect (replies must post as him).
6. Approve the 10 sample replies, and approve the first real test reply before it posts.
7. During weeks 1-2: tap Approve/Reject on Telegram and tell Claude Code which drafts were wrong.

Everything else — transcription, voice analysis, server setup, workflow import, configuration, testing — Claude Code executes for you.
