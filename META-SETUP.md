# Getting the Instagram token

Written while doing it, 30 July 2026, including what went wrong. Everything here was hit
for real — none of it is guesswork.

## Prerequisites — both were already satisfied

- `@fiha_khir13` is a **Professional** account (Public, 1K+ followers)
- It is **linked to a Facebook Page**: `fiha khir فيها خير`

Check at: Instagram → Edit profile → Public business information → **Facebook**. If that row
is empty, link a Page first — every Instagram permission routes through it.

## Meta developer access is NOT blocked in Morocco

This was assumed for a while and it is wrong. An app called **Automation** was created from
Morocco with no business verification, no documents, no review.

**Keep the app in Development Mode.** In that mode permissions apply to your own accounts,
which is the entire use case here. App Review is only for acting on other people's accounts.

## Two routes — they are not interchangeable

Under **developers.facebook.com/apps → Automation → Instagram**:

| | Host | Permission names | Addresses account as |
|---|---|---|---|
| **Instagram login** ← used here | `graph.instagram.com` | `instagram_business_*` | `me` |
| Facebook login | `graph.facebook.com` | `instagram_*` | numeric id |

**The code follows whichever you pick.** `Platforms.gs` was written for the Facebook host;
after this account was set up through the Instagram route, the Instagram adapter was moved
to `graph.instagram.com`. Left unchanged, every Instagram call would have failed with an
auth error that looks exactly like a bad token.

If you ever redo this through the Facebook route, `Platforms.gs` has to move back.

### The steps that worked

1. `developers.facebook.com/apps` → **Automation**
2. Left menu → **Instagram** → **API setup with Instagram login**
3. Box **1 — إضافة أذونات المراسلة المطلوبة** → adds
   `instagram_business_basic`, `instagram_business_manage_comments`,
   `instagram_business_manage_messages`
4. Box **2 — إنشاء رموز الوصول** → **إضافة حساب** → log into Instagram → approve
5. The account appears with its id. Here: `17841450239613283` → that is `igUserId`
6. **إنشاء رمز** next to the account → this is the token

Boxes **3 (Webhooks)** and **5 (App Review)** are not needed. Webhooks require a published
web-app URL; polling every 15 minutes works without them.

### Alternative: Graph API Explorer

```
developers.facebook.com/tools/explorer
```

Meta App → `Automation`, **Get User Access Token**, tick `instagram_basic`,
`instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`,
`pages_read_engagement`. This issues a **Facebook-host** token instead, so only use it if
`Platforms.gs` is pointed back at `graph.facebook.com`.

To read the IG user id there: `me/accounts?fields=instagram_business_account,name`

## What went wrong, and the fixes

**The Instagram app hijacks the login link on Android.** Tapping *Add account* opened the
Instagram app at the normal feed and the flow died silently. Fix:

> Settings → Apps → Instagram → **Set as default** → *Open supported links* → **Don't allow**

Then retry in Chrome. Revert afterwards if you like.

**Logging in from a browser triggers a security check.** Instagram sees a new session while
you are signed in on the app. Open the app, approve the *"Was this you?"* notification,
retry.

**Password accepted but nothing happened.** Same root cause as above — the flow was never
completing in the browser.

**A Google `redirect_uri_mismatch 400` appeared.** Unrelated to Meta: the URL was
`accounts.google.com`. Meta never uses Google sign-in, so seeing that means you have
navigated out of the Meta flow. Go back to `developers.facebook.com/apps`.

**Do it on a computer.** The phone fought back at every step — app hijacking, copy-pasting
very long tokens, and the browser and app competing over the same account.

## Two Google accounts — pick one

Both appeared during setup:

- `brahim99zahir@gmail.com` — what `CONFIG.OWNER_EMAIL` is set to
- `kabirmonan123@gmail.com` — signed into the computer's browser

Apps Script, the spreadsheet and the approval emails must all be the **same** account. If
you use the second one, change `OWNER_EMAIL` in `Config.gs`.

## Once you have the token

**Never paste it into a chat.** It can post as you.

1. Apps Script → `Config.gs` → `setSecrets()` → paste into `metaToken`
2. Run `setSecrets`
3. Delete the pasted value, save again
4. `igUserId` is already set to `17841450239613283`
5. Switch Instagram on from the dashboard

Tokens from this route are long-lived but not permanent. If Instagram calls start failing
with an auth error months from now, regenerate at box 2 rather than assuming the code broke.

## Worth fixing while you are in there

Instagram → Edit profile → **Category** currently reads **Reel creator**.

That is a creator category, not a workshop. Two costs: Creator accounts have narrower
messaging permissions than Business ones, so a permission may be refused later for this
reason; and nobody searching *moustiquaire Agadir* finds a "Reel creator".

Change to **Home Improvement** or **Product/Service**. Costs nothing.
