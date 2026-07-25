/**
 * Code.gs — AI comment-reply system for فيها خير (Mosiquaire), on Google Apps Script.
 *
 * Flow:
 *   checkForNewComments()  [runs on a timer]
 *     -> fetch recent Instagram comments
 *     -> skip ones already handled
 *     -> ask Claude for a reply + an Arabic client_type
 *     -> sensitive/uncertain -> email you Approve/Reject links; nothing posted yet
 *        safe + trusted     -> post immediately
 *     -> log every outcome to the Arabic Google Sheet
 *
 *   doGet()  handles Meta's webhook verification AND your Approve/Reject clicks
 *   doPost() handles live Instagram/Facebook comment webhooks (optional; polling
 *            alone is enough to run the system)
 *
 * Safety: while CONFIG.DRAFT_ONLY_MODE is true, nothing is ever posted publicly.
 */

const GRAPH = 'https://graph.facebook.com/v21.0/';

// ---------------------------------------------------------------------------
// MAIN ENTRY POINT — attach a time-driven trigger to this (installTrigger())
// ---------------------------------------------------------------------------

function checkForNewComments() {
  const lock = LockService.getScriptLock();
  // If the previous run is still going, skip this one rather than double-replying.
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
      markSeen_(c.id);          // mark BEFORE processing, so a crash can't cause a re-reply
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
 * Core per-comment logic. Shared by the poller and the webhook.
 */
function processComment_(comment) {
  const ai = generateReply_(comment.text);

  // Decide whether a human must see this first.
  const needsHuman = ai.needs_human || CONFIG.ALWAYS_ASK_APPROVAL;

  if (!needsHuman && !CONFIG.DRAFT_ONLY_MODE) {
    postReply_(comment.id, ai.reply);
    logToSheet_(comment, ai, 'تم الرد تلقائيًا');
    return;
  }

  // Otherwise: hold it, and email the owner to decide.
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
      created: new Date().toISOString(),
    })
  );

  sendApprovalEmail_(comment, ai, token);
  logToSheet_(comment, ai, CONFIG.DRAFT_ONLY_MODE
    ? 'مسودة — بانتظار موافقتك (وضع الاختبار)'
    : 'بانتظار موافقتك');
}

// ---------------------------------------------------------------------------
// CLAUDE
// ---------------------------------------------------------------------------

function generateReply_(commentText) {
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
  if (code !== 200) {
    throw new Error('Anthropic API ' + code + ': ' + res.getContentText().slice(0, 400));
  }

  const raw = JSON.parse(res.getContentText()).content[0].text;
  return parseAiJson_(raw);
}

/**
 * Claude wraps its JSON in ```json fences and sometimes adds prose after it
 * (confirmed against the live API), so a plain JSON.parse fails. Strip fences,
 * then take the first balanced {...} block.
 * Anything unparseable fails SAFE: routed to a human rather than posted.
 */
function parseAiJson_(rawInput) {
  const raw = String(rawInput).replace(/```(?:json)?/gi, '').trim();
  const fallback = { reply: '', needs_human: true, client_type: 'غير محدد' };

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
          if (!p.reply || !String(p.reply).trim()) return fallback;
          return {
            reply: String(p.reply),
            needs_human: p.needs_human === true,
            client_type: p.client_type || 'غير محدد',
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

/** Pull comments from the most recent posts. */
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

/** Post a public reply to a comment. Blocked entirely while DRAFT_ONLY_MODE is on. */
function postReply_(commentId, message) {
  if (CONFIG.DRAFT_ONLY_MODE) {
    Logger.log('DRAFT_ONLY_MODE is on — not posting. Would have replied: ' + message);
    return { skipped: true };
  }
  const token = getSecret_(PROP.META_TOKEN);
  const res = UrlFetchApp.fetch(GRAPH + commentId + '/replies', {
    method: 'post',
    payload: { message: message, access_token: token },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Post reply failed ' + res.getResponseCode() + ': ' +
      res.getContentText().slice(0, 400));
  }
  return JSON.parse(res.getContentText());
}

// ---------------------------------------------------------------------------
// WEB APP — Meta verification + your Approve/Reject clicks
// ---------------------------------------------------------------------------

function doGet(e) {
  const p = (e && e.parameter) || {};

  // 1) Meta webhook verification handshake.
  if (p['hub.mode'] === 'subscribe') {
    if (p['hub.verify_token'] === CONFIG.META_VERIFY_TOKEN) {
      return ContentService.createTextOutput(p['hub.challenge']);
    }
    return ContentService.createTextOutput('Forbidden');
  }

  // 2) Approve / reject click from an email.
  if (p.action && p.token) {
    return handleApproval_(p.action, p.token);
  }

  return html_('نظام الرد الآلي', 'الخدمة تعمل ✅');
}

function handleApproval_(action, token) {
  const props = PropertiesService.getScriptProperties();
  const key = PROP.PENDING_PREFIX + token;
  const raw = props.getProperty(key);

  if (!raw) {
    return html_('انتهت الصلاحية',
      'هذا الطلب تمت معالجته من قبل، أو لم يعد موجودًا.');
  }
  const pending = JSON.parse(raw);
  props.deleteProperty(key);   // single-use: prevents double-posting on a re-click

  if (action === 'approve') {
    if (CONFIG.DRAFT_ONLY_MODE) {
      updateSheetStatus_(pending.commentId, 'موافق عليه — لكن لم يُنشر (وضع الاختبار)');
      return html_('تمت الموافقة',
        'وضع الاختبار مفعّل، لذلك لم يتم النشر. أطفئ DRAFT_ONLY_MODE للنشر الفعلي.');
    }
    try {
      postReply_(pending.commentId, pending.reply);
      updateSheetStatus_(pending.commentId, 'تمت الموافقة ونُشر');
      return html_('تم النشر ✅', 'الرد: ' + escapeHtml_(pending.reply));
    } catch (err) {
      notifyError_('handleApproval/post', err, pending.commentId);
      return html_('خطأ', 'ما قدرناش ننشرو الرد: ' + escapeHtml_(String(err)));
    }
  }

  updateSheetStatus_(pending.commentId, 'مرفوض — لم يُنشر');
  return html_('تم الرفض', 'ما تنشر والو. ');
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
  // Meta expects a fast 200 regardless.
  return ContentService.createTextOutput('EVENT_RECEIVED');
}

// ---------------------------------------------------------------------------
// EMAIL
// ---------------------------------------------------------------------------

function sendApprovalEmail_(comment, ai, token) {
  const base = ScriptApp.getService().getUrl();
  const approve = base + '?action=approve&token=' + token;
  const reject = base + '?action=reject&token=' + token;

  const draftNote = CONFIG.DRAFT_ONLY_MODE
    ? '<p style="color:#b45309"><b>وضع الاختبار مفعّل</b> — حتى لو وافقت، لن يُنشر أي رد.</p>'
    : '';

  const html =
    '<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px">' +
      '<h2 style="margin:0 0 4px">تعليق جديد يحتاج موافقتك</h2>' +
      '<p style="color:#666;margin:0 0 16px">' + escapeHtml_(comment.platform) + ' — ' +
        escapeHtml_(comment.author) + '</p>' +
      draftNote +
      '<p style="background:#f3f4f6;padding:12px;border-radius:8px">' +
        escapeHtml_(comment.text) + '</p>' +
      '<p><b>نوع العميل:</b> ' + escapeHtml_(ai.client_type) + '</p>' +
      '<p><b>الرد المقترح:</b></p>' +
      '<p style="background:#ecfdf5;padding:12px;border-radius:8px">' +
        escapeHtml_(ai.reply) + '</p>' +
      '<p style="margin-top:24px">' +
        '<a href="' + approve + '" style="background:#16a34a;color:#fff;padding:12px 24px;' +
          'text-decoration:none;border-radius:6px;margin-left:8px">وافق وانشر</a>' +
        '<a href="' + reject + '" style="background:#dc2626;color:#fff;padding:12px 24px;' +
          'text-decoration:none;border-radius:6px">ارفض</a>' +
      '</p>' +
emailFooter_() +
    '</div>';

  GmailApp.sendEmail(CONFIG.OWNER_EMAIL,
    'رد جديد يحتاج موافقتك — ' + comment.author,
    ai.reply,          // plain-text fallback
    { htmlBody: html, name: 'فيها خير — نظام الرد الآلي' });
}

function emailFooter_() {
  return '<p style="color:#9ca3af;font-size:12px;margin-top:24px">' +
    'الروابط تعمل مرة واحدة فقط.</p>';
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

// ---------------------------------------------------------------------------
// GOOGLE SHEET (Arabic client log)
// ---------------------------------------------------------------------------

const HEADERS = ['التاريخ', 'المنصة', 'اسم العميل', 'التعليق', 'نوع العميل', 'الرد', 'الحالة'];

/** Run once. Creates the spreadsheet with Arabic headers and logs its ID. */
function setupSheet() {
  let ss;
  if (CONFIG.SPREADSHEET_ID) {
    ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } else {
    ss = SpreadsheetApp.create('عملاء فيها خير');
  }
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  sh.clear();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setRightToLeft(true);
  sh.setFrozenRows(1);
  sh.setColumnWidth(4, 300);
  sh.setColumnWidth(6, 300);

  Logger.log('Spreadsheet ready: ' + ss.getUrl());
  Logger.log('PASTE THIS INTO Config.gs SPREADSHEET_ID: ' + ss.getId());
  return ss.getId();
}

function getSheet_() {
  if (!CONFIG.SPREADSHEET_ID) throw new Error('SPREADSHEET_ID not set — run setupSheet() first.');
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CONFIG.SHEET_NAME);
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
      ai.reply,
      status,
    ]);
  } catch (err) {
    Logger.log('logToSheet failed: ' + err);   // never let logging break a reply
  }
}

/** Update the الحالة cell of the most recent row for a comment. */
function updateSheetStatus_(commentId, status) {
  try {
    const sh = getSheet_();
    const last = sh.getLastRow();
    // We don't store the comment id in the sheet, so update the newest matching
    // pending row from the bottom up — good enough at this volume.
    for (let r = last; r > 1 && r > last - 50; r--) {
      const cur = sh.getRange(r, 7).getValue();
      if (String(cur).indexOf('بانتظار') === 0 || String(cur).indexOf('مسودة') === 0) {
        sh.getRange(r, 7).setValue(status);
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

function isAlreadySeen_(id) {
  return seenList_().indexOf(id) !== -1;
}

function markSeen_(id) {
  const list = seenList_();
  list.push(id);
  // Keep the newest 500 so the property never outgrows its size limit.
  const trimmed = list.slice(-500);
  PropertiesService.getScriptProperties()
    .setProperty(PROP.SEEN_IDS, JSON.stringify(trimmed));
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

/** Run once to start the 15-minute polling timer. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'checkForNewComments') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkForNewComments').timeBased().everyMinutes(15).create();
  Logger.log('Trigger installed: checkForNewComments every 15 minutes.');
}

/**
 * Safe end-to-end test. Uses a fake comment, so it touches no real Instagram
 * post: generates a reply, logs it, and emails you the approval links.
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
