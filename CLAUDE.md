# CLAUDE.md

Loaded automatically every session. **Keep it short** — every line is re-sent on every
message, so a bloated file costs exactly what it is meant to save.

## What this is

24/7 AI reply system for **فيها خير**, an Agadir workshop making made-to-measure mosquito
screens (موستكير). Sells on WhatsApp **0666567672**. Runs free on Google Apps Script,
whether or not the owner's PC is on.

Live code: `4-apps-script/`. Run `node test.js` there after any change — **186 assertions**.

## Standing behaviour — do this without being asked

**Be lazy (ponytail).** Simplest thing that works. Reuse what's here before writing new.
Stdlib before a dependency. One line before fifty. Deletion over addition. Name what you
skipped in one line, not a paragraph.

**Verify, don't assert.** Run it, grep it, check the docs. If it can't be checked, say so
plainly instead of claiming it works. This project has been hurt more by confident wrong
answers than by missing features.

**Be short.** No flattery, no preamble, no restating the question. If the explanation is
longer than the code, delete the explanation.

**Say when the owner is wrong.** Finding that the automation quoted prices appearing in
none of his 708 posts was worth more than any feature. Do that again.

**Ask before changing a business number or fact.** Guessing costs him money.

## Keeping token cost down

Ranked by what actually saves most here:

1. **Don't re-read files already in context.** Check first. Biggest win by far.
2. **Grep for the specific thing** instead of reading a whole file to find one function.
3. **Don't paste file contents into the reply.** Reference `path:line`.
4. **Don't spawn subagents** unless asked. Each starts cold and re-derives context.
5. **Don't bulk-install plugins.** ~480 skills are installed; more makes the right one less
   likely to fire.

**On `graphify`** (installed, with `graphify-mcp`): it answers "where is X / what calls Y /
how does this connect" by querying a code graph instead of reading files. Real saving on a
large codebase.

**This is not a large codebase.** `4-apps-script/` is six `.gs` files sharing one global
scope. Indexing them and querying a graph costs more than a single `grep`. So: **grep here;
graphify when a question genuinely spans many files.** Reaching for the heavier tool on a
small repo is the opposite of lazy, and the owner asked for low cost.

## Skills worth reaching for

| When | Skill |
|---|---|
| Writing or checking Darija | `darija` (built from this project's own corrected rules) |
| Repo feels bloated | `ponytail-audit` |
| Reviewing a change | `ponytail-review`, `code-review` |
| Public endpoint, secrets | `security-review` |
| Content strategy | `marketing-skills` |

Everything else installed is for domains this project doesn't have. Ignore it.

## Hard rules — every one came from a real failure

1. **Never invent a product fact.** Materials, lifespan, delivery time, guarantee length —
   if it isn't in `3-workflows/facts-for-ai.md`, bridge to WhatsApp. The model has been
   caught inventing specs, and a wrong answer lands on the workshop after the customer paid.
2. **Never answer "واه" to a feature question you can't verify.**
3. **Match the customer's script.** Arabic → Arabic, Arabizi → Arabizi, French → French.
   Never mix alphabets inside a sentence. Enforced in code (`detectScript_`,
   `scriptIsClean_`) because prompt rules alone held only 5 times in 9.
4. **No tashkeel, no dashes, no curly quotes, no ellipsis characters.** Instant bot tells.
5. **Prices: العادي 550 / المضلم 650 / المزدوج 750 per m².** 439, 440 and 470 are صولد
   prices — never quote them as standard. Sides under 100 سم bill as 100. 200×150+ adds
   130 for جوج بيبان. Delivery 60 **per screen**; installation 150 per screen, always
   added in Agadir **on top of** delivery. The maths lives in `Code.gs` `quote_()` — the
   model is never asked to multiply.
6. **Phone: 0666567672 only.** Not 0674191830.
7. **Enforce in code what matters.** Every prompt-only rule here eventually failed. If it
   costs a customer when it breaks, guard it in code as well.
8. **Never commit secrets.** They live in Script Properties. `config.local.md` is ignored.

## Where things are

```
4-apps-script/     live system + test.js + ALL-IN-ONE.gs (one-paste deploy)
1-voice-profile/   voice rules + what 708 real posts measured
3-workflows/       facts-for-ai.md — the only product facts
skills/darija/     portable Darija skill
archive/           superseded architectures, kept as fallback
```

`build-system-prompt.py` compiles the playbook and facts into `system-prompt.txt`,
`SystemPrompt.gs` and `ALL-IN-ONE.gs`. **Edit the sources, never the outputs.**

## Open

- Anthropic API key returns **401** — nothing runs until it is replaced
- Instagram token works only on `graph.instagram.com`; Facebook needs its **own** Page
  token (`FACEBOOK_PAGE_TOKEN`) from the Facebook-login route, and the Page id
- Owner reviews the first 30 drafts by replying to the approval email; at 30 the system
  drops `DRAFT_ONLY_MODE` and `ALWAYS_ASK_APPROVAL` on its own (`countReview_`)
- Instagram and TikTok APIs unavailable; screenshot and voice modes work without them
- Unconfirmed: انوكس 304L as the material, the 2/1 model, delivery time
  (the 130 درهم item turned out to be the جوج بيبان supplement — answered 31 July)

## The thing that matters more than code

Product posts average **47,294 views**. Everything else **10,960**. Product is **78 of
708**. The best post ever is a plain installation walkthrough at **1.2M**. When he asks for
more features, remind him that posting more موستكير content beats all of it.
