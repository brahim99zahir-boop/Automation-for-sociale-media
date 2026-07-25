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
 * Safety: while CONFIG.DRAFT_ONLY_MODE is true, nothing is ever posted or sent.
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
    let total = 0;
    for (const name of Object.keys(PLATFORMS)) {
      const cfg = PLATFORMS[name];
      if (!cfg.enabled) continue;
      total += runPlatform_(name, cfg);
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

  const needsHuman = ai.needs_human || !!risky || CONFIG.ALWAYS_ASK_APPROVAL;

  if (!needsHuman && !CONFIG.DRAFT_ONLY_MODE) {
    deliver_(msg, ai);
    logToSheet_(msg, ai, msg.kind === 'dm' ? 'تجاوب ف الرسائل' : 'تم الرد تلقائيًا');
    return;
  }

  // Otherwise hold it and email the owner to decide.
  const token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(
    PROP.PENDING_PREFIX + token,
    JSON.stringify({
      msg: msg,
      reply: ai.reply,
      client_type: ai.client_type,
      lead: ai.lead,
      created: new Date().toISOString(),
    })
  );

  sendApprovalEmail_(msg, ai, token);
  logToSheet_(msg, ai, CONFIG.DRAFT_ONLY_MODE
    ? 'مسودة — بانتظار موافقتك (وضع الاختبار)'
    : 'بانتظار موافقتك');
}

/**
 * Actually send the reply. Blocked entirely while DRAFT_ONLY_MODE is on.
 * For public comments from warm/hot leads we also try a private reply carrying a
 * tappable wa.me link — a phone number in a comment isn't clickable, a DM link is.
 */
function deliver_(msg, ai) {
  if (CONFIG.DRAFT_ONLY_MODE) {
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
  if (!PLATFORMS.instagram.dm) return;
  if (ai.lead !== 'ساخن' && ai.lead !== 'دافئ') return;  // never spam cold commenters

  try {
    Instagram.privateReplyToComment(msg.id,
      'إلا بغيتي الثمن بالضبط، صيفط لينا القياس ديال الشباك هنا:\n' +
      whatsappLink_(msg.author));
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

  const raw = callClaudeWithRetry_(where + '\n' + instruction + '\n\n' + msg.text);
  return parseAiJson_(raw);
}

const SCRIPT_INSTRUCTION = {
  latin: '[SCRIPT: the customer wrote Darija in LATIN letters. Your "reply" MUST be in ' +
         'Latin letters too (e.g. "470 dh l metre. sift lia l9ias f whatsapp ' +
         '0666567672"). Do NOT reply in Arabic script.]',
  french: '[SCRIPT: the customer wrote French. Reply in simple French, prices as "470 DH".]',
  arabic: '[SCRIPT: the customer wrote Arabic letters. Reply in Arabic-script Darija.]',
};

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
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
      muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText()).content[0].text;

    if ((code !== 429 && code < 500) || attempt === 2) {
      throw new Error('Anthropic API ' + code + ': ' + res.getContentText().slice(0, 400));
    }
    Utilities.sleep(2000);
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
    (username ? ' (@' + username + ')' : '') + '، بغيت نسول على الموستيكير';
  return 'https://wa.me/' + CONFIG.WHATSAPP_INTL + '?text=' + encodeURIComponent(text);
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
    updateSheetStatus_('مرفوض — ما تنشرش');
    return html_('تم الرفض', 'ما تصيفط والو.');
  }

  if (CONFIG.DRAFT_ONLY_MODE) {
    updateSheetStatus_('موافق عليه — ولكن ما تصيفطش (وضع الاختبار)');
    return html_('تمت الموافقة',
      'وضع الاختبار مفعل، لذلك ما تصيفط والو. طفي DRAFT_ONLY_MODE باش يخدم بصح.');
  }

  try {
    deliver_(pending.msg, { reply: pending.reply, lead: pending.lead });
    updateSheetStatus_('تمت الموافقة وتصيفط');
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

  const draftNote = CONFIG.DRAFT_ONLY_MODE
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
      '<p style="margin-top:18px"><a href="' + whatsappLink_(msg.author) + '">' +
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
  if (!CONFIG.DAILY_SUMMARY) return;
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

function logToSheet_(msg, ai, status) {
  try {
    getSheet_().appendRow([
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
  } catch (err) {
    Logger.log('logToSheet failed: ' + err);   // logging must never break a reply
  }
}

/** Update the الحالة cell of the newest still-pending row. */
function updateSheetStatus_(status) {
  try {
    const sh = getSheet_();
    const last = sh.getLastRow();
    for (let r = last; r > 1 && r > last - 50; r--) {
      const cur = String(sh.getRange(r, 9).getValue());
      if (cur.indexOf('بانتظار') === 0 || cur.indexOf('مسودة') === 0) {
        sh.getRange(r, 9).setValue(status);
        return;
      }
    }
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
    Logger.log(k + ': ' + (c.enabled ? 'ON' : 'off') +
      ' (comments:' + !!c.comments + ' dm:' + !!c.dm + ')');
  });
  Logger.log('--- safety ---');
  Logger.log('DRAFT_ONLY_MODE:     ' + CONFIG.DRAFT_ONLY_MODE);
  Logger.log('ALWAYS_ASK_APPROVAL: ' + CONFIG.ALWAYS_ASK_APPROVAL);
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
