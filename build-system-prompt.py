#!/usr/bin/env python3
"""
Builds system-prompt.txt (the AI's brain) and 4-apps-script/SystemPrompt.gs.

Sources:
  1-voice-profile/reply-playbook.md   -> HOW it talks and sells (strategy + anti-slop voice)
  3-workflows/facts-for-ai.md         -> WHAT it knows (the only facts it may state)

Note there are two FAQ-ish files, on purpose:
  product-faq.md  is for the humans maintaining this project — it carries open questions,
                  supersession history, and "confirm with the owner" notes.
  facts-for-ai.md is what the model actually reads — facts only, no project chatter, so it
                  can never repeat internal notes at a customer.
Keep them in sync by hand when a fact is confirmed.

Run this after editing either source:
    python3 build-system-prompt.py
"""

import pathlib

ROOT = pathlib.Path(__file__).parent

OUTPUT_CONTRACT = """
---

# HOW TO ANSWER (output format)

Respond with a raw JSON object and NOTHING else. No ```json fences, no explanation before or
after, no reasoning out loud. Your whole response starts with { and ends with }.

{"reply": "...", "needs_human": true|false, "client_type": "...", "lead": "..."}

**reply** — what gets posted publicly, following every rule above. Keep it short.
Return an empty string "" if the comment is spam, a bare tag, or just emoji — nothing worth
replying to.

**client_type** — exactly one of:
"مهتم بالشراء"        wants to order, asks how to buy
"سؤال عن الثمن"       asks about price
"استفسار عن التوصيل"  asks about delivery or shipping
"شكوى"                complaint or problem — always needs_human true
"زبون سعيد"           compliment or praise
"سؤال عام"            any other real question
"أخرى"                spam, tags, emoji only, not a real question

**lead** — how close this person is to buying:
"ساخن"  hot: wants to order now, asking how to pay, sending measurements, ready to move
"دافئ"  warm: real buying question — price, delivery to their city, sizes
"بارد"  cold: compliment, general curiosity, or not a customer question

**needs_human** — true ONLY when a human must see it before anything is posted:
- any complaint, anger, or problem with an existing order
- refund, return, or "where is my order"
- anything accusing the business of something
- anything you're genuinely unsure how to handle

Set needs_human FALSE for ordinary questions you can't fully answer (payment method, exact
delivery time, guarantee). Those are not risky — the correct reply is simply to bring them to
WhatsApp, and that reply is always safe to post.
"""


def main() -> None:
    playbook = (ROOT / "1-voice-profile" / "reply-playbook.md").read_text(encoding="utf-8")
    facts = (ROOT / "3-workflows" / "facts-for-ai.md").read_text(encoding="utf-8")

    # Drop the playbook's own maintenance header (everything before the first '---').
    playbook = playbook.split("---", 1)[1].strip() if "---" in playbook else playbook

    prompt = playbook + "\n\n---\n\n" + facts.strip() + "\n" + OUTPUT_CONTRACT

    (ROOT / "system-prompt.txt").write_text(prompt, encoding="utf-8")

    # Mirror into the Apps Script file as a JS template literal.
    esc = prompt.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    gs = (
        "/**\n"
        " * SystemPrompt.gs — the AI's brain: sales strategy, Darija voice rules, and the\n"
        " * product facts it is allowed to state.\n"
        " *\n"
        " * GENERATED FILE — do not edit here, your changes will be overwritten.\n"
        " * Sources: 1-voice-profile/reply-playbook.md (how it talks)\n"
        " *          3-workflows/product-faq.md        (what it knows)\n"
        " * Rebuild:  python3 build-system-prompt.py\n"
        " */\n\n"
        "const SYSTEM_PROMPT = `" + esc + "`;\n"
    )
    (ROOT / "4-apps-script" / "SystemPrompt.gs").write_text(gs, encoding="utf-8")

    print(f"system-prompt.txt      {len(prompt):>6} chars")
    print(f"SystemPrompt.gs        {len(gs):>6} chars")


if __name__ == "__main__":
    main()
