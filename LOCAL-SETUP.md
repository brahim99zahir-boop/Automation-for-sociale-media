# Running Claude Code on your own PC

This gives Claude your real files and your real browser — Instagram and Google already
logged in — instead of a cloud container that can reach neither.

It also sets the limits that make that safe. **Read section 5 before starting a loop.**
Full control plus an unsupervised loop is the combination that goes wrong, and you asked to
be secure, so the guardrails are part of the setup rather than an optional extra.

---

## 1. Install (once)

**Node.js** — nodejs.org, the LTS button, run the installer. Then close PowerShell and open
it again, or `npm` won't be found.

```powershell
node -v
npm -v
npm install -g @anthropic-ai/claude-code
```

**Get the project:**

```powershell
git clone https://github.com/brahim99zahir-boop/Automation-for-sociale-media
cd Automation-for-sociale-media
```

No git? Download the ZIP from GitHub (green **Code** button), extract it, `cd` into it.

## 2. Your real browser, with your real logins

Close Chrome completely — check the system tray. Then:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

The `&` is required in PowerShell for a quoted path. If that path errors, try
`C:\Program Files (x86)\...`.

Chrome opens normally, still signed into everything. Now connect Claude to that exact
window rather than a new empty one:

```powershell
claude mcp add playwright -- npx "@playwright/mcp@latest" --cdp-endpoint http://localhost:9222
```

**No password is ever typed or stored.** It attaches to the session you already have.

## 3. Permission rules — set these before the loop

Create `~/.claude/settings.json` (Windows: `C:\Users\<you>\.claude\settings.json`):

```json
{
  "permissions": {
    "allow": [
      "Bash(node test.js)",
      "Bash(npm test*)",
      "Bash(python3 build-system-prompt.py)",
      "Bash(git status*)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git add*)",
      "Bash(git commit*)",
      "Read", "Grep", "Glob"
    ],
    "deny": [
      "Bash(rm -rf*)",
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git reset --hard*)",
      "Bash(git clean*)",
      "Read(./config.local.md)",
      "Read(**/.env)",
      "Read(**/id_rsa*)"
    ]
  }
}
```

What this buys you: tests, builds and commits run without interrupting you, while the
commands that destroy work are refused outright — mid-loop included, even if I think
they're a good idea. The `Read` denies keep your API keys out of the conversation entirely.

You already have the `git-guardrails-claude-code` skill installed. Run it once and it adds
hooks that block destructive git commands below the settings layer.

## 4. The loop

```powershell
claude
```

Then:

```
/loop run node test.js, fix what fails, commit when green
```

`/loop` with no interval lets it pace itself. `/loop 30m <task>` runs every 30 minutes.

**It isn't infinite, and it shouldn't be.** It stops when the task is done, when it hits a
permission wall, or when you press Esc. A loop with no stop condition burns money on an
endless task — the API bill is per token whether the work is useful or not.

Good loop tasks have a finish line:

```
/loop run node test.js, fix failures, stop when 122 pass
/loop review 4-apps-script/ with ponytail-review, apply what is safe, stop when clean
```

Bad loop task, unbounded spend:

```
/loop make the automation better
```

## 5. Your own security

The parts that protect **you**, not the code:

**Never paste an API key into a chat.** Not to me, not anywhere. Put it in `setSecrets()`,
run it, delete it. If one has ever been pasted, revoke it at console.anthropic.com — it
takes ten seconds, and a leaked key gets spent by someone else on your card.

**The dashboard URL is a password.** Anyone holding it sees your customers and can switch
your automation off. Don't put it in a WhatsApp group. If it leaks, run
`resetDashboardToken`.

**Close the debug Chrome when you're done.** `--remote-debugging-port=9222` accepts
commands from anything running on your machine. Fine on your own PC at home; don't leave it
open on café wifi.

**Keep `DRAFT_ONLY_MODE` on** until you have read ~20 drafts and agreed with them. It is
the difference between a bad reply you delete and a bad reply your customers screenshot.

**Never let a loop post to social media.** Instagram and TikTok ban accounts for automated
commenting from a logged-in session, and a loop makes that mistake at machine speed. Use
the browser for Apps Script setup, Meta forms and Google Business Profile — not for
posting. Your TikTok is 708 posts and 10.6M views; that is not worth risking to save
copy-paste.

**Read the diff before pushing.** `git diff` costs thirty seconds. A loop that ran
unattended has made decisions you have not seen.

## 6. What still is not automatic

Even with full control, Claude asks before acting and does not run while you are away
unless you start a loop. That is the same design that stops it doing something you did not
intend.

If you want work happening while you sleep, the Apps Script automation already does that on
Google's servers. This setup is for building, not for running.
