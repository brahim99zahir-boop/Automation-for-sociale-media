# Archive — earlier architectures, kept as a fallback

The live system is `4-apps-script/`. Nothing in here runs, and nothing in the repo reads
it. It is kept because it is working code for a real fallback, not because it is in use.

## `2-server/`

Self-hosted n8n on a VPS: Docker Compose, Caddy with automatic HTTPS, Postgres, and a
step-by-step setup script. Written for an Oracle Cloud Always Free ARM VM, so it would
cost nothing to run.

Abandoned because Google Apps Script does the same job with no server to maintain, no
domain, and no credit card. Worth returning to only if Apps Script becomes unsuitable —
its quotas (email, UrlFetch, 6-minute executions) are the realistic trigger.

Note: `2-server/NOTE.md` still says "This folder IS the deployment path". It was, once.

## `n8n-workflows/`

Three importable n8n workflows from the same plan:

- `01-comment-reply-engine.json` — the reply engine, with a Telegram approval loop
- `02-meta-webhook-router.json` — one webhook handling both Instagram and Facebook
- `03-error-handler.json` — error trigger to Telegram

Superseded twice: Telegram approval became email approval, then the whole n8n path became
Apps Script.

## Deleted rather than archived

`3-workflows/product-faq.md` and `product-faq-template.md`. The FAQ still stated 470 and
720 as standing prices after they were corrected to 550/650/750, and it was compiled into
nothing — the build script reads `reply-playbook.md` and `facts-for-ai.md` only. A file
that contradicts the truth and feeds nothing is worse than no file. The template was blank
and unreferenced.

`package.json` / `package-lock.json` at the repo root. Declared animejs, motion and
motion-v; none were imported by anything at the root, and `5-website/` declares its own
`motion`. Deleted rather than archived because `npm i` restores them in seconds.
