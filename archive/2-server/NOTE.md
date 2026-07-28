# This folder IS the deployment path

The plan is to self-host n8n on a **permanently free Oracle Cloud "Always Free" ARM VM**
(see `GUIDE.md` §2). n8n Community Edition is free forever for your own business use — only
the server would normally cost money, and Oracle's Always Free tier makes that free too.

Files here:

- `docker-compose.yml` — n8n + Postgres + Caddy. Only ports 80/443 are public; n8n (5678) and
  Postgres (5432) stay on the private Docker network.
- `Caddyfile` — reverse proxy with automatic free Let's Encrypt HTTPS. Domain-free (it reads
  the hostname from `.env`), so it works with a DuckDNS name like `fihakhir.duckdns.org`
  exactly as it would with a paid domain.
- `.env.example` — copy to `.env` on the server and fill in. All secrets get generated fresh
  on the box by `setup-commands.sh`.
- `init-data.sh` — creates the non-root Postgres user on first boot.
- `setup-commands.sh` — the deploy, in numbered blocks. **Run block by block**, never as one
  blind script.

## Oracle-specific gotchas (read before deploying)

1. **Two firewalls, not one.** You must open ports 80/443 in the OCI console (Networking →
   VCN → Security Lists → Default → Add Ingress Rules, source `0.0.0.0/0`) *and* on the VM
   itself. Oracle's Ubuntu images ship with an iptables REJECT rule that silently blocks
   everything except SSH — Block 5 of `setup-commands.sh` handles the VM side. Forgetting the
   console side is the most common "my server doesn't work" cause.
2. **Pick an Always-Free-eligible shape**: `VM.Standard.A1.Flex` with at most 4 OCPU / 24 GB
   total across your instances. The console labels eligible options "Always Free eligible".
3. **Save the SSH private key** at instance creation — Oracle shows it once. Without it you
   cannot reach your own server and would have to rebuild the VM.
4. **ARM capacity errors are common.** "Out of host capacity" is Oracle being full, not
   anything you did wrong — retry later, or at a different availability domain.

## If you ever switch to a paid VPS

Nothing here changes. The same files deploy identically to Hetzner/DigitalOcean/etc. — only
`DOMAIN_NAME`/`SUBDOMAIN` in `.env` and the DNS record differ, and Block 5's iptables step
becomes unnecessary (plain `ufw` is enough).
