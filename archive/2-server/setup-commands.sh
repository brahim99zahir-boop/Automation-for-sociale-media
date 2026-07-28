#!/bin/bash
# n8n server setup — run this BLOCK BY BLOCK over SSH, never blind-piped as one script.
# Each numbered block is a checkpoint: read the output before moving to the next one.
# Assumes a fresh Ubuntu 24.04 VPS (Hetzner CX22 or similar) and that you already:
#   - bought the VPS and have SSH access (user@server-ip, root or sudo)
#   - own a domain and can edit its DNS
#   - created an A record: n8n.<yourdomain> -> <server public IP>
#
# Reference: this mirrors the `n8n-self-hosting` Claude Code skill's deploy flow
# (single mode + Postgres — see 2-server/docker-compose.yml for why Postgres).

set -e  # stop on first error in whichever block you're running

##############################################################################
# BLOCK 1 — Preflight: confirm DNS actually points here before anything else.
# If these two values don't match, STOP and fix the DNS A record first —
# Caddy's automatic HTTPS will fail otherwise.
##############################################################################
curl -s ifconfig.me; echo
dig +short n8n.YOURDOMAIN.COM
# ^ replace YOURDOMAIN.COM. The two outputs above must be the same IP.

##############################################################################
# BLOCK 2 — Install Docker (skip if `docker --version` already works)
##############################################################################
curl -fsSL https://get.docker.com | sh
docker compose version   # must print a version; if not, stop and diagnose

##############################################################################
# BLOCK 3 — Lay down the project directory + transfer the template files
# Run the scp lines from YOUR machine (not the server), after cloning/pulling
# this repo locally. Replace user@server-ip and the paths as needed.
##############################################################################
mkdir -p /opt/n8n/caddy_config /opt/n8n/local_files
# --- from your local machine ---
# scp 2-server/docker-compose.yml   user@server-ip:/opt/n8n/docker-compose.yml
# scp 2-server/Caddyfile            user@server-ip:/opt/n8n/caddy_config/Caddyfile
# scp 2-server/init-data.sh         user@server-ip:/opt/n8n/init-data.sh
# scp 2-server/.env.example         user@server-ip:/opt/n8n/.env
chmod +x /opt/n8n/init-data.sh

##############################################################################
# BLOCK 4 — Fill in .env + generate fresh secrets ON THIS BOX
##############################################################################
cd /opt/n8n
# Edit these by hand first: DATA_FOLDER=/opt/n8n, DOMAIN_NAME, SUBDOMAIN=n8n,
# SSL_EMAIL, GENERIC_TIMEZONE=Africa/Casablanca, POSTGRES_USER/DB/NON_ROOT_USER
# (defaults in .env.example are fine for those last three).

# Generate + substitute the three REPLACE_WITH_ secrets:
KEY=$(openssl rand -base64 32)
sed -i "s|^N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=${KEY}|" .env

PGPASS=$(openssl rand -base64 24)
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PGPASS}|" .env

PGNONROOTPASS=$(openssl rand -base64 24)
sed -i "s|^POSTGRES_NON_ROOT_PASSWORD=.*|POSTGRES_NON_ROOT_PASSWORD=${PGNONROOTPASS}|" .env

# Confirm nothing was missed:
grep REPLACE_WITH_ .env   # MUST print nothing before continuing
chmod 600 .env

echo "=================================================================="
echo "[HUMAN] Save this N8N_ENCRYPTION_KEY in a password manager NOW:"
echo "$KEY"
echo "It will not be shown again by this script. Losing it makes every"
echo "saved credential undecryptable — there is no recovery without it."
echo "=================================================================="

##############################################################################
# BLOCK 5 — Firewall: only SSH + 80 + 443 reach this box
##############################################################################
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
ufw status

# --- ORACLE CLOUD ONLY: also punch through Oracle's own iptables rules ---
# Oracle's Ubuntu images ship with a REJECT rule that blocks everything except
# SSH, INDEPENDENTLY of ufw. Skip this block on Hetzner/DigitalOcean/etc.
# Symptom if skipped: ufw looks correct, the containers are healthy, but the
# site times out from outside and Caddy can never obtain a certificate.
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
# Persist across reboots (otherwise the rules vanish on the next restart):
apt-get install -y iptables-persistent   # answer "yes" to saving current rules
netfilter-persistent save

# REMINDER: the OCI *console* firewall is separate and must ALSO allow 80/443:
#   Networking -> your VCN -> Security Lists -> Default -> Add Ingress Rules
#   Source 0.0.0.0/0, IP Protocol TCP, Destination Port Range 80 then 443.
# Both layers must be open. This is the most common Oracle deployment failure.

##############################################################################
# BLOCK 6 — Launch
##############################################################################
cd /opt/n8n
docker compose up -d
docker compose ps   # caddy, postgres, n8n should all be Up (postgres: healthy)

##############################################################################
# BLOCK 7 — Verify, in order. Don't declare success without all four.
##############################################################################
# 7a. n8n itself is running (internal check, bypasses TLS/DNS entirely):
docker compose exec n8n wget -qO- http://localhost:5678/healthz
# -> {"status":"ok"}

# 7b. Certificate issued (first boot: allow 1-2 minutes for ACME):
docker compose logs caddy | grep -i 'certificate obtained'

# 7c. Publicly reachable over HTTPS (retries cover the ACME delay):
curl -fsS --retry 5 --retry-delay 10 https://n8n.YOURDOMAIN.COM/healthz
# -> {"status":"ok"}

# 7d. [HUMAN] Open https://n8n.YOURDOMAIN.COM in a browser IMMEDIATELY and
#     create the owner account — whoever completes that form first claims
#     the instance. Then: enable 2FA. Then: Settings -> API -> create an
#     n8n API key and hand it to Claude Code for the next phase (importing
#     and configuring the 3 workflows in 3-workflows/).

##############################################################################
# BLOCK 8 — One-time: create the app tables the workflows use
# (yt_seen_comments / yt_poll_state / pending_reviews — see the "Config" node
# in 3-workflows/01-comment-reply-engine.json for how they're referenced)
##############################################################################
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_NON_ROOT_USER" -d "$POSTGRES_DB"' << 'SQL'
CREATE TABLE IF NOT EXISTS yt_poll_state (
  channel_id text PRIMARY KEY,
  last_checked_at timestamptz
);
CREATE TABLE IF NOT EXISTS yt_seen_comments (
  comment_id text PRIMARY KEY,
  processed_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pending_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  comment_id text NOT NULL,
  post_id text,
  draft_reply text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);
SQL

##############################################################################
# ONGOING — weekly backup (cron this)
##############################################################################
# cd /opt/n8n && \
#   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
#   | gzip > /opt/backups/n8n-db-$(date +%F).sql.gz
# Also copy .env (holds the encryption key) somewhere safe, off this box.

##############################################################################
# ONGOING — monthly update
##############################################################################
# cd /opt/n8n && docker compose pull && docker compose up -d
# docker compose exec n8n n8n --version   # confirm it moved
