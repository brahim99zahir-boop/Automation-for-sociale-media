/**
 * Dashboard.gs — the private control panel.
 *
 * Reached at:  <web app url>?dash=<token>     (run setupDashboard() to get the URL)
 *
 * SECURITY, STATED PLAINLY
 *
 * The web app has to be deployed "Execute as: Me / Who has access: Anyone". That is not
 * a choice — Meta's webhook verifier is anonymous, and the Approve buttons in your email
 * have to work from your phone without a Google sign-in. A consequence of "Anyone" is
 * that Session.getActiveUser() comes back empty, so the script cannot tell who is
 * knocking. There is no identity to check.
 *
 * So the dashboard is protected by a 64-character random token instead, compared in
 * constant time. Practically: the dashboard URL IS the password. Don't paste it into a
 * group chat, and if it leaks run resetDashboardToken() to invalidate it.
 *
 * Two deliberate choices follow from that:
 *   - The default page (no token) shows nothing but "the service is running". No stats,
 *     no customer messages, no numbers — anyone can hit that URL.
 *   - Anything that CHANGES state goes through doPost, never a GET link. Link scanners
 *     and mail-preview fetchers follow GET URLs; a scanner must not be able to switch
 *     your automation off by opening an email.
 */

function renderDashboard_() {
  const sh = safeSheet_();
  const rows = sh ? sh.getDataRange().getValues().slice(1) : [];
  const today = Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd');

  const todayRows = rows.filter(r => String(r[0]).indexOf(today) === 0);
  const running = getSetting_('AUTOMATION_ENABLED');
  const u7 = usageWindow_(7);
  const u30 = usageWindow_(30);
  const todayUse = usageForDay_(today);
  const todayCost = costOf_(todayUse);

  const count = (rs, lead) => rs.filter(r => r[6] === lead).length;

  return HtmlService.createHtmlOutput(
    dashboardHtml_({
      running: running,
      today: today,
      todayRows: todayRows,
      allRows: rows,
      stats: {
        todayTotal: todayRows.length,
        todayHot: count(todayRows, 'ساخن'),
        todayWarm: count(todayRows, 'دافئ'),
        allTotal: rows.length,
        allHot: count(rows, 'ساخن'),
        pending: rows.filter(r => String(r[8]).indexOf('بانتظار') === 0).length,
      },
      cost: { today: todayCost, week: u7.cost, month: u30.cost, series: u7.series },
      tokens: { today: todayUse, month: u30.total },
      toggles: {
        DRAFT_ONLY_MODE: getSetting_('DRAFT_ONLY_MODE'),
        ALWAYS_ASK_APPROVAL: getSetting_('ALWAYS_ASK_APPROVAL'),
        DAILY_SUMMARY: getSetting_('DAILY_SUMMARY'),
      },
      platforms: Object.keys(PLATFORMS).map(k => ({
        key: k, label: PLATFORM_LABEL[k] || k, on: platformEnabled_(k),
      })),
      sheetUrl: CONFIG.SPREADSHEET_ID
        ? 'https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID
        : '',
    })
  ).setTitle('فيها خير — لوحة التحكم')
   .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** The sheet, or null — the dashboard must still render before setupSheet() has run. */
function safeSheet_() {
  try { return getSheet_(); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// STATE CHANGES (POST only — see the security note at the top)
// ---------------------------------------------------------------------------

/**
 * Handles a dashboard action. Returns a plain object; doPost serialises it.
 * Every action re-checks the token: the page being open is not authorisation.
 */
function handleDashboardAction_(body) {
  if (!dashboardTokenValid_(body.dash)) return { ok: false, error: 'forbidden' };

  switch (body.action) {
    case 'stop':
      setSetting_('AUTOMATION_ENABLED', false);
      return { ok: true, running: false };

    case 'start':
      setSetting_('AUTOMATION_ENABLED', true);
      return { ok: true, running: true };

    case 'toggle': {
      const key = String(body.key || '');
      if (!(key in SETTABLE)) return { ok: false, error: 'unknown setting' };
      const next = !getSetting_(key);
      setSetting_(key, next);
      return { ok: true, key: key, value: next };
    }

    case 'platform': {
      const name = String(body.key || '');
      if (!(name in PLATFORMS)) return { ok: false, error: 'unknown platform' };
      const next = !platformEnabled_(name);
      setPlatformEnabled_(name, next);
      return { ok: true, key: name, value: next };
    }

    default:
      return { ok: false, error: 'unknown action' };
  }
}

/** If the dashboard token ever leaks, run this and re-run setupDashboard(). */
function resetDashboardToken() {
  PropertiesService.getScriptProperties().deleteProperty(PROP.DASHBOARD_TOKEN);
  return setupDashboard();
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------

function money_(c) { return c.mad.toFixed(2) + ' درهم'; }
function usd_(c) { return '$' + c.usd.toFixed(4); }

function dashboardHtml_(d) {
  const s = d.stats;

  // Sparkline over the 7-day cost series, drawn as plain divs — no chart library,
  // because the page has to work with no external requests at all.
  const peak = Math.max.apply(null, d.cost.series.map(x => x.cost.mad).concat([0.01]));
  const bars = d.cost.series.map(x =>
    '<div class="bar" title="' + x.day + ' — ' + x.cost.mad.toFixed(2) + ' درهم">' +
      '<div class="fill" style="height:' + Math.max(2, (x.cost.mad / peak) * 100) + '%"></div>' +
      '<span>' + x.day.slice(8) + '</span>' +
    '</div>').join('');

  const toggleRow = (key, label, hint) =>
    '<label class="row"><span><b>' + label + '</b><small>' + hint + '</small></span>' +
    '<input type="checkbox" data-act="toggle" data-key="' + key + '"' +
    (d.toggles[key] ? ' checked' : '') + '></label>';

  const platformRows = d.platforms.map(p =>
    '<label class="row"><span><b>' + escapeHtml_(p.label) + '</b></span>' +
    '<input type="checkbox" data-act="platform" data-key="' + p.key + '"' +
    (p.on ? ' checked' : '') + '></label>').join('');

  // Newest first, capped — the sheet is the full archive, this is the recent view.
  const recent = d.allRows.slice(-60).reverse().map(r =>
    '<tr>' +
      '<td class="dim">' + escapeHtml_(String(r[0])) + '</td>' +
      '<td>' + escapeHtml_(String(r[1])) + '</td>' +
      '<td>' + escapeHtml_(String(r[3])) + '</td>' +
      '<td class="msg">' + escapeHtml_(String(r[4])) + '</td>' +
      '<td><span class="lead lead-' + leadClass_(r[6]) + '">' +
        escapeHtml_(String(r[6])) + '</span></td>' +
      '<td class="msg">' + escapeHtml_(String(r[7])) + '</td>' +
      '<td class="dim">' + escapeHtml_(String(r[8])) + '</td>' +
    '</tr>').join('');

  return '' +
'<!-- self-contained: no external CSS, JS, fonts or images, so it loads anywhere -->' +
// The dashboard token is in the URL, so the browser would otherwise put it in the Referer
// header of every outbound click (the Anthropic console link, the spreadsheet link) and
// hand the password to a third party. Document-level policy, plus rel=noreferrer per link.
'<meta name="referrer" content="no-referrer">' +
'<style>' +
' *{box-sizing:border-box}' +
' body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,Arial,sans-serif;' +
'   background:#f6f7f9;color:#111827;direction:rtl}' +
' .wrap{max-width:1100px;margin:0 auto;padding:20px 16px 60px}' +
' h1{font-size:20px;margin:0 0 2px} .sub{color:#6b7280;font-size:13px;margin:0 0 20px}' +
' .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-bottom:14px}' +
' .hero{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}' +
' .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:99px;' +
'   font-weight:700;font-size:14px}' +
' .on{background:#dcfce7;color:#166534} .off{background:#fee2e2;color:#991b1b}' +
' .dot{width:9px;height:9px;border-radius:50%;background:currentColor}' +
' button.big{border:0;border-radius:12px;padding:14px 26px;font-size:15px;font-weight:700;' +
'   cursor:pointer;color:#fff}' +
' .stop{background:#dc2626} .start{background:#16a34a}' +
' button.big:disabled{opacity:.5;cursor:wait}' +
' .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}' +
' .kpi{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:14px}' +
' .kpi b{display:block;font-size:26px;line-height:1.2} .kpi span{color:#6b7280;font-size:12px}' +
' .hot b{color:#dc2626} .warm b{color:#ea580c}' +
' .chart{display:flex;align-items:flex-end;gap:6px;height:110px;margin-top:10px}' +
' .bar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}' +
' .fill{width:100%;background:linear-gradient(180deg,#60a5fa,#2563eb);border-radius:5px 5px 0 0}' +
' .bar span{font-size:10px;color:#9ca3af;margin-top:4px}' +
' .row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;' +
'   border-bottom:1px solid #f0f1f3}' +
' .row:last-child{border-bottom:0} .row small{display:block;color:#6b7280;font-weight:400;font-size:12px}' +
' input[type=checkbox]{width:44px;height:26px;appearance:none;background:#d1d5db;border-radius:99px;' +
'   position:relative;cursor:pointer;transition:background .15s;flex:0 0 auto}' +
' input[type=checkbox]:checked{background:#16a34a}' +
' input[type=checkbox]::after{content:"";position:absolute;top:3px;right:3px;width:20px;height:20px;' +
'   background:#fff;border-radius:50%;transition:transform .15s}' +
' input[type=checkbox]:checked::after{transform:translateX(-18px)}' +
' .tablewrap{overflow-x:auto}' +
' table{width:100%;border-collapse:collapse;font-size:13px;min-width:760px}' +
' th{text-align:right;color:#6b7280;font-weight:600;font-size:11px;padding:8px;' +
'   border-bottom:2px solid #e5e7eb;white-space:nowrap}' +
' td{padding:9px 8px;border-bottom:1px solid #f3f4f6;vertical-align:top}' +
' td.dim{color:#9ca3af;font-size:11px;white-space:nowrap}' +
' td.msg{max-width:280px}' +
' .lead{padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;white-space:nowrap}' +
' .lead-hot{background:#fee2e2;color:#991b1b} .lead-warm{background:#ffedd5;color:#9a3412}' +
' .lead-cold{background:#f1f5f9;color:#475569}' +
' .note{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;' +
'   font-size:13px;color:#78350f;line-height:1.6}' +
' a{color:#2563eb}' +
' @media (prefers-color-scheme:dark){' +
'  body{background:#0b0f19;color:#e5e7eb}' +
'  .card,.kpi{background:#131a2a;border-color:#1f2937}' +
'  .row{border-color:#1f2937} th{border-color:#1f2937} td{border-color:#161e2e}' +
'  .note{background:#251d06;border-color:#5b4708;color:#fcd34d}' +
'  input[type=checkbox]{background:#374151}' +
'  .lead-cold{background:#1f2937;color:#9ca3af}' +
' }' +
'</style>' +

'<div class="wrap">' +
  '<h1>فيها خير — لوحة التحكم</h1>' +
  '<p class="sub">' + d.today + '</p>' +

  // ---- master switch ----
  '<div class="card hero">' +
    '<div>' +
      '<span id="pill" class="pill ' + (d.running ? 'on' : 'off') + '">' +
        '<span class="dot"></span><span id="pilltext">' +
        (d.running ? 'الأوتوماسيون خدام' : 'الأوتوماسيون واقف') + '</span></span>' +
      '<p class="sub" style="margin:10px 0 0">كيتشيك كل 15 دقيقة على سيرفرات جوجل. ' +
        'ما كيحتاجش الحاسوب ديالك يكون مشعل.</p>' +
    '</div>' +
    '<button id="power" class="big ' + (d.running ? 'stop' : 'start') + '">' +
      (d.running ? 'وقف الأوتوماسيون' : 'شغل الأوتوماسيون') + '</button>' +
  '</div>' +

  // ---- today ----
  '<div class="grid">' +
    kpi_(s.todayTotal, 'رسائل اليوم', '') +
    kpi_(s.todayHot, 'ساخن اليوم', 'hot') +
    kpi_(s.todayWarm, 'دافئ اليوم', 'warm') +
    kpi_(s.pending, 'بانتظار موافقتك', '') +
    kpi_(s.allTotal, 'المجموع الكلي', '') +
  '</div>' +

  // ---- cost ----
  '<div class="card">' +
    '<h1 style="font-size:16px">التكلفة</h1>' +
    '<p class="sub">حساب حقيقي من عدد الكلمات اللي مشات وجات، ماشي تقدير.</p>' +
    '<div class="grid">' +
      kpi_(money_(d.cost.today), 'اليوم', '') +
      kpi_(money_(d.cost.week), 'آخر 7 أيام', '') +
      kpi_(money_(d.cost.month), 'آخر 30 يوم', '') +
      kpi_(d.tokens.month.calls, 'طلب على Claude (30 يوم)', '') +
    '</div>' +
    '<div class="chart">' + bars + '</div>' +
    '<p class="sub" style="margin-top:14px">' +
      'بالدولار: اليوم ' + usd_(d.cost.today) + ' • 30 يوم ' + usd_(d.cost.month) + '. ' +
      'النموذج ' + escapeHtml_(CONFIG.CLAUDE_MODEL) + ' — ' +
      PRICE_PER_MTOK.input + '$ لكل مليون كلمة داخلة، ' +
      PRICE_PER_MTOK.output + '$ لكل مليون خارجة.</p>' +
    '<div class="note">' +
      '<b>الرصيد اللي باقي عندك ف Claude:</b> ما كاينش شي طريقة رسمية باش السكريبت يقراه — ' +
      'الـ API ديال Anthropic كيعطي غير التكلفة ديال كل طلب، ماشي الرصيد. ' +
      'الأرقام اللي فوق هي المصروف الحقيقي المحسوب هنا. باش تشوف الرصيد الباقي: ' +
      '<a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer">' +
      'console.anthropic.com ←</a>' +
    '</div>' +
  '</div>' +

  // ---- switches ----
  '<div class="card">' +
    '<h1 style="font-size:16px">الإعدادات</h1>' +
    '<p class="sub">كيتبدلو دغيا، ما كيحتاجوش تعاود تنشر السكريبت.</p>' +
    toggleRow('DRAFT_ONLY_MODE', 'وضع الاختبار',
      'محلول = ما كينشر والو، غير كيكتب ليك المسودة ف الإيميل') +
    toggleRow('ALWAYS_ASK_APPROVAL', 'سولني قبل كل رد',
      'طفيه ملي تولي واثق من الردود') +
    toggleRow('DAILY_SUMMARY', 'ملخص يومي ف 20:00', '') +
  '</div>' +

  '<div class="card">' +
    '<h1 style="font-size:16px">المنصات</h1>' +
    '<p class="sub">حل غير اللي عندك الكود ديالها جاهز.</p>' +
    platformRows +
  '</div>' +

  // ---- messages ----
  '<div class="card">' +
    '<h1 style="font-size:16px">آخر الردود</h1>' +
    '<p class="sub">آخر 60 رسالة. ' +
      (d.sheetUrl ? '<a href="' + d.sheetUrl + '" target="_blank" rel="noreferrer">الجدول الكامل ←</a>' : '') +
    '</p>' +
    '<div class="tablewrap"><table>' +
      '<tr><th>الوقت</th><th>المنصة</th><th>العميل</th><th>الرسالة</th>' +
      '<th>الاهتمام</th><th>الرد</th><th>الحالة</th></tr>' +
      (recent || '<tr><td colspan="7" class="dim">ما كاين حتى شي حاجة دابا.</td></tr>') +
    '</table></div>' +
  '</div>' +
'</div>' +

'<script>' +
// Every change is a POST carrying the token. A GET would be followed by link
// scanners and mail previewers, which could switch the automation off by accident.
'var TOKEN=' + JSON.stringify(getDashToken_()) + ';' +
'function post(payload){' +
'  return fetch(window.location.pathname+window.location.search,{' +
'    method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},' +
'    body:JSON.stringify(Object.assign({dash:TOKEN},payload))' +
'  }).then(function(r){return r.json()});' +
'}' +
'var power=document.getElementById("power");' +
'power.onclick=function(){' +
'  var running=power.classList.contains("stop");' +
'  power.disabled=true;' +
'  post({action:running?"stop":"start"}).then(function(res){' +
'    if(!res.ok){alert("ما تبدل والو: "+res.error);power.disabled=false;return}' +
'    var pill=document.getElementById("pill");' +
'    power.classList.toggle("stop",!res.running);power.classList.toggle("start",res.running);' +
'    power.textContent=res.running?"وقف الأوتوماسيون":"شغل الأوتوماسيون";' +
'    pill.className="pill "+(res.running?"on":"off");' +
'    document.getElementById("pilltext").textContent=' +
'      res.running?"الأوتوماسيون خدام":"الأوتوماسيون واقف";' +
'    power.disabled=false;' +
'  }).catch(function(e){alert(e);power.disabled=false});' +
'};' +
'Array.prototype.forEach.call(document.querySelectorAll("input[data-act]"),function(el){' +
'  el.onchange=function(){' +
'    el.disabled=true;' +
'    post({action:el.dataset.act,key:el.dataset.key}).then(function(res){' +
'      if(!res.ok){alert("ما تبدل والو: "+res.error);el.checked=!el.checked}' +
'      else{el.checked=res.value}' +
'      el.disabled=false;' +
'    }).catch(function(e){alert(e);el.checked=!el.checked;el.disabled=false});' +
'  };' +
'});' +
'</script>';
}

function kpi_(value, label, cls) {
  return '<div class="kpi ' + cls + '"><b>' + escapeHtml_(String(value)) + '</b>' +
         '<span>' + label + '</span></div>';
}

function leadClass_(lead) {
  if (lead === 'ساخن') return 'hot';
  if (lead === 'دافئ') return 'warm';
  return 'cold';
}

function getDashToken_() {
  return PropertiesService.getScriptProperties().getProperty(PROP.DASHBOARD_TOKEN) || '';
}
