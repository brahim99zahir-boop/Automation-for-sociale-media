---
name: darija
description: Write natural Moroccan Darija that doesn't read as machine-translated — in Arabic script, in Latin letters (Arabizi), or French, matching whichever the other person used. Use whenever writing or reviewing Darija for Moroccan readers: social replies, WhatsApp messages, ads, captions, product copy, or customer service. Also use when asked to check whether Darija text sounds like a bot.
---

# Writing Moroccan Darija that sounds human

Machine Darija is easy to spot and Moroccans spot it instantly. Once they do, they stop
trusting whoever wrote it. The failure mode is almost never grammar — it's **register**:
the text is too formal, too long, too polite, and too obviously assembled.

Everything here comes from correcting a real system's real mistakes against real Moroccan
readers, not from a style guide.

## Rule 1 — Darija is not Modern Standard Arabic

The most common mistake is writing MSA and calling it Darija. MSA in a WhatsApp message
reads like a government form.

Words that make text read as genuinely Moroccan:

واخا، صافي، دابا، بزاف، شحال، كاين، غادي، ديال، بغيتي، صيفط، عافاك، زوين، مزيان، شوف، هاد،
فين، كيفاش، واش، تبارك الله، الله يخليك، إن شاء الله، مرحبا، سمح ليا، خويا، ماشي، والو

## Rule 2 — No tashkeel, ever

Write `شكرا`, never `شكرًا`. Diacritics are the single clearest bot tell in Arabic — no one
types them on a phone. This includes ً ٌ ٍ َ ُ ِ ّ ْ.

## Rule 3 — No dashes, no typographic characters

Never `—`, `–`, or `--`. Nobody types an em-dash on a phone keyboard, in any language. Use a
full stop, a comma, or start a new sentence.

Also banned: curly quotes (" " ' '), the ellipsis character (…), bullet symbols (•). Plain
keyboard characters only. This applies to Arabic, Arabizi and French alike.

## Rule 4 — Match their script

Moroccans write Darija three ways. Mirror whichever they used. Replying in the wrong script
is the most obvious tell there is — a real person types back the way you typed to them.

| They wrote | Reply in | Money format |
|---|---|---|
| Arabic letters (`بشحال؟`) | Arabic letters | `470 درهم` |
| Latin letters (`chhal?`) | **Latin letters** | `470 dh` |
| French (`c'est combien?`) | French | `470 DH` |

**Never mix alphabets inside a sentence.** `wach bghit t3rf` is fine. `wach bghit tعrf` is
broken and reads as machine output. Not one Arabic letter inside a Latin word, not one Latin
word dropped into an Arabic sentence (borrowed brand names like whatsapp are the exception).

### Arabizi — the digit code

**3 = ع · 7 = ح · 9 = ق · 5 or kh = خ · 2 = ء · 8 = ه**

Stable spellings — use these rather than inventing a transliteration:

`chhal` شحال · `bghit` بغيت · `wach` واش · `kayn` كاين · `3afak` عافاك · `sift` صيفط ·
`l9ias` القياس · `dyal` ديال · `bzaf` بزاف · `mzyan` مزيان · `chouf` شوف · `daba` دابا ·
`khoya` خويا · `wakha` واخا · `safi` صافي · `ghadi` غادي · `nta/nti` نتا/نتي ·
`t9dr` تقدر · `3ndna` عندنا · `flous` فلوس · `taman` الثمن · `salam` سلام

Arabizi stays lowercase and lightly punctuated, same as the Arabic-script rules.

## Rule 5 — Phone message, not a letter

- **Short.** One or two sentences. Four words is often the perfect reply.
- **Light punctuation.** A message can end with no full stop at all.
- **Don't greet every time.** To a bare `بشحال؟`, answering `470 درهم للمتر` is more natural
  than opening with a full salaam. Greet people who greeted you.
- **Vary the shape.** If the last message opened with `السلام عليكم`, this one must not. Two
  consecutive messages with the same structure read as generated.
- **Numbers as digits**: `470 درهم`, not "أربعمائة وسبعون". No `.00` decimals. Say درهم, not
  MAD or DH, when writing Arabic.
- **One paragraph, no line breaks** for anything social. A blank line means it's too long.

## Rule 6 — Banned phrases

These are what make Arabic text obviously machine-written. Never use them:

- `شكرا لتواصلك معنا` / `شكرا لتواصلك`
- `لا تتردد في التواصل معنا` — the most recognisable bot phrase in Arabic
- `يسعدنا` / `نتشرف` / `بكل سرور` / `نتطلع`
- `نحن نقدم` / `نحن نوفر` / `خدماتنا`
- `عزيزي` / `عزيزتي` / `عميلنا العزيز`
- `مرحبا بك دائما` / `في خدمتك دائما`
- `نتمنى لك يوما سعيدا`
- Any sentence that exists only to be polite and carries no information

Also avoid: emoji spam (at most one, usually zero, never as an opener), ending every message
with a question, repeating the question back before answering, multiple exclamation marks,
and over-explaining with caveats nobody asked for.

## Rule 7 — Never write a word you're not sure is real Darija

A clumsy invented phrase destroys trust faster than a plain one. When unsure, use the
simplest words you know. Short and plain beats clever and wrong.

Real failures caught in production: `كل واحد كاعرفك`, `شوف المحطات ديالنا` — both are
nonsense to a native speaker and both came from reaching for a phrase that wasn't known.

## Rule 8 — Public and private are different rooms

- **Public comment**: seen by everyone. Short. Never repeat someone's private details or
  restate a complaint in public. It's a shop window.
- **Private message**: one to one. Slightly warmer and longer, may ask a direct question,
  may open with a greeting more often. Still 2 to 3 short lines maximum.

## Checking someone else's Darija

When asked to review Darija text, check in this order — the first three catch most of it:

1. Any tashkeel? → machine.
2. Any dash, curly quote or ellipsis character? → machine.
3. Script matches what it's replying to? Mixed alphabets inside a sentence?
4. Any banned phrase from Rule 6?
5. Read it aloud: would a real person type this on a phone between jobs?
6. Is every word actually Darija, or is something invented?

## When the writing is for a business

Two additions that matter more than they look:

**Never invent a fact.** Prices, delivery times, guarantee lengths, materials, what a product
is made of, what options exist — if it isn't written down, it isn't known. The pressure to
say "yes we do that" to make a sale is exactly where this breaks: the customer finds out
after they've paid, and it lands on the workshop. Say the honest version instead: that gets
decided directly.

**Never say "واه" to a feature question you can't verify.** واه is only for things actually
confirmed. For anything else: `هادشي كنشوفوه معاك` and move the conversation to where the
real answer lives.

**Give something real before redirecting.** A reply that is only "DM me" reads as evasive and
Moroccans dislike it. Answer the actual question with one concrete fact first, then bridge
with the reason you need them to move — then the contact detail. Fact, then reason, then
number.
