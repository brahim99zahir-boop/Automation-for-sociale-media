/**
 * Config.gs — all settings in one place.
 *
 * SECRETS DO NOT GO IN THIS FILE. They live in Script Properties, so they are
 * never committed to git and never visible in the shared code.
 * Set them once by running setSecrets() (see bottom of this file), then DELETE
 * the values you typed there and save again.
 */

const CONFIG = {
  // Where approval emails and error alerts are sent.
  OWNER_EMAIL: 'brahim99zahir@gmail.com',

  // The Google Sheet used as the Arabic client log.
  // Leave blank on first run — setupSheet() creates a sheet and prints the ID
  // for you to paste here.
  SPREADSHEET_ID: '',
  SHEET_NAME: 'العملاء',

  // Instagram / Facebook. Fill these after the Meta app step (GUIDE.md §6).
  IG_USER_ID: '',
  FB_PAGE_ID: '',

  // Claude model. Haiku is the cheap one — do not change without checking cost.
  CLAUDE_MODEL: 'claude-haiku-4-5',
  ANTHROPIC_VERSION: '2023-06-01',

  // How many recent posts to scan for new comments on each polling run.
  // Higher = catches comments on older posts, but uses more API calls.
  MEDIA_TO_SCAN: 5,

  // Safety switch. While true, NOTHING is ever posted publicly — replies are
  // only drafted, logged, and emailed to you. Keep this true until you have
  // watched the system work for a while (this is the master prompt's
  // "training weeks" rule). Flip to false only when you trust the drafts.
  DRAFT_ONLY_MODE: true,

  // While true, every reply goes to you for approval, even harmless ones.
  // Set false once ~9/10 drafts are passing untouched.
  ALWAYS_ASK_APPROVAL: true,

  // Meta webhook verification token — any string you choose; it must match
  // exactly what you type into the Meta App webhook screen.
  META_VERIFY_TOKEN: 'fihakhir-webhook-2026',
};

/** Property keys (internal — no need to change). */
const PROP = {
  ANTHROPIC_KEY: 'ANTHROPIC_API_KEY',
  META_TOKEN: 'META_ACCESS_TOKEN',
  SEEN_IDS: 'SEEN_COMMENT_IDS',
  PENDING_PREFIX: 'pending_',
};

/**
 * ONE-TIME SETUP: paste your secrets between the quotes, click Run, then
 * DELETE them from this function and save again so they aren't left in the code.
 * They are stored in Script Properties, which is not part of the source file.
 */
function setSecrets() {
  const props = PropertiesService.getScriptProperties();

  const anthropicKey = '';   // <-- paste Anthropic API key here, run, then clear
  const metaToken = '';      // <-- paste Meta long-lived Page token here

  if (anthropicKey) props.setProperty(PROP.ANTHROPIC_KEY, anthropicKey);
  if (metaToken) props.setProperty(PROP.META_TOKEN, metaToken);

  const stored = props.getKeys();
  Logger.log('Stored secret keys: ' + JSON.stringify(stored));
  Logger.log('Anthropic key set: ' + !!props.getProperty(PROP.ANTHROPIC_KEY));
  Logger.log('Meta token set: ' + !!props.getProperty(PROP.META_TOKEN));
  Logger.log('Now DELETE the pasted values above and save this file again.');
}

function getSecret_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing secret: ' + key + ' — run setSecrets() first.');
  return v;
}
