/**
 * Code.gs — AI reply system for فيها خير (Mosiquaire), on Google Apps Script.
 *
 * The job is not "answer messages" — it's to move interested people to WhatsApp, because
 * that's where the business sells. Every part below serves that.
 *
 * Channels are handled by the adapters in Platforms.gs, so this file stays the same
 * whether a message came from Instagram, Facebook, YouTube or TikTok, and whether it was
 * a public comment or a private DM.
 *
 *   checkEverything()   [timer, every 15 min]
 *     for each enabled platform:
 *       pull new comments (and DMs where the platform supports them)
 *       -> ask Claude for a reply + Arabic client_type + lead temperature
 *       -> guard: unverifiable claims are held for human review no matter what
 *       -> risky/uncertain -> email you Approve/Reject; nothing sent yet
 *          safe + trusted   -> reply publicly, and DM warm leads a tappable WhatsApp link
 *       -> log every outcome to the Arabic Google Sheet
 *
 *   doGet()        Meta webhook verification + your Approve/Reject clicks
 *   doPost()       live Instagram/Facebook webhooks (optional; polling alone works)
 *   dailySummary() evening digest of the day's leads
 *
 * Safety: while DRAFT_ONLY_MODE is on, nothing is ever posted or sent. It and the
 * master stop switch live in Script Properties (Settings.gs) so the dashboard can
 * change them at runtime; CONFIG only supplies the defaults.
 */

// ---------------------------------------------------------------------------
// MAIN ENTRY POINT — installTrigger() attaches the timer to this
// ---------------------------------------------------------------------------

function checkEverything() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('Another run is in progress; skipping.');
    return;
  }
  try {
    // Master kill switch, flipped from the dashboard. Checked here rather than by
    // deleting the trigger, so switching back on is one click and needs no re-auth.
    if (!getSetting_('AUTOMATION_ENABLED')) {
      Logger.log('Automation is stopped from the dashboard; doing nothing.');
      return;
    }
    let total = 0;
    for (const name of Object.keys(PLATFORMS)) {
      if (!platformEnabled_(name)) continue;
      total += runPlatform_(name, PLATFORMS[name]);
    }
    Logger.log('Handled ' + total + ' new message(s) across all platforms.');
  } catch (err) {
    notifyError_('checkEverything', err, '');
  } finally {
    lock.releaseLock();
  }
}

/** Pull and process everything for one platform. Returns how many were handled. */
function runPlatform_(name, cfg) {
  const adapter = adapterFor_(name);
  let handled = 0;
  const batch = [];

  // A failure on one channel must not stop the others.
  if (cfg.comments && adapter.fetchComments) {
    try {
      batch.push.apply(batch, adapter.fetchComments());
    } catch (err) {
      notifyError_(name + '/fetchComments', err, '');
    }
  }
  if (cfg.dm && adapter.fetchDMs) {
    try {
      batch.push.apply(batch, adapter.fetchDMs());
    } catch (err) {
      notifyError_(name + '/fetchDMs', err, '');
    }
  }

  for (const msg of batch) {
    if (isAlreadySeen_(msg.id)) continue;
    markSeen_(msg.id);      // mark BEFORE processing, so a crash can't cause a re-reply
    try {
      processMessage_(msg);
      handled++;
    } catch (err) {
      notifyError_(name + '/process', err, JSON.stringify(msg));
    }
  }
  Logger.log(name + ': ' + handled + ' new of ' + batch.length + ' fetched.');
  return handled;
}

/**
 * Core per-message logic — identical for every platform and for comments vs DMs.
 */
function processMessage_(msg) {
  const ai = generateReply_(msg);

  // Nothing worth saying (tag, emoji, spam) — log and move on.
  if (!ai.reply || !ai.reply.trim()) {
    logToSheet_(msg, ai, 'تجاهل — ماشي سؤال');
    return;
  }

  // Seatbelt: the model has been caught inventing confident answers about things it
  // was never told. If the customer asked about one of those, a human checks first.
  const risky = mentionsUnverifiedTopic_(msg.text);
  if (risky) ai.guard = risky;

  const draftOnly = getSetting_('DRAFT_ONLY_MODE');
  const needsHuman = ai.needs_human || !!risky || getSetting_('ALWAYS_ASK_APPROVAL');

  if (!needsHuman && !draftOnly) {
    deliver_(msg, ai);
    logToSheet_(msg, ai, msg.kind === 'dm' ? 'تجاوب ف الرسائل' : 'تم الرد تلقائيًا');
    return;
  }

  // Otherwise hold it and email the owner to decide.
  //
  // Log FIRST so we know which row this message owns. The old code looked the row up
  // again at approval time by scanning back for the newest still-pending row, which
  // silently updated the wrong row whenever two messages were awaiting a decision at
  // once — approving the older one would stamp the newer one's status. The row number
  // is now carried in the token payload, so a click always lands on its own row.
  const row = logToSheet_(msg, ai, draftOnly
    ? 'مسودة — بانتظار موافقتك (وضع الاختبار)'
    : 'بانتظار موافقتك');

  const token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(
    PROP.PENDING_PREFIX + token,
    JSON.stringify({
      msg: msg,
      reply: ai.reply,
      client_type: ai.client_type,
      lead: ai.lead,
      row: row,
      created: new Date().toISOString(),
    })
  );

  sendApprovalEmail_(msg, ai, token);
}

/**
 * Actually send the reply. Blocked entirely while DRAFT_ONLY_MODE is on.
 * For public comments from warm/hot leads we also try a private reply carrying a
 * tappable wa.me link — a phone number in a comment isn't clickable, a DM link is.
 */
function deliver_(msg, ai) {
  if (getSetting_('DRAFT_ONLY_MODE')) {
    Logger.log('DRAFT_ONLY_MODE on — not sending. Would have replied: ' + ai.reply);
    return;
  }
  const adapter = adapterFor_(msg.platform);

  if (msg.kind === 'dm') {
    if (!adapter.sendDM) throw new Error(msg.platform + ' has no DM support');
    adapter.sendDM(msg.threadId, ai.reply);
    return;
  }

  adapter.postReply(msg.id, ai.reply);
  maybePrivateReply_(msg, ai);
}

/** Instagram allows one private message in response to a comment. Only for real leads. */
function maybePrivateReply_(msg, ai) {
  if (msg.platform !== 'instagram') return;              // only Instagram supports this
  if (!PLATFORMS.instagram.dm || !platformEnabled_('instagram')) return;
  if (ai.lead !== 'ساخن' && ai.lead !== 'دافئ') return;  // never spam cold commenters

  try {
    Instagram.privateReplyToComment(msg.id,
      'إلا بغيتي الثمن بالضبط، صيفط لينا القياس ديال الشباك هنا:\n' +
      trackedWhatsappLink_(msg.author, 'ig-private-reply'));
  } catch (err) {
    Logger.log('Private reply skipped: ' + err);   // never let a DM failure break the flow
  }
}

/** Returns the matched topic word, or '' if the message is clear. */
function mentionsUnverifiedTopic_(text) {
  const t = String(text || '');
  for (const topic of UNVERIFIED_TOPICS) {
    if (t.indexOf(topic) !== -1) return topic;
  }
  return '';
}

// ---------------------------------------------------------------------------
// CLAUDE
// ---------------------------------------------------------------------------

function generateReply_(msg) {
  // Tell the model where it's replying — a public comment and a private DM are
  // different rooms, and the playbook gives them different rules.
  const where = msg.kind === 'dm'
    ? '[رسالة خاصة على ' + msg.platform + ' من @' + msg.author + ']'
    : '[تعليق عام على ' + msg.platform + ' من @' + msg.author + ']';

  // Script matching, decided in code rather than left to the model.
  // Asking it to "notice" the script only worked ~5/9 of the time in testing; stating
  // the answer outright is deterministic. Replying to Latin-script Darija in Arabic
  // script is the most obvious bot tell there is, so this is worth pinning down.
  const script = detectScript_(msg.text);
  const instruction = SCRIPT_INSTRUCTION[script];
  const prompt = where + '\n' + instruction + '\n\n' + msg.text;

  let ai = parseAiJson_(callClaudeWithRetry_(prompt));

  // Script-purity check. The model has been caught splicing Arabic letters into a
  // Latin reply ("wach bghit tعrf", "bghiti chno bالضبط") — that reads as broken to a
  // customer. One corrective retry; if it still fails, hand it to a human rather than
  // post something malformed.
  if (ai.reply && !scriptIsClean_(ai.reply, script)) {
    Logger.log('Mixed-script reply, retrying: ' + ai.reply);
    const retry = parseAiJson_(callClaudeWithRetry_(
      prompt + '\n\n[Your previous attempt mixed alphabets, which looks broken. Write the ' +
      'whole reply in ONE alphabet only. Do not put a single Arabic letter inside a Latin ' +
      'word, or a Latin word inside an Arabic sentence.]'));
    if (retry.reply && scriptIsClean_(retry.reply, script)) {
      ai = retry;
    } else {
      ai = retry.reply ? retry : ai;
      ai.needs_human = true;
      ai.guard = 'خليط ديال الحروف';   // surfaced in the approval email
    }
  }
  return normaliseLabels_(ai);
}

/**
 * True when the reply sticks to one alphabet. Latin/French replies must contain no
 * Arabic letters; Arabic replies may still carry the WhatsApp number and the odd
 * borrowed word like "whatsapp" or "blackout", so a few Latin characters are fine —
 * what's checked is that Arabic doesn't dominate a Latin reply or vice versa.
 */
function scriptIsClean_(reply, wantedScript) {
  const arabic = (reply.match(/[؀-ۿ]/g) || []).length;
  const latin = (reply.match(/[a-zA-Z]/g) || []).length;

  if (wantedScript === 'arabic') return arabic > 0 && latin <= arabic;
  // latin or french: any Arabic letter at all is a defect
  return arabic === 0 && latin > 0;
}

// The script rule applies to the "reply" field ONLY. Without saying so, the model was
// observed transliterating the metadata too ("dafi", "sual 3an ttaman" instead of
// دافئ / سؤال عن الثمن), which breaks the sheet's colour rules and the daily summary.
const METADATA_NOTE = ' This applies ONLY to the "reply" field. "client_type" and "lead" ' +
  'must always use the exact Arabic labels listed above, never transliterated.';

const SCRIPT_INSTRUCTION = {
  latin: '[SCRIPT: the customer wrote Darija in LATIN letters. Your "reply" MUST be in ' +
         'Latin letters too (e.g. "470 dh l metre. sift lia l9ias f whatsapp ' +
         '0666567672"). Do NOT reply in Arabic script.' + METADATA_NOTE + ']',
  french: '[SCRIPT: the customer wrote French. Reply in simple French, prices as "470 DH".' +
          METADATA_NOTE + ']',
  arabic: '[SCRIPT: the customer wrote Arabic letters. Reply in Arabic-script Darija.]',
};

// Canonical labels. Anything the model returns that isn't on these lists gets mapped
// back, so the spreadsheet and the daily summary can rely on exact matches.
const VALID_TYPES = ['مهتم بالشراء', 'سؤال عن الثمن', 'استفسار عن التوصيل', 'شكوى',
                     'زبون سعيد', 'سؤال عام', 'أخرى'];
const VALID_LEADS = ['ساخن', 'دافئ', 'بارد'];

const TYPE_ALIASES = {
  'sual 3an ttaman': 'سؤال عن الثمن', 'so2al 3an taman': 'سؤال عن الثمن',
  'mohtam bchira': 'مهتم بالشراء', 'chikaya': 'شكوى', 'zbon sa3id': 'زبون سعيد',
  'sual 3am': 'سؤال عام', 'istifsar 3an tawsil': 'استفسار عن التوصيل', 'okhra': 'أخرى',
};
const LEAD_ALIASES = { 'sakhin': 'ساخن', 's5in': 'ساخن', 'dafi': 'دافئ', 'defi': 'دافئ',
                       'barid': 'بارد', 'bared': 'بارد' };

function normaliseLabels_(ai) {
  const t = String(ai.client_type || '').trim();
  if (VALID_TYPES.indexOf(t) === -1) {
    ai.client_type = TYPE_ALIASES[t.toLowerCase()] || 'سؤال عام';
  }
  const l = String(ai.lead || '').trim();
  if (VALID_LEADS.indexOf(l) === -1) {
    ai.lead = LEAD_ALIASES[l.toLowerCase()] || 'بارد';
  }
  return ai;
}

/**
 * Which script did they use? Counts Arabic vs Latin characters, then separates
 * French from Latin-script Darija by looking for French function words.
 */
function detectScript_(text) {
  const s = String(text || '');
  const arabic = (s.match(/[؀-ۿ]/g) || []).length;
  const latin = (s.match(/[a-zA-Z]/g) || []).length;

  if (arabic >= latin) return 'arabic';

  // Latin-dominant: French, or Darija typed in Latin letters?
  const french = /\b(bonjour|bonsoir|merci|combien|prix|est-ce|vous|votre|je|c'est|s'il|pour|avec|livraison)\b/i;
  return french.test(s) ? 'french' : 'latin';
}

/** One retry on 429/5xx — a transient API hiccup shouldn't lose a customer. */
function callClaudeWithRetry_(userContent) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': getSecret_(PROP.ANTHROPIC_KEY),
        'anthropic-version': CONFIG.ANTHROPIC_VERSION,
      },
      payload: JSON.stringify({
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 400,
        // The system prompt is ~5600 tokens and byte-identical on every call, so it is
        // ~90% of the bill. Marking it cacheable makes a repeat read cost a tenth of a
        // fresh one. The cache lives about 5 minutes: a lone message still pays full
        // price, but a burst of comments after a post — the normal case — mostly hits.
        system: [{ type: 'text', text: SYSTEM_PROMPT,
                   cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
      }),
      muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    if (code === 200) {
      const body = JSON.parse(res.getContentText());
      // Every call is metered here — this is the only place a request reaches Anthropic,
      // so counting here cannot miss one. Note generateReply_ can call twice for a single
      // customer message when the script-purity retry fires; both are billed, and both
      // are counted.
      recordUsage_(body.usage);
      return body.content[0].text;
    }

    if ((code !== 429 && code < 500) || attempt === 2) {
      throw new Error('Anthropic API ' + code + ': ' + res.getContentText().slice(0, 400));
    }
    Utilities.sleep(2000);
  }
}

/**
 * Read the comments out of a screenshot.
 *
 * This is the point of the no-API path: instead of retyping what a customer wrote, you
 * screenshot the comments on your phone and the model reads them. Instagram is never
 * contacted, so there is nothing to authorise and nothing to get banned for.
 *
 * Deliberately does ONE job — extraction. The replies still go through generateReply_,
 * so script detection, the corrective retry, the unverified-topic guard and cost metering
 * behave identically to the automatic path. One pipeline, two ways in.
 */
function extractCommentsFromImage_(base64, mimeType) {
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getSecret_(PROP.ANTHROPIC_KEY),
      'anthropic-version': CONFIG.ANTHROPIC_VERSION,
    },
    payload: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image',
            source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: base64 } },
          { type: 'text', text:
            'This is a screenshot of comments or messages on a social media post ' +
            '(Instagram, Facebook, TikTok or YouTube), most likely in Moroccan Darija.\n\n' +
            'Extract every comment written by someone OTHER than the page owner ' +
            '(the owner appears as "fiha khir", "fiha_khir13" or "fihakhir04" — skip those).\n\n' +
            'Copy each comment EXACTLY as written. Do not translate, do not fix spelling, ' +
            'do not convert between Arabic and Latin letters. The exact script decides ' +
            'which script the reply is written in, so changing it breaks the reply.\n\n' +
            'Return ONLY a JSON array, nothing else:\n' +
            '[{"author":"username","text":"the comment exactly as written"}]\n\n' +
            'Return [] if there are no readable comments.' },
        ],
      }],
    }),
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Vision API ' + res.getResponseCode() + ': ' +
      res.getContentText().slice(0, 300));
  }
  const body = JSON.parse(res.getContentText());
  recordUsage_(body.usage);           // images are billed too, so count them

  return parseAiJsonArray_(body.content[0].text);
}

/**
 * Your own handles. The extraction prompt asks the model to skip your comments, but
 * prompt-only rules have failed in this project before (script matching held 5 times in
 * 9), so the same rule is enforced here in code. Replying to yourself in public is the
 * kind of mistake customers screenshot.
 */
const OWNER_HANDLES = ['fiha_khir13', 'fihakhir04', 'fihakhir', 'fiha khir', 'فيها خير'];

function isOwnComment_(author) {
  const a = String(author || '').toLowerCase().replace(/^@/, '').trim();
  return OWNER_HANDLES.some(h => a === h.toLowerCase() || a.indexOf(h.toLowerCase()) !== -1);
}

/** Same fence tolerance as parseAiJson_, but for a top-level array. Fails to []. */
function parseAiJsonArray_(raw) {
  const s = String(raw).replace(/```(?:json)?/gi, '').trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(c => c && typeof c.text === 'string' && c.text.trim())
      .filter(c => !isOwnComment_(c.author))
      .map(c => ({ author: String(c.author || 'زبون').slice(0, 60), text: c.text.trim() }));
  } catch (e) {
    return [];
  }
}

/**
 * Claude wraps its JSON in ```json fences and sometimes adds prose after it (confirmed
 * against the live API), so a plain JSON.parse fails. Strip fences, then take the first
 * balanced {...} block. Anything unparseable fails SAFE: held for a human, never sent.
 */
function parseAiJson_(rawInput) {
  const raw = String(rawInput).replace(/```(?:json)?/gi, '').trim();
  const fallback = { reply: '', needs_human: true, client_type: 'غير محدد', lead: 'بارد' };

  const start = raw.indexOf('{');
  if (start === -1) return fallback;

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const p = JSON.parse(raw.slice(start, i + 1));
          if (typeof p.reply !== 'string') return fallback;   // empty reply is valid (spam)
          return {
            reply: p.reply,
            needs_human: p.needs_human === true,
            client_type: p.client_type || 'غير محدد',
            lead: p.lead || 'بارد',
          };
        } catch (e) {
          return fallback;
        }
      }
    }
  }
  return fallback;
}

/** wa.me link that opens WhatsApp with the first message already written. */
function whatsappLink_(username) {
  const text = 'السلام عليكم، جاي من السوشيال ميديا' +
    (username ? ' (@' + username + ')' : '') + '، بغيت نسول على الموستكير';
  return 'https://wa.me/' + CONFIG.WHATSAPP_INTL + '?text=' + encodeURIComponent(text);
}

/**
 * The same link, but routed through this web app so the click can be counted.
 *
 * There is no other way to know whether anyone actually reached WhatsApp: wa.me is
 * Meta's domain, and a phone number typed as text in a comment leaves no trace at all.
 * Only links we hand out ourselves are countable, so only those get wrapped.
 */
function trackedWhatsappLink_(username, source) {
  return ScriptApp.getService().getUrl() +
    '?w=1&s=' + encodeURIComponent(source || 'unknown') +
    (username ? '&u=' + encodeURIComponent(username) : '');
}

/** Count the click, then bounce to WhatsApp. */
function handleWhatsappRedirect_(p) {
  try {
    const day = Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd');
    const props = PropertiesService.getScriptProperties();
    const key = PROP.CLICKS_PREFIX + day;
    props.setProperty(key, String((parseInt(props.getProperty(key), 10) || 0) + 1));
  } catch (err) {
    Logger.log('click count failed (ignored): ' + err);   // never block the customer
  }

  const target = whatsappLink_(p.u || '');
  // Apps Script cannot issue a real 302, so this is a meta-refresh with a JS fallback
  // and a plain link underneath for anything that runs neither.
  return HtmlService.createHtmlOutput(
    '<meta http-equiv="refresh" content="0;url=' + escapeHtml_(target) + '">' +
    '<script>location.replace(' + JSON.stringify(target) + ')</script>' +
    '<div dir="rtl" style="font-family:Arial;text-align:center;padding:40px">' +
    'كنوجهوك للواتساب... <a href="' + escapeHtml_(target) + '">دوز من هنا</a></div>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function clicksForDay_(day) {
  return parseInt(
    PropertiesService.getScriptProperties().getProperty(PROP.CLICKS_PREFIX + day), 10) || 0;
}

function clicksWindow_(days) {
  let total = 0;
  const now = new Date();
  for (let i = 0; i < days; i++) {
    total += clicksForDay_(Utilities.formatDate(
      new Date(now.getTime() - i * 86400000), 'Africa/Casablanca', 'yyyy-MM-dd'));
  }
  return total;
}

// ---------------------------------------------------------------------------
// WEB APP — Meta verification + your Approve/Reject clicks
// ---------------------------------------------------------------------------

function doGet(e) {
  const p = (e && e.parameter) || {};

  if (p['hub.mode'] === 'subscribe') {
    if (p['hub.verify_token'] === CONFIG.META_VERIFY_TOKEN) {
      return ContentService.createTextOutput(p['hub.challenge']);
    }
    return ContentService.createTextOutput('Forbidden');
  }

  if (p.action && p.token) return handleApproval_(p.action, p.token);

  // Tracked WhatsApp hop. Public on purpose: customers follow this, not the owner.
  if (p.w) return handleWhatsappRedirect_(p);

  // Private control panel. Wrong or missing token falls through to the public page
  // below rather than saying "wrong token" — no point confirming the URL exists.
  if (p.dash && dashboardTokenValid_(p.dash)) return renderDashboard_();

  // Public default. Deliberately empty of information: this URL is reachable by anyone.
  return html_('نظام الرد الآلي', 'الخدمة خدامة ✅');
}

function handleApproval_(action, token) {
  const props = PropertiesService.getScriptProperties();
  const key = PROP.PENDING_PREFIX + token;
  const raw = props.getProperty(key);

  if (!raw) {
    return html_('انتهات الصلاحية', 'هاد الطلب تعالج من قبل، ولا ما بقاش موجود.');
  }
  const pending = JSON.parse(raw);
  props.deleteProperty(key);   // single-use: a re-click can't send twice

  if (action !== 'approve') {
    updateSheetStatus_(pending.row, 'مرفوض — ما تنشرش');
    return html_('تم الرفض', 'ما تصيفط والو.');
  }

  if (getSetting_('DRAFT_ONLY_MODE')) {
    updateSheetStatus_(pending.row, 'موافق عليه — ولكن ما تصيفطش (وضع الاختبار)');
    return html_('تمت الموافقة',
      'وضع الاختبار مفعل، لذلك ما تصيفط والو. طفيه من اللوحة باش يخدم بصح.');
  }

  try {
    deliver_(pending.msg, { reply: pending.reply, lead: pending.lead });
    updateSheetStatus_(pending.row, 'تمت الموافقة وتصيفط');
    return html_('تصيفط ✅', escapeHtml_(pending.reply));
  } catch (err) {
    notifyError_('handleApproval/send', err, JSON.stringify(pending.msg));
    return html_('خطأ', 'ما قدرناش نصيفطو: ' + escapeHtml_(String(err)));
  }
}

/** Live Meta webhook (optional — polling alone also works). */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // Dashboard actions arrive on the same endpoint (Apps Script gives you exactly one
    // doPost). They carry a `dash` token and an `action`; Meta payloads never do, so the
    // two can't be confused. handleDashboardAction_ re-verifies the token itself.
    if (body.dash && body.action) {
      return ContentService
        .createTextOutput(JSON.stringify(handleDashboardAction_(body)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // The stop button has to stop webhooks too, not just the timer — otherwise
    // "stopped" would still reply instantly to anything Meta pushes.
    if (!getSetting_('AUTOMATION_ENABLED')) return ContentService.createTextOutput('PAUSED');

    const platform = body.object === 'instagram' ? 'instagram' : 'facebook';

    for (const entry of (body.entry || [])) {
      // Comments
      for (const change of (entry.changes || [])) {
        const v = change.value || {};
        if (change.field !== 'comments' && change.field !== 'feed') continue;
        const id = v.id || v.comment_id;
        const text = v.text || v.message;
        if (!id || !text || isAlreadySeen_(id)) continue;
        markSeen_(id);
        processMessage_({
          id: id, text: text,
          author: (v.from && (v.from.username || v.from.name)) || 'unknown',
          platform: platform, postId: v.media ? v.media.id : v.post_id, kind: 'comment',
        });
      }
      // Direct messages
      for (const m of (entry.messaging || [])) {
        if (!m.message || !m.message.text || m.message.is_echo) continue;
        const id = m.message.mid;
        if (!id || isAlreadySeen_(id)) continue;
        markSeen_(id);
        processMessage_({
          id: id, text: m.message.text,
          author: (m.sender && m.sender.id) || 'unknown',
          platform: platform, threadId: m.sender && m.sender.id, kind: 'dm',
        });
      }
    }
  } catch (err) {
    notifyError_('doPost', err, (e && e.postData && e.postData.contents) || '');
  }
  return ContentService.createTextOutput('EVENT_RECEIVED');
}

// ---------------------------------------------------------------------------
// EMAIL
// ---------------------------------------------------------------------------

const LEAD_COLOUR = { 'ساخن': '#dc2626', 'دافئ': '#ea580c', 'بارد': '#64748b' };
const PLATFORM_LABEL = {
  instagram: 'إنستغرام', facebook: 'فيسبوك', youtube: 'يوتيوب', tiktok: 'تيك توك',
};

function sendApprovalEmail_(msg, ai, token) {
  const base = ScriptApp.getService().getUrl();
  const approve = base + '?action=approve&token=' + token;
  const reject = base + '?action=reject&token=' + token;
  const colour = LEAD_COLOUR[ai.lead] || '#64748b';
  const where = (PLATFORM_LABEL[msg.platform] || msg.platform) +
    (msg.kind === 'dm' ? ' — رسالة خاصة' : ' — تعليق');

  const guardNote = ai.guard
    ? '<p style="background:#fef2f2;border-right:4px solid #dc2626;padding:10px;' +
      'border-radius:6px"><b>راه سول على: "' + escapeHtml_(ai.guard) + '"</b><br>' +
      'ما عندناش معلومة مؤكدة على هادشي، لذلك حبسناه ليك. قرا الرد مزيان قبل ما توافق.</p>'
    : '';

  const draftNote = getSetting_('DRAFT_ONLY_MODE')
    ? '<p style="color:#b45309"><b>وضع الاختبار مفعل</b> — حتى إلا وافقتي، ما غادي يتصيفط والو.</p>'
    : '';

  const html =
    '<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px">' +
      '<div style="display:inline-block;background:' + colour + ';color:#fff;padding:4px 12px;' +
        'border-radius:99px;font-size:13px">' + escapeHtml_(ai.lead || '') + '</div>' +
      '<h2 style="margin:8px 0 2px">' + escapeHtml_(where) + '</h2>' +
      '<p style="color:#666;margin:0 0 14px">@' + escapeHtml_(msg.author) + ' — ' +
        escapeHtml_(ai.client_type) + '</p>' +
      guardNote + draftNote +
      '<p style="background:#f3f4f6;padding:12px;border-radius:8px">' +
        escapeHtml_(msg.text) + '</p>' +
      '<p style="margin-bottom:4px"><b>الرد المقترح:</b></p>' +
      '<p style="background:#ecfdf5;padding:12px;border-radius:8px">' +
        escapeHtml_(ai.reply) + '</p>' +
      '<p style="margin-top:22px">' +
        '<a href="' + approve + '" style="background:#16a34a;color:#fff;padding:12px 24px;' +
          'text-decoration:none;border-radius:6px;margin-left:8px">وافق وصيفط</a>' +
        '<a href="' + reject + '" style="background:#dc2626;color:#fff;padding:12px 24px;' +
          'text-decoration:none;border-radius:6px">ارفض</a>' +
      '</p>' +
      '<p style="margin-top:18px"><a href="' +
        trackedWhatsappLink_(msg.author, 'approval-email') + '">' +
        'ولا بدا معاه الحديث ديريكت ف الواتساب ←</a></p>' +
      '<p style="color:#9ca3af;font-size:12px;margin-top:22px">الروابط كيخدموا مرة وحدة.</p>' +
    '</div>';

  GmailApp.sendEmail(CONFIG.OWNER_EMAIL,
    (ai.lead === 'ساخن' ? '🔥 ' : '') + where + ' — @' + msg.author,
    ai.reply,
    { htmlBody: html, name: 'فيها خير — نظام الرد الآلي' });
}

function notifyError_(where, err, context) {
  Logger.log('ERROR in ' + where + ': ' + err);
  try {
    GmailApp.sendEmail(CONFIG.OWNER_EMAIL,
      '⚠️ خطأ في نظام الرد الآلي — ' + where,
      'المكان: ' + where + '\n\nالخطأ: ' + err + '\n\nالسياق:\n' +
      String(context).slice(0, 1500));
  } catch (e) {
    Logger.log('Could not send error email: ' + e);
  }
}

/** Evening digest: what came in today, and which leads to chase on WhatsApp. */
function dailySummary() {
  // Housekeeping runs even when the summary email is switched off, otherwise stale
  // usage keys and never-clicked approvals fill Script Properties until writes fail.
  pruneOldUsage_();
  pruneOldPending_();

  if (!getSetting_('DAILY_SUMMARY')) return;
  try {
    const sh = getSheet_();
    const today = Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd');
    const rows = sh.getDataRange().getValues().slice(1)
      .filter(r => String(r[0]).indexOf(today) === 0);
    if (!rows.length) return;   // nothing happened; don't send an empty email

    const hot = rows.filter(r => r[6] === 'ساخن');
    const warm = rows.filter(r => r[6] === 'دافئ');

    let html = '<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px">' +
      '<h2>ملخص اليوم — ' + today + '</h2>' +
      '<p>' + rows.length + ' رسالة • <b style="color:#dc2626">' + hot.length +
      ' ساخن</b> • ' + warm.length + ' دافئ</p>';

    if (hot.length) {
      html += '<h3>الزبناء الساخنين — تبعهم ف الواتساب</h3><ul>';
      hot.forEach(r => {
        html += '<li><b>@' + escapeHtml_(r[3]) + '</b> (' + escapeHtml_(r[1]) + ') — ' +
          escapeHtml_(r[4]) + '</li>';
      });
      html += '</ul>';
    }
    // What today actually cost, so the number is never a surprise at the end of a month.
    const cost = costOf_(usageForDay_(today));
    const month = usageWindow_(30).cost;
    html += '<p style="color:#6b7280;font-size:13px">التكلفة اليوم: <b>' +
      cost.mad.toFixed(2) + ' درهم</b> • آخر 30 يوم: <b>' + month.mad.toFixed(2) +
      ' درهم</b></p>';

    const dashUrl = PropertiesService.getScriptProperties()
      .getProperty(PROP.DASHBOARD_TOKEN);
    if (dashUrl) {
      html += '<p><a href="' + ScriptApp.getService().getUrl() + '?dash=' + dashUrl +
        '">افتح لوحة التحكم ←</a></p>';
    }
    html += '<p><a href="' + SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getUrl() +
      '">شوف الجدول كامل ←</a></p></div>';

    GmailApp.sendEmail(CONFIG.OWNER_EMAIL,
      'ملخص اليوم — ' + hot.length + ' زبون ساخن',
      rows.length + ' رسالة اليوم',
      { htmlBody: html, name: 'فيها خير — نظام الرد الآلي' });
  } catch (err) {
    Logger.log('dailySummary failed: ' + err);
  }
}

// ---------------------------------------------------------------------------
// GOOGLE SHEET (Arabic client log)
// ---------------------------------------------------------------------------

const HEADERS = ['التاريخ', 'المنصة', 'النوع', 'اسم العميل', 'الرسالة',
                 'نوع العميل', 'درجة الاهتمام', 'الرد', 'الحالة'];

/** Run once. Creates the spreadsheet with Arabic headers and logs its ID. */
function setupSheet() {
  const ss = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.create('عملاء فيها خير');

  const sh = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  sh.clear();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.setRightToLeft(true);
  sh.setFrozenRows(1);
  sh.setColumnWidth(5, 260);
  sh.setColumnWidth(8, 260);

  // Colour the lead column so hot leads jump out at a glance.
  const leadCol = sh.getRange('G2:G2000');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ساخن')
      .setBackground('#fee2e2').setFontColor('#991b1b').setRanges([leadCol]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('دافئ')
      .setBackground('#ffedd5').setFontColor('#9a3412').setRanges([leadCol]).build(),
  ]);

  Logger.log('Spreadsheet ready: ' + ss.getUrl());
  Logger.log('PASTE THIS INTO Config.gs SPREADSHEET_ID: ' + ss.getId());
  return ss.getId();
}

function getSheet_() {
  if (!CONFIG.SPREADSHEET_ID) throw new Error('SPREADSHEET_ID not set — run setupSheet() first.');
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) throw new Error('Sheet tab "' + CONFIG.SHEET_NAME + '" not found.');
  return sh;
}

/** Appends one row and returns its row number (0 if logging failed). */
function logToSheet_(msg, ai, status) {
  try {
    const sh = getSheet_();
    sh.appendRow([
      Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd HH:mm'),
      PLATFORM_LABEL[msg.platform] || msg.platform,
      msg.kind === 'dm' ? 'رسالة خاصة' : 'تعليق',
      msg.author,
      msg.text,
      ai.client_type,
      ai.lead || '',
      ai.reply,
      status,
    ]);
    return sh.getLastRow();
  } catch (err) {
    Logger.log('logToSheet failed: ' + err);   // logging must never break a reply
    return 0;
  }
}

/**
 * Set the الحالة cell of one specific row. The row comes from the pending payload, so
 * an approval always updates the message it belongs to — see the note in
 * processMessage_ about why scanning for "the newest pending row" was wrong.
 */
function updateSheetStatus_(row, status) {
  if (!row) return;   // logging failed earlier; nothing to update
  try {
    getSheet_().getRange(row, 9).setValue(status);
  } catch (err) {
    Logger.log('updateSheetStatus failed: ' + err);
  }
}

// ---------------------------------------------------------------------------
// DEDUP
// ---------------------------------------------------------------------------

function isAlreadySeen_(id) { return seenList_().indexOf(id) !== -1; }

function markSeen_(id) {
  const list = seenList_();
  list.push(id);
  PropertiesService.getScriptProperties()
    .setProperty(PROP.SEEN_IDS, JSON.stringify(list.slice(-800)));
}

function seenList_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROP.SEEN_IDS);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

// ---------------------------------------------------------------------------
// HELPERS / SETUP
// ---------------------------------------------------------------------------

function html_(title, body) {
  return HtmlService.createHtmlOutput(
    '<div dir="rtl" style="font-family:Arial,sans-serif;text-align:center;padding:48px">' +
    '<h2>' + title + '</h2><p>' + body + '</p></div>');
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Run once to start the timers. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const f = t.getHandlerFunction();
    if (f === 'checkEverything' || f === 'dailySummary') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkEverything').timeBased().everyMinutes(15).create();
  if (CONFIG.DAILY_SUMMARY) {
    ScriptApp.newTrigger('dailySummary').timeBased().atHour(20).everyDays(1).create();
  }
  Logger.log('Triggers installed: every 15 min' +
    (CONFIG.DAILY_SUMMARY ? ', daily summary at 20:00.' : '.'));
}

/** Shows which channels are switched on and which secrets are present. */
function statusCheck() {
  Logger.log('--- secrets ---');
  Logger.log('Anthropic: ' + hasSecret_(PROP.ANTHROPIC_KEY));
  Logger.log('Meta:      ' + hasSecret_(PROP.META_TOKEN));
  Logger.log('YouTube:   ' + hasSecret_(PROP.YOUTUBE_TOKEN));
  Logger.log('TikTok:    ' + hasSecret_(PROP.TIKTOK_TOKEN));
  Logger.log('--- platforms ---');
  Object.keys(PLATFORMS).forEach(k => {
    const c = PLATFORMS[k];
    Logger.log(k + ': ' + (platformEnabled_(k) ? 'ON' : 'off') +
      ' (comments:' + !!c.comments + ' dm:' + !!c.dm + ')');
  });
  Logger.log('--- safety ---');
  Logger.log('AUTOMATION_ENABLED:  ' + getSetting_('AUTOMATION_ENABLED'));
  Logger.log('DRAFT_ONLY_MODE:     ' + getSetting_('DRAFT_ONLY_MODE'));
  Logger.log('ALWAYS_ASK_APPROVAL: ' + getSetting_('ALWAYS_ASK_APPROVAL'));
  Logger.log('Sheet set: ' + !!CONFIG.SPREADSHEET_ID);
}

/** Safe end-to-end test with a fake comment — touches no real account. */
function testWithFakeComment() {
  processMessage_({
    id: 'TEST_' + Date.now(),
    text: 'بشحال هاد الموستكير؟ وواش كتوصلو لأكادير؟',
    author: 'زبون_تجريبي', platform: 'instagram', postId: 'TEST', kind: 'comment',
  });
  Logger.log('Done — check your email and the spreadsheet.');
}

/** Tries several message types, including a DM and Arabizi, all fake. */
function testManyMessages() {
  const cases = [
    { text: 'بشحال؟', kind: 'comment', platform: 'instagram' },
    { text: 'chhal hadi? o wach katwaslo l casa?', kind: 'comment', platform: 'instagram' },
    { text: 'بغيت نطلب وحدة دابا', kind: 'dm', platform: 'instagram' },
    { text: 'واش كاين ضمان؟', kind: 'comment', platform: 'facebook' },
    { text: 'واش كتديرو الكوليسان؟', kind: 'comment', platform: 'youtube' },
    { text: 'شنو الألوان لي كاينين؟', kind: 'comment', platform: 'tiktok' },
  ];
  cases.forEach((c, i) => {
    processMessage_({
      id: 'TEST_' + Date.now() + '_' + i,
      text: c.text, author: 'تجربة_' + i,
      platform: c.platform, postId: 'TEST', threadId: 'TEST', kind: c.kind,
    });
    Utilities.sleep(1200);
  });
  Logger.log('Done — check the spreadsheet for all ' + cases.length + '.');
}
