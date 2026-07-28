# فيها خير — 24/7 AI reply system

Answers Instagram, Facebook, YouTube and TikTok comments and DMs in the owner's own
Moroccan Darija, and moves interested people to WhatsApp — which is where the workshop
actually sells.

Runs on **Google Apps Script**: free, no server, no domain, no credit card, and it keeps
running whether or not your computer is on.

## Start here

| | |
|---|---|
| **[`4-apps-script/SETUP.md`](./4-apps-script/SETUP.md)** | Deploy it. Start here. |
| [`PROMPT.md`](./PROMPT.md) | Paste into a fresh Claude Code session to continue work |
| [`1-voice-profile/reply-playbook.md`](./1-voice-profile/reply-playbook.md) | How it writes |
| [`3-workflows/facts-for-ai.md`](./3-workflows/facts-for-ai.md) | The only facts it may state |
| [`skills/darija/`](./skills/darija/) | Portable Darija writing skill |

## Layout

```
4-apps-script/   the live system   (run `node test.js` after any change — 82 assertions)
1-voice-profile/ voice + what 708 real posts measured
3-workflows/     facts-for-ai.md — the product facts
5-website/       public site, scaffolded, no page yet
skills/          portable Claude Code skills built from this project
archive/         earlier architectures, kept as fallback
```

`build-system-prompt.py` compiles the playbook and the facts into `system-prompt.txt` and
`4-apps-script/SystemPrompt.gs`. Edit the two sources, never the output.
