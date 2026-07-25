/**
 * Config.gs — all settings in one place.
 *
 * SECRETS DO NOT GO IN THIS FILE. They live in Script Properties, so they are
 * never committed to git and never visible in the shared code.
 * Set them once by running setSecrets() (see bottom), then DELETE the values you
 * typed there and save again.
 */

const CONFIG = {
  // Where approval emails, error alerts, and the daily summary are sent.
  OWNER_EMAIL: 'brahim99zahir@gmail.com',

  // ---- WhatsApp: the whole point of the system is to send people here ----
  // Local form, written inside public replies exactly like this.
  WHATSAPP_DISPLAY: '0666567672',
  // International form (no +, no spaces) used to build clickable wa.me links.
  WHATSAPP_INTL: '212666567672',

  // The Google Sheet used as the Arabic client log.
  // Leave blank on first run — setupSheet() creates it and prints the ID to paste here.
  SPREADSHEET_ID: '',
  SHEET_NAME: 'العملاء',

  // Instagram / Facebook. Fill after the Meta app step.
  IG_USER_ID: '',
  FB_PAGE_ID: '',

  // Claude model. Haiku is the cheap one — do not change without checking cost.
  CLAUDE_MODEL: 'claude-haiku-4-5',
  ANTHROPIC_VERSION: '2023-06-01',

  // How many recent posts to scan for new comments per run.
  MEDIA_TO_SCAN: 5,

  // ---- Safety switches ----
  // While true, NOTHING is ever posted publicly — replies are drafted, logged and
  // emailed to you only. Keep true until you trust the drafts.
  DRAFT_ONLY_MODE: true,

  // While true, every reply waits for your approval, even harmless ones.
  // Set false once ~9/10 drafts are good as-is.
  ALWAYS_ASK_APPROVAL: true,

  // ---- Private replies (DM) ----
  // Instagram lets a business send ONE private message in response to a comment.
  // This is the highest-converting feature here: the public reply stays short, and
  // the DM carries a tappable wa.me link that opens WhatsApp with the message
  // already written. Requires the pages_messaging permission on your Meta app.
  // Leave false until the public replies are working; turn on afterwards.
  SEND_PRIVATE_REPLY: false,

  // Send a daily summary of leads at ~20:00. Turn off if you don't want it.
  DAILY_SUMMARY: true,

  // Meta webhook verification token — any string you choose; must match exactly
  // what you type into the Meta App webhook screen.
  META_VERIFY_TOKEN: 'fihakhir-webhook-2026',
};

/**
 * Topics the AI has no confirmed facts about. If a customer's comment mentions one,
 * the reply is held for your approval no matter what — because the model has been
 * observed inventing a confident "yes" to questions like "do you make sliding ones?".
 * The prompt tells it not to; this is the seatbelt in case it does anyway.
 *
 * Once you give me the real answers, they move into facts-for-ai.md and come OUT of
 * this list, so the AI can answer them instantly on its own.
 */
const UNVERIFIED_TOPICS = [
  'ضمان',        // guarantee
  'لون', 'ألوان', 'الوان',   // colours
  'منزلق', 'منزلقة',          // sliding
  'كادر', 'إطار',             // frame
  'مصنوع', 'من اش', 'مناش',   // what it's made of
  'حديد', 'بلاستيك', 'ألمنيوم', 'الومنيوم',
  'كيدوم', 'يدوم',            // how long it lasts
  'ترجيع', 'إرجاع',           // returns
];

/** Property keys (internal — no need to change). */
const PROP = {
  ANTHROPIC_KEY: 'ANTHROPIC_API_KEY',
  META_TOKEN: 'META_ACCESS_TOKEN',
  SEEN_IDS: 'SEEN_COMMENT_IDS',
  PENDING_PREFIX: 'pending_',
};

/**
 * ONE-TIME SETUP: paste your secrets between the quotes, click Run, then DELETE
 * them from this function and save again. They're stored in Script Properties,
 * which is not part of the source file.
 */
function setSecrets() {
  const props = PropertiesService.getScriptProperties();

  const anthropicKey = '';   // <-- paste Anthropic API key, Run, then clear
  const metaToken = '';      // <-- paste Meta long-lived Page token

  if (anthropicKey) props.setProperty(PROP.ANTHROPIC_KEY, anthropicKey);
  if (metaToken) props.setProperty(PROP.META_TOKEN, metaToken);

  Logger.log('Anthropic key set: ' + !!props.getProperty(PROP.ANTHROPIC_KEY));
  Logger.log('Meta token set: ' + !!props.getProperty(PROP.META_TOKEN));
  Logger.log('Now DELETE the pasted values above and save this file again.');
}

function getSecret_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing secret: ' + key + ' — run setSecrets() first.');
  return v;
}
