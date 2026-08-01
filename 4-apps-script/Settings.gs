/**
 * Settings.gs — runtime settings + cost tracking.
 *
 * WHY THIS FILE EXISTS
 *
 * CONFIG in Config.gs is a `const` object literal. Apps Script re-evaluates every .gs
 * file from source at the start of every execution, so anything written into CONFIG at
 * runtime is gone the moment that execution ends. That makes CONFIG fine for defaults
 * and useless for anything the dashboard needs to change — a stop button that only
 * lasted until the next 15-minute tick would be worse than no stop button at all.
 *
 * So: CONFIG holds the DEFAULTS, and this file holds the LIVE values in Script
 * Properties, which do persist. getSetting_() reads live-then-default. The dashboard
 * writes through setSetting_().
 *
 * Read it this way: CONFIG is what the system ships with, Settings is what it is doing
 * right now.
 */

/** Settings that may be changed at runtime, with their fallback source. */
const SETTABLE = {
  AUTOMATION_ENABLED: true,          // the master kill switch — not in CONFIG, new here
  DRAFT_ONLY_MODE: null,             // null = fall back to CONFIG[key]
  ALWAYS_ASK_APPROVAL: null,
  DAILY_SUMMARY: null,
  BACKLOG_MODE: false,               // scan far more posts while catching up on old ones
  PLATFORM_INSTAGRAM: null,          // mirrors PLATFORMS.instagram.enabled
  PLATFORM_FACEBOOK: null,
  PLATFORM_YOUTUBE: null,
  PLATFORM_TIKTOK: null,
};

// Read once per execution. Apps Script property reads are a network hop each; the
// hot path (processMessage_) touches these several times per message.
let SETTINGS_CACHE_ = null;

function allSettings_() {
  if (SETTINGS_CACHE_) return SETTINGS_CACHE_;
  const raw = PropertiesService.getScriptProperties().getProperty(PROP.SETTINGS);
  let stored = {};
  if (raw) {
    try { stored = JSON.parse(raw); } catch (e) { stored = {}; }
  }
  SETTINGS_CACHE_ = stored;
  return stored;
}

/**
 * Live value for a settable key. Falls back to CONFIG, then to the SETTABLE default.
 * Anything not in SETTABLE is a programming error — fail loudly rather than silently
 * returning undefined and, say, treating DRAFT_ONLY_MODE as false.
 */
function getSetting_(key) {
  if (!(key in SETTABLE)) throw new Error('Unknown setting: ' + key);
  const stored = allSettings_();
  if (key in stored) return stored[key];
  if (key in CONFIG) return CONFIG[key];
  return SETTABLE[key];
}

function setSetting_(key, value) {
  if (!(key in SETTABLE)) throw new Error('Unknown setting: ' + key);
  const stored = allSettings_();
  stored[key] = value;
  PropertiesService.getScriptProperties().setProperty(PROP.SETTINGS, JSON.stringify(stored));
  SETTINGS_CACHE_ = stored;
}

/** Is this channel switched on right now? Credentials still gate it in Platforms.gs. */
function platformEnabled_(name) {
  const key = 'PLATFORM_' + name.toUpperCase();
  if (!(key in SETTABLE)) return false;
  const stored = allSettings_();
  if (key in stored) return stored[key];
  return !!(PLATFORMS[name] && PLATFORMS[name].enabled);   // fall back to the source default
}

function setPlatformEnabled_(name, on) {
  setSetting_('PLATFORM_' + name.toUpperCase(), !!on);
}

// ---------------------------------------------------------------------------
// COST TRACKING
// ---------------------------------------------------------------------------

/**
 * Anthropic has no endpoint that reports remaining account credit — the only spend
 * signal the API gives you is the per-response `usage` block. So this counts what we
 * actually spend, request by request, and the dashboard shows that. For the remaining
 * balance you still have to look at console.anthropic.com; the dashboard links there
 * rather than pretending to know.
 *
 * Prices are per million tokens, Haiku 4.5. If you switch CLAUDE_MODEL, update these.
 */
const PRICE_PER_MTOK = {
  input: 1.00,
  output: 5.00,
  cacheWrite: 1.25,   // first call that stores the prompt: 1.25x input
  cacheRead: 0.10,    // every later call that reuses it: 0.1x input
};

/** Rough MAD conversion, for a number that means something locally. */
const USD_TO_MAD = 10.0;

/**
 * Record one API call. Called from callClaudeWithRetry_ on every 200.
 *
 * Kept deliberately cheap and non-throwing: this is instrumentation on the path that
 * answers customers, and a metrics failure must never cost a reply.
 */
function recordUsage_(usage) {
  try {
    if (!usage) return;
    const day = Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd');
    const props = PropertiesService.getScriptProperties();
    const key = PROP.USAGE_PREFIX + day;

    let d = { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    const raw = props.getProperty(key);
    if (raw) { try { d = JSON.parse(raw); } catch (e) { /* start fresh */ } }

    d.calls += 1;
    d.input += usage.input_tokens || 0;
    d.output += usage.output_tokens || 0;
    // Cached tokens are reported separately and billed at different rates. Records
    // written before caching existed have no such fields, hence the || 0 throughout.
    d.cacheWrite = (d.cacheWrite || 0) + (usage.cache_creation_input_tokens || 0);
    d.cacheRead = (d.cacheRead || 0) + (usage.cache_read_input_tokens || 0);
    props.setProperty(key, JSON.stringify(d));
  } catch (err) {
    Logger.log('recordUsage failed (ignored): ' + err);
  }
}

function costOf_(d) {
  const usd = (d.input / 1e6) * PRICE_PER_MTOK.input +
              (d.output / 1e6) * PRICE_PER_MTOK.output +
              ((d.cacheWrite || 0) / 1e6) * PRICE_PER_MTOK.cacheWrite +
              ((d.cacheRead || 0) / 1e6) * PRICE_PER_MTOK.cacheRead;
  return { usd: usd, mad: usd * USD_TO_MAD };
}

/** Share of cacheable tokens that were served from cache. 0 when nothing was cached. */
function cacheHitRate_(d) {
  const total = (d.cacheWrite || 0) + (d.cacheRead || 0);
  return total ? (d.cacheRead || 0) / total : 0;
}

const EMPTY_USAGE = { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

function usageForDay_(day) {
  const raw = PropertiesService.getScriptProperties().getProperty(PROP.USAGE_PREFIX + day);
  if (!raw) return Object.assign({}, EMPTY_USAGE);
  try {
    return Object.assign({}, EMPTY_USAGE, JSON.parse(raw));
  } catch (e) { return Object.assign({}, EMPTY_USAGE); }
}

/** Totals over the last n days (inclusive of today), plus a per-day series. */
function usageWindow_(days) {
  const series = [];
  const total = Object.assign({}, EMPTY_USAGE);
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(now.getTime() - i * 86400000);
    const day = Utilities.formatDate(dt, 'Africa/Casablanca', 'yyyy-MM-dd');
    const d = usageForDay_(day);
    series.push({ day: day, calls: d.calls, cost: costOf_(d) });
    total.calls += d.calls; total.input += d.input; total.output += d.output;
    total.cacheWrite += d.cacheWrite; total.cacheRead += d.cacheRead;
  }
  return { series: series, total: total, cost: costOf_(total) };
}

/**
 * Housekeeping: usage keys are one property per day and Script Properties are capped
 * (500KB total, 9KB per value). Drop anything older than 120 days. Called from the
 * daily trigger so it never needs remembering.
 */
function pruneOldUsage_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const cutoff = Utilities.formatDate(
      new Date(Date.now() - 120 * 86400000), 'Africa/Casablanca', 'yyyy-MM-dd');
    props.getKeys()
      .filter(k => k.indexOf(PROP.USAGE_PREFIX) === 0)
      .filter(k => k.slice(PROP.USAGE_PREFIX.length) < cutoff)
      .forEach(k => props.deleteProperty(k));
  } catch (err) {
    Logger.log('pruneOldUsage failed: ' + err);
  }
}

/**
 * Expired approvals also accumulate: every held message writes a pending_<uuid>
 * property, and one that is never clicked is never deleted. Drop them after 14 days.
 */
function pruneOldPending_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const cutoff = Date.now() - 14 * 86400000;
    props.getKeys()
      .filter(k => k.indexOf(PROP.PENDING_PREFIX) === 0)
      .forEach(k => {
        try {
          const p = JSON.parse(props.getProperty(k));
          if (new Date(p.created).getTime() < cutoff) props.deleteProperty(k);
        } catch (e) {
          props.deleteProperty(k);   // unparseable = not actionable, remove it
        }
      });
  } catch (err) {
    Logger.log('pruneOldPending failed: ' + err);
  }
}

// ---------------------------------------------------------------------------
// DASHBOARD ACCESS TOKEN
// ---------------------------------------------------------------------------

/**
 * The web app must be deployed "Anyone" so Meta can verify the webhook and so the
 * Approve links in your email work without a Google login. That means the URL is
 * public and Session.getActiveUser() is empty — there is no identity to check against.
 *
 * So the dashboard is gated on a long random token that only you have. Run this once;
 * it prints the private dashboard URL. Anyone with that URL can see the dashboard, so
 * treat it like a password: don't post it anywhere.
 */
function setupDashboard() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty(PROP.DASHBOARD_TOKEN);
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(PROP.DASHBOARD_TOKEN, token);
  }
  const url = ScriptApp.getService().getUrl() + '?dash=' + token;
  Logger.log('Your private dashboard URL (keep it secret):\n' + url);
  return url;
}

/** Constant-time-ish compare, so the token can't be guessed a character at a time. */
function dashboardTokenValid_(supplied) {
  const real = PropertiesService.getScriptProperties().getProperty(PROP.DASHBOARD_TOKEN);
  if (!real || !supplied || supplied.length !== real.length) return false;
  let diff = 0;
  for (let i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}
