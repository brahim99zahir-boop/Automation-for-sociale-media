/**
 * Code.gs — AI comment-reply system for فيها خير (Mosiquaire), on Google Apps Script.
 *
 * The job of this system is not "answer comments" — it's to move interested people to
 * WhatsApp, because that's where the business actually sells. Every piece below serves that.
 *
 * Flow:
 *   checkForNewComments()  [timer, every 15 min]
 *     -> fetch recent Instagram comments
 *     -> skip ones already handled
 *     -> ask Claude for a reply + Arabic client_type + lead temperature
 *     -> guard: unverifiable spec claims are held for human review no matter what
 *     -> risky/uncertain -> email you Approve/Reject; nothing posted yet
 *        safe + trusted   -> post publicly, and optionally DM a tappable WhatsApp link
 *     -> log every outcome to the Arabic Google Sheet
 *
 *   doGet()   Meta webhook verification + your Approve/Reject clicks
 *   doPost()  live Instagram/Facebook comment webhooks (optional; polling alone works)
 *   dailySummary()  evening digest of the day's leads
 *
 * Safety: while CONFIG.DRAFT_ONLY_MODE is true, nothing is ever posted publicly.
 */

const GRAPH = 'https://graph.facebook.com/v21.0/';

// ---------------------------------------------------------------------------
// MAIN ENTRY POINT — installTrigger() attaches a timer to this
// ---------------------------------------------------------------------------

function checkForNewComments() {
  const lock = LockService.getScriptLock();
  // If the previous run is still going, skip rather than risk double-replying.
  if (!lock.tryLock(5000)) {
    Logger.log('Another run is in progress; skipping.');
    return;
  }
  try {
    const comments = fetchRecentComments_();
    Logger.log('Fetched ' + comments.length + ' comment(s).');

    let handled = 0;
    for (const c of comments) {
      if (isAlreadySeen_(c.id)) continue;
      markSeen_(c.id);    // mark BEFORE processing, so a crash can't cause a re-reply
      try {
        processComment_(c);
        handled++;
      } catch (err) {
        notifyError_('processComment', err, JSON.stringify(c));
      }
    }
    Logger.log('Processed ' + handled + ' new comment(s).');
  } catch (err) {
    notifyError_('checkForNewComments', err, '');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Core per-comment logic, shared by the poller and the webhook.
 */
function processComment_(comment) {
  const ai = generateReply_(comment.text);

  // Nothing worth saying (tag, emoji, spam) — log it and move on without replying.
  if (!ai.reply || !ai.reply.trim()) {
    logToSheet_(comment, ai, 'تجاهل — ماشي سؤال');
    return;
  }

  // Seatbelt: the model has been seen inventing a confident "yes" about specs it was
  // never told (colours, sliding models, guarantees). If the customer asked about one
  // of those, a human checks before anything goes public.
  const risky = mentionsUnverifiedTopic_(comment.text);
  if (risky) ai.guard = risky;

  const needsHuman = ai.needs_human || !!risky || CONFIG.ALWAYS_ASK_APPROVAL;

  if (!needsHuman && !CONFIG.DRAFT_ONLY_MODE) {
    postReply_(comment.id, ai.reply);
    maybeSendPrivateReply_(comment, ai);
    logToSheet_(comment, ai, 'تم الرد تلقائيًا');
    return;
  }

  // Otherwise hold it and email the owner to decide.
  const token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(
    PROP.PENDING_PREFIX + token,
    JSON.stringify({
      commentId: comment.id,
      text: comment.text,
      author: comment.author,
      platform: comment.platform,
      reply: ai.reply,
      client_type: ai.client_type,
      lead: ai.lead,
      created: new Date().toISOString(),
    })
  );

  sendApprovalEmail_(comment, ai, token);
  logToSheet_(comment, ai, CONFIG.DRAFT_ONLY_MODE
    ? 'مسودة — بانتظار موافقتك (وضع الاختبار)'
    : 'بانتظار موافقتك');
}

/** Returns the matched topic word, or '' if the comment is clear. */
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

function generateReply_(commentText) {
  const raw = callClaudeWithRetry_(commentText);
  return parseAiJson_(raw);
}

/** One retry on 429/5xx — transient API hiccups shouldn't lose a customer. */
function callClaudeWithRetry_(commentText) {
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
        messages: [{ role: 'user', content: commentText }],
      }),
      muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText()).content[0].text;

    const retryable = (code === 429 || code >= 500);
    if (!retryable || attempt === 2) {
      throw new Error('Anthropic API ' + code + ': ' + res.getContentText().slice(0, 400));
    }
    Utilities.sleep(2000);
  }
}

/**
 * Claude wraps its JSON in ```json fences and sometimes adds prose after it (confirmed
 * against the live API), so a plain JSON.parse fails. Strip fences, then take the first
 * balanced {...} block. Anything unparseable fails SAFE: held for a human, never posted.
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
          // An intentionally empty reply (spam) is valid — don't force it to human review.
          if (typeof p.reply !== 'string') return fallback;
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

// ---------------------------------------------------------------------------
// INSTAGRAM / FACEBOOK
// ---------------------------------------------------------------------------

function fetchRecentComments_() {
  if (!CONFIG.IG_USER_ID) {
    Logger.log('IG_USER_ID not set yet — nothing to poll.');
    return [];
  }
  const token = getSecret_(PROP.META_TOKEN);
  const out = [];

  const mediaUrl = GRAPH + CONFIG.IG_USER_ID + '/media?fields=id&limit=' +
    CONFIG.MEDIA_TO_SCAN + '&access_token=' + encodeURIComponent(token);
  const media = graphGet_(mediaUrl).data || [];

  for (const m of media) {
    const cUrl = GRAPH + m.id +
      '/comments?fields=id,text,username,timestamp&limit=25&access_token=' +
      encodeURIComponent(token);
    const comments = (graphGet_(cUrl).data) || [];
    for (const c of comments) {
      if (!c.text) continue;
      out.push({
        id: c.id,
        text: c.text,
        author: c.username || 'unknown',
        platform: 'instagram',
        postId: m.id,
      });
    }
  }
  return out;
}

function graphGet_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const body = res.getContentText();
  if (res.getResponseCode() !== 200) {
    throw new Error('Graph API ' + res.getResponseCode() + ': ' + body.slice(0, 400));
  }
  return JSON.parse(body);
}

/** Post a public reply. Blocked entirely while DRAFT_ONLY_MODE is on. */
function postReply_(commentId, message) {
  if (CONFIG.DRAFT_ONLY_MODE) {
    Logger.log('DRAFT_ONLY_MODE on — not posting. Would have replied: ' + message);
    return { skipped: true };
  }
  const res = UrlFetchApp.fetch(GRAPH + commentId + '/replies', {
    method: 'post',
    payload: { message: message, access_token: getSecret_(PROP.META_TOKEN) },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Post reply failed ' + res.getResponseCode() + ': ' +
      res.getContentText().slice(0, 400));
  }
  return JSON.parse(res.getContentText());
}

/**
 * Instagram allows ONE private message in response to a comment. A tappable wa.me
 * link in a DM converts far better than a phone number in a public comment, because
 * it opens WhatsApp with the message already typed — no copying, no saving a contact.
 * Only fired for people showing real buying intent, so it never feels like spam.
 */
function maybeSendPrivateReply_(comment, ai) {
  if (!CONFIG.SEND_PRIVATE_REPLY || CONFIG.DRAFT_ONLY_MODE) return;
  if (ai.lead !== 'ساخن' && ai.lead !== 'دافئ') return;

  try {
    const link = whatsappLink_(comment.author);
    const msg = 'إلا بغيتي الثمن بالضبط، صيفط لينا القياس ديال الشباك هنا:\n' + link;
    const res = UrlFetchApp.fetch(GRAPH + CONFIG.IG_USER_ID + '/messages', {
      method: 'post',
      payload: {
        recipient: JSON.stringify({ comment_id: comment.id }),
        message: JSON.stringify({ text: msg }),
        access_token: getSecret_(PROP.META_TOKEN),
      },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('Private reply skipped: ' + res.getContentText().slice(0, 200));
    }
  } catch (err) {
    Logger.log('Private reply failed: ' + err);   // never let a DM failure break the flow
  }
}

/** wa.me link that opens WhatsApp with the first message pre-written. */
function whatsappLink_(username) {
  const text = 'السلام عليكم، جاي من الانستغرام' +
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
    return html_('انتهت الصلاحية', 'هاد الطلب تعالج من قبل، ولا ما بقاش موجود.');
  }
  const pending = JSON.parse(raw);
  props.deleteProperty(key);   // single-use: a re-click can't post twice

  if (action === 'approve') {
    if (CONFIG.DRAFT_ONLY_MODE) {
      updateSheetStatus_('موافق عليه — ولكن ما تنشرش (وضع الاختبار)');
      return html_('تمت الموافقة',
        'وضع الاختبار مفعل، لذلك ما تنشر والو. طفي DRAFT_ONLY_MODE باش ينشر بصح.');
    }
    try {
      postReply_(pending.commentId, pending.reply);
      maybeSendPrivateReply_(
        { id: pending.commentId, author: pending.author, platform: pending.platform },
        { lead: pending.lead });
      updateSheetStatus_('تمت الموافقة ونُشر');
      return html_('تنشر ✅', escapeHtml_(pending.reply));
    } catch (err) {
      notifyError_('handleApproval/post', err, pending.commentId);
      return html_('خطأ', 'ما قدرناش ننشرو الرد: ' + escapeHtml_(String(err)));
    }
  }

  updateSheetStatus_('مرفوض — ما تنشرش');
  return html_('تم الرفض', 'ما تنشر والو.');
}

/** Live webhook (optional — polling alone also works). */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        const v = change.value || {};
        if (change.field !== 'comments' && change.field !== 'feed') continue;
        const id = v.id || v.comment_id;
        const text = v.text || v.message;
        if (!id || !text) continue;
        if (isAlreadySeen_(id)) continue;
        markSeen_(id);
        processComment_({
          id: id,
          text: text,
          author: (v.from && (v.from.username || v.from.name)) || 'unknown',
          platform: body.object === 'instagram' ? 'instagram' : 'facebook',
          postId: v.media ? v.media.id : v.post_id,
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

function sendApprovalEmail_(comment, ai, token) {
  const base = ScriptApp.getService().getUrl();
  const approve = base + '?action=approve&token=' + token;
  const reject = base + '?action=reject&token=' + token;
  const colour = LEAD_COLOUR[ai.lead] || '#64748b';

  const guardNote = ai.guard
    ? '<p style="background:#fef2f2;border-right:4px solid #dc2626;padding:10px;border-radius:6px">' +
      '<b>راه سول على: "' + escapeHtml_(ai.guard) + '"</b><br>' +
      'ما عندناش معلومة مؤكدة على هادشي، لذلك حبسناه ليك. قرا الرد مزيان قبل ما توافق.</p>'
    : '';

  const draftNote = CONFIG.DRAFT_ONLY_MODE
    ? '<p style="color:#b45309"><b>وضع الاختبار مفعل</b> — حتى إلا وافقتي، ما غادي ينشر والو.</p>'
    : '';

  const html =
    '<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px">' +
      '<div style="display:inline-block;background:' + colour + ';color:#fff;padding:4px 12px;' +
        'border-radius:99px;font-size:13px">' + escapeHtml_(ai.lead || '') + '</div>' +
      '<h2 style="margin:8px 0 2px">تعليق جديد</h2>' +
      '<p style="color:#666;margin:0 0 14px">' + escapeHtml_(comment.platform) + ' — @' +
        escapeHtml_(comment.author) + ' — ' + escapeHtml_(ai.client_type) + '</p>' +
      guardNote + draftNote +
      '<p style="background:#f3f4f6;padding:12px;border-radius:8px">' +
        escapeHtml_(comment.text) + '</p>' +
      '<p style="margin-bottom:4px"><b>الرد ديال الذكاء الاصطناعي:</b></p>' +
      '<p style="background:#ecfdf5;padding:12px;border-radius:8px">' +
        escapeHtml_(ai.reply) + '</p>' +
      '<p style="margin-top:22px">' +
        '<a href="' + approve + '" style="background:#16a34a;color:#fff;padding:12px 24px;' +
          'text-decoration:none;border-radius:6px;margin-left:8px">وافق وانشر</a>' +
        '<a href="' + reject + '" style="background:#dc2626;color:#fff;padding:12px 24px;' +
          'text-decoration:none;border-radius:6px">ارفض</a>' +
      '</p>' +
      '<p style="margin-top:18px"><a href="' + whatsappLink_(comment.author) + '">' +
        'ولا بدا معاه الحديث ديريكت ف الواتساب ←</a></p>' +
      '<p style="color:#9ca3af;font-size:12px;margin-top:22px">الروابط كيخدموا مرة وحدة.</p>' +
    '</div>';

  GmailApp.sendEmail(CONFIG.OWNER_EMAIL,
    (ai.lead === 'ساخن' ? '🔥 ' : '') + 'رد جديد — @' + comment.author,
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

/**
 * Evening digest: what came in today, and which leads are worth chasing on WhatsApp.
 * Attach a daily trigger with installTrigger().
 */
function dailySummary() {
  if (!CONFIG.DAILY_SUMMARY) return;
  try {
    const sh = getSheet_();
    const today = Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd');
    const rows = sh.getDataRange().getValues().slice(1)
      .filter(r => String(r[0]).indexOf(today) === 0);

    if (!rows.length) return;   // nothing happened; don't send an empty email

    const hot = rows.filter(r => r[5] === 'ساخن');
    const warm = rows.filter(r => r[5] === 'دافئ');

    let html = '<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px">' +
      '<h2>ملخص اليوم — ' + today + '</h2>' +
      '<p>' + rows.length + ' تعليق • <b style="color:#dc2626">' + hot.length +
      ' ساخن</b> • ' + warm.length + ' دافئ</p>';

    if (hot.length) {
      html += '<h3>الزبناء الساخنين — تبعهم ف الواتساب</h3><ul>';
      hot.forEach(r => {
        html += '<li><b>@' + escapeHtml_(r[2]) + '</b> — ' + escapeHtml_(r[3]) + '</li>';
      });
      html += '</ul>';
    }
    html += '<p><a href="' + SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getUrl() +
      '">شوف الجدول كامل ←</a></p></div>';

    GmailApp.sendEmail(CONFIG.OWNER_EMAIL,
      'ملخص اليوم — ' + hot.length + ' زبون ساخن',
      rows.length + ' تعليق اليوم',
      { htmlBody: html, name: 'فيها خير — نظام الرد الآلي' });
  } catch (err) {
    Logger.log('dailySummary failed: ' + err);
  }
}

// ---------------------------------------------------------------------------
// GOOGLE SHEET (Arabic client log)
// ---------------------------------------------------------------------------

const HEADERS = ['التاريخ', 'المنصة', 'اسم العميل', 'التعليق',
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
  sh.setColumnWidth(4, 280);
  sh.setColumnWidth(7, 280);

  // Colour the lead column so hot leads jump out at a glance.
  const leadCol = sh.getRange('F2:F1000');
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ساخن')
      .setBackground('#fee2e2').setFontColor('#991b1b').setRanges([leadCol]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('دافئ')
      .setBackground('#ffedd5').setFontColor('#9a3412').setRanges([leadCol]).build(),
  ];
  sh.setConditionalFormatRules(rules);

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

function logToSheet_(comment, ai, status) {
  try {
    getSheet_().appendRow([
      Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd HH:mm'),
      comment.platform,
      comment.author,
      comment.text,
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
      const cur = String(sh.getRange(r, 8).getValue());
      if (cur.indexOf('بانتظار') === 0 || cur.indexOf('مسودة') === 0) {
        sh.getRange(r, 8).setValue(status);
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
    .setProperty(PROP.SEEN_IDS, JSON.stringify(list.slice(-500)));
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
    if (f === 'checkForNewComments' || f === 'dailySummary') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkForNewComments').timeBased().everyMinutes(15).create();
  if (CONFIG.DAILY_SUMMARY) {
    ScriptApp.newTrigger('dailySummary').timeBased().atHour(20).everyDays(1).create();
  }
  Logger.log('Triggers installed: comments every 15 min' +
    (CONFIG.DAILY_SUMMARY ? ', daily summary at 20:00.' : '.'));
}

/**
 * Safe end-to-end test with a fake comment — touches no real Instagram post.
 * Generates a reply, logs it, and emails you the approval links.
 */
function testWithFakeComment() {
  processComment_({
    id: 'TEST_' + Date.now(),
    text: 'بشحال هاد الموستكير؟ وواش كتوصلو لأكادير؟',
    author: 'زبون_تجريبي',
    platform: 'instagram',
    postId: 'TEST',
  });
  Logger.log('Done — check your email and the spreadsheet.');
}

/** Try several comment types at once to see how the AI handles each. */
function testManyComments() {
  ['بشحال؟', 'بغيت نطلب وحدة', 'واش كاين ضمان؟', 'غالي بزاف', 'تبارك الله عليكم']
    .forEach((t, i) => {
      processComment_({
        id: 'TEST_' + Date.now() + '_' + i,
        text: t, author: 'تجربة_' + i, platform: 'instagram', postId: 'TEST',
      });
      Utilities.sleep(1000);
    });
  Logger.log('Done — check the spreadsheet for all 5.');
}
