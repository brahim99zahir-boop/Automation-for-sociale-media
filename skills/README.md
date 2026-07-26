# Skills

Portable Claude Code skills built out of this project.

## `darija`

Writing natural Moroccan Darija — Arabic script, Arabizi, or French — without the register
mistakes that make text read as machine-translated.

This is the voice half of `1-voice-profile/reply-playbook.md`, generalised so it works
anywhere, not only inside the moustiquaire automation. The business-specific facts (prices,
colours, delivery) deliberately stay in `3-workflows/facts-for-ai.md` — the skill teaches
*how* to write, not *what* is true about the workshop.

Everything in it came from correcting real failures against a native speaker, not from a
style guide.

### Install

Copy it into your personal skills folder, on the machine where you run Claude Code:

```bash
mkdir -p ~/.claude/skills
cp -r skills/darija ~/.claude/skills/
```

Restart Claude Code. It then loads automatically whenever you write or review Darija — no
need to invoke it by name.

To use it in a single project instead of everywhere, copy it to `.claude/skills/` inside
that project.
