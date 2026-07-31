/**
 * Config.gs — all settings in one place.
 *
 * SECRETS DO NOT GO IN THIS FILE. They live in Script Properties, so they are never
 * committed to git and never visible in the shared code. Set them once by running
 * setSecrets(), then DELETE the values you typed and save again.
 */

const CONFIG = {
  // Where approval emails, error alerts, and the daily summary are sent.
  OWNER_EMAIL: 'brahim99zahir@gmail.com',

  // ---- WhatsApp: the whole point of the system is to send people here ----
  WHATSAPP_DISPLAY: '0666567672',      // written inside public replies exactly like this
  WHATSAPP_INTL: '212666567672',       // used to build clickable wa.me links

  // The Google Sheet used as the Arabic client log.
  // Leave blank on first run — setupSheet() creates it and prints the ID to paste here.
  SPREADSHEET_ID: '',
  SHEET_NAME: 'العملاء',

  // ---- Claude ----
  // Haiku answers everything and classifies the message in the same call. When it comes
  // back as a buyer or a complaint, the reply is written again on the stronger model —
  // about one message in ten, which is where the money is worth spending.
  CLAUDE_MODEL: 'claude-haiku-4-5',
  CLAUDE_MODEL_SMART: 'claude-sonnet-5',
  ANTHROPIC_VERSION: '2023-06-01',

  // How many drafts you review before the system starts posting on its own. Price
  // questions, complaints and unverified topics keep waiting for you even after that.
  AUTO_ENABLE_AFTER: 30,

  // ---- Safety switches ----
  // While true, NOTHING is ever posted or sent publicly — replies are drafted, logged
  // and emailed to you only. Keep true until you trust the drafts.
  DRAFT_ONLY_MODE: true,

  // While true, every reply waits for your approval, even harmless ones.
  // Set false once ~9/10 drafts are good as-is.
  ALWAYS_ASK_APPROVAL: true,

  // Send a daily summary of leads at ~20:00.
  DAILY_SUMMARY: true,

  // Meta webhook verification token — any string you choose; must match exactly what
  // you type into the Meta App webhook screen.
  META_VERIFY_TOKEN: 'fihakhir-webhook-2026',

  // How many recent posts/videos to scan per platform on each run.
  MEDIA_TO_SCAN: 5,
};

/**
 * ---- PLATFORMS ----
 * Turn a channel on only after its credentials are in place. Everything starts off.
 *
 * `comments` = read and reply to comments.
 * `dm`       = read and reply to direct messages.
 *
 * Honest status of each channel (checked July 2026):
 *
 *  instagram  comments ✅  DM ✅   Graph API. DMs need the pages_messaging permission.
 *  facebook   comments ✅  DM ✅   Same Meta app and token as Instagram.
 *  youtube    comments ✅  DM —    YouTube has no private messaging at all. Needs a
 *                                  separate Google OAuth token (see SETUP.md).
 *  tiktok     comments ✅  DM ❌   Possible ONLY through the official TikTok Business
 *                                  API (business-api.tiktok.com), which you must apply
 *                                  for and be approved. There is no DM API. Never use
 *                                  a browser bot for TikTok — accounts get banned.
 */
const PLATFORMS = {
  instagram: {
    enabled: false,
    comments: true,
    dm: true,
    igUserId: '17841450239613283',   // fiha_khir13, from the app dashboard
  },
  facebook: {
    enabled: false,
    comments: true,
    dm: true,
    pageId: '',            // your Facebook Page id
  },
  youtube: {
    enabled: false,
    comments: true,
    dm: false,
    channelId: '',         // your YouTube channel id (UC...)
  },
  tiktok: {
    enabled: false,
    comments: true,
    dm: false,
    businessId: '',        // TikTok Business API business id
  },
};

/**
 * Topics the AI has no confirmed facts about. If a customer's comment mentions one,
 * the reply is held for your approval no matter what — because the model has been
 * observed inventing a confident "yes" to questions it was never given answers to.
 * The prompt tells it not to; this is the seatbelt in case it does anyway.
 *
 * Answered topics (colours, sliding, guarantee-exists) have been REMOVED from this list
 * because they're now in facts-for-ai.md — the AI can answer them on its own.
 * What stays here is what genuinely has no confirmed answer.
 */
const UNVERIFIED_TOPICS = [
  'مصنوع', 'من اش', 'مناش',              // what it's made of
  'حديد', 'بلاستيك', 'ألمنيوم', 'الومنيوم', // materials
  'كيدوم', 'يدوم', 'مدة الضمان',          // lifespan / guarantee duration
  'ترجيع', 'إرجاع', 'استرجاع',            // returns
  'فوقاش غادي', 'شحال من يوم',            // exact promised dates
  // Promotions: only you know whether one is running. The model was caught replying
  // "no, there's no promo right now", which would be wrong the moment you run one.
  'بروومو', 'برومو', 'تخفيض', 'تخفيضات', 'رخيص شوية', 'promo', 'reduction',
];

/** Property keys (internal — no need to change). */
const PROP = {
  ANTHROPIC_KEY: 'ANTHROPIC_API_KEY',
  // Instagram. Issued through "API setup with Instagram login", so it only works
  // against graph.instagram.com — see META-SETUP.md.
  META_TOKEN: 'META_ACCESS_TOKEN',
  // Facebook Pages need their own Page token from the Facebook-login route. The same
  // string will not work for both; if this is unset the Instagram token is tried, which
  // fails with an auth error that looks exactly like an expired token.
  FACEBOOK_TOKEN: 'FACEBOOK_PAGE_TOKEN',
  YOUTUBE_TOKEN: 'YOUTUBE_ACCESS_TOKEN',
  TIKTOK_TOKEN: 'TIKTOK_ACCESS_TOKEN',
  // Google Cloud Speech-to-Text, for voice notes. Optional — the rest works without it.
  GOOGLE_STT_KEY: 'GOOGLE_STT_KEY',
  SEEN_IDS: 'SEEN_COMMENT_IDS',
  PENDING_PREFIX: 'pending_',

  // Runtime settings the dashboard can change (see Settings.gs for why these can't
  // just live in CONFIG).
  SETTINGS: 'RUNTIME_SETTINGS',
  // One key per day: usage_2026-07-26 -> {calls,input,output}
  USAGE_PREFIX: 'usage_',
  // Secret that gates the dashboard, because the web app itself must stay public.
  DASHBOARD_TOKEN: 'DASHBOARD_TOKEN',
  // One key per day: clicks_2026-07-28 -> number of WhatsApp link opens.
  CLICKS_PREFIX: 'clicks_',

  // The owner's own rewrites: [{draft, fixed, at}], newest last, last 10 kept. Fed back
  // into every prompt so the same wording mistake isn't made twice.
  CORRECTIONS: 'OWNER_CORRECTIONS',
  // How many drafts have been decided on, and how many of those he had to rewrite.
  // At AUTO_ENABLE_AFTER the system stops asking about the routine ones.
  REVIEWED: 'REVIEWED_COUNT',
  EDITED: 'EDITED_COUNT',
};

/**
 * ONE-TIME SETUP: paste secrets between the quotes, click Run, then DELETE them from
 * this function and save again. They're stored in Script Properties, not in the source.
 */
function setSecrets() {
  const props = PropertiesService.getScriptProperties();

  const anthropicKey = '';   // Anthropic API key
  const metaToken = '';      // Instagram token (Instagram-login route)
  const facebookToken = '';  // Facebook PAGE token (Facebook-login route) — a DIFFERENT string
  const youtubeToken = '';   // Google OAuth access token (YouTube) — optional
  const tiktokToken = '';    // TikTok Business API token — optional
  const googleSttKey = '';   // Google Cloud Speech-to-Text API key — optional, voice notes

  if (anthropicKey) props.setProperty(PROP.ANTHROPIC_KEY, anthropicKey);
  if (metaToken) props.setProperty(PROP.META_TOKEN, metaToken);
  if (facebookToken) props.setProperty(PROP.FACEBOOK_TOKEN, facebookToken);
  if (youtubeToken) props.setProperty(PROP.YOUTUBE_TOKEN, youtubeToken);
  if (tiktokToken) props.setProperty(PROP.TIKTOK_TOKEN, tiktokToken);
  if (googleSttKey) props.setProperty(PROP.GOOGLE_STT_KEY, googleSttKey);

  Logger.log('Anthropic: ' + !!props.getProperty(PROP.ANTHROPIC_KEY));
  Logger.log('Instagram: ' + !!props.getProperty(PROP.META_TOKEN));
  Logger.log('Facebook:  ' + !!props.getProperty(PROP.FACEBOOK_TOKEN));
  Logger.log('YouTube:   ' + !!props.getProperty(PROP.YOUTUBE_TOKEN));
  Logger.log('TikTok:    ' + !!props.getProperty(PROP.TIKTOK_TOKEN));
  Logger.log('GoogleSTT: ' + !!props.getProperty(PROP.GOOGLE_STT_KEY));
  Logger.log('Now DELETE the pasted values above and save this file again.');
}

function getSecret_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing secret: ' + key + ' — run setSecrets() first.');
  return v;
}

function hasSecret_(key) {
  return !!PropertiesService.getScriptProperties().getProperty(key);
}
