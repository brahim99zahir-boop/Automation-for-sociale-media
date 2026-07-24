# This folder is currently NOT being used

You chose **n8n Cloud** over self-hosting (see `GUIDE.md` at the repo root), so none of the
files in this folder are part of the active deployment path right now — n8n Cloud handles
the server, HTTPS, and database for you.

Everything here (`docker-compose.yml`, `Caddyfile`, `.env.example`, `init-data.sh`,
`setup-commands.sh`) is kept in case you switch to self-hosting later — e.g. if comment
volume grows enough that n8n Cloud's execution limits or price stop making sense (self-hosted
runs ~65 MAD/month total vs. n8n Cloud's ~260 MAD/month Starter plan). If that happens, this
folder is ready to go — just follow `setup-commands.sh` block by block once you have a VPS
and domain.

Note: if you do migrate later, the workflow JSONs in `3-workflows/` currently use n8n's
built-in **Data Table** node (works on both Cloud and self-hosted n8n ≥ 1.6x), not a separate
Postgres database — so no workflow rework would be needed for that part for the migration
itself, though you'd still want to run this folder's Postgres setup if you wanted a heavier-
duty database for other reasons.
