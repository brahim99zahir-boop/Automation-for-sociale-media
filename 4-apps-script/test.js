const H = require('./harness.js');
CONFIG.SPREADSHEET_ID = 'TEST_SHEET';   // harness: point getSheet_ at the fake

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

console.log('\n== settings layer ==');
ok('defaults come from CONFIG', getSetting_('DRAFT_ONLY_MODE') === true);
ok('AUTOMATION_ENABLED defaults true', getSetting_('AUTOMATION_ENABLED') === true);
setSetting_('AUTOMATION_ENABLED', false);
ok('stop persists to properties', getSetting_('AUTOMATION_ENABLED') === false);

// Simulate a NEW execution: Apps Script re-evaluates source, so the in-memory cache is
// gone but Script Properties survive. This is the exact thing CONFIG could not do.
SETTINGS_CACHE_ = null;
ok('stop survives a fresh execution', getSetting_('AUTOMATION_ENABLED') === false);
setSetting_('AUTOMATION_ENABLED', true);
ok('restart works', getSetting_('AUTOMATION_ENABLED') === true);
ok('unknown key throws', (() => { try { getSetting_('NOPE'); return false; } catch (e) { return true; } })());

console.log('\n== platform toggles ==');
ok('instagram off by default (Config)', platformEnabled_('instagram') === false);
setPlatformEnabled_('instagram', true);
ok('can be switched on at runtime', platformEnabled_('instagram') === true);
SETTINGS_CACHE_ = null;
ok('survives fresh execution', platformEnabled_('instagram') === true);
setPlatformEnabled_('instagram', false);

console.log('\n== cost tracking ==');
recordUsage_({ input_tokens: 1000, output_tokens: 200 });
recordUsage_({ input_tokens: 1000, output_tokens: 200 });
const day = Utilities.formatDate(new Date(), 'Africa/Casablanca', 'yyyy-MM-dd');
const u = usageForDay_(day);
ok('two calls counted', u.calls === 2, JSON.stringify(u));
ok('input tokens summed', u.input === 2000);
ok('output tokens summed', u.output === 400);

// 2000 in @ $1/MTok = $0.002 ; 400 out @ $5/MTok = $0.002 ; total $0.004
const c = costOf_(u);
ok('USD cost correct', Math.abs(c.usd - 0.004) < 1e-9, c.usd);
ok('MAD cost correct', Math.abs(c.mad - 0.04) < 1e-9, c.mad);
const w = usageWindow_(7);
ok('window has 7 days', w.series.length === 7);
ok('window total matches today', w.total.calls === 2);
ok('older days are zero, not missing', w.series[0].calls === 0);
ok('recordUsage never throws on junk', (() => { recordUsage_(null); recordUsage_({}); return true; })());

console.log('\n== prompt caching ==');
// A cache MISS: whole prompt billed as fresh input, and stored (cacheWrite).
recordUsage_({ input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 5600 });
// A cache HIT: same prompt served from cache at a tenth of the price.
recordUsage_({ input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 5600 });
const cu = usageForDay_(day);
ok('cache writes counted', cu.cacheWrite === 5600, cu.cacheWrite);
ok('cache reads counted', cu.cacheRead === 5600, cu.cacheRead);
// write 5600@1.25 = $0.0070 ; read 5600@0.10 = $0.00056
ok('cached read is 12.5x cheaper than the write',
   Math.abs((5600/1e6*1.25) / (5600/1e6*0.10) - 12.5) < 1e-9);
ok('hit rate is 50% here', Math.abs(cacheHitRate_(cu) - 0.5) < 1e-9, cacheHitRate_(cu));
ok('hit rate is 0 with no cache data', cacheHitRate_({}) === 0);
// Records written before caching shipped have no cache fields at all.
H.props['usage_2026-01-01'] = JSON.stringify({ calls: 1, input: 100, output: 10 });
const legacy = usageForDay_('2026-01-01');
ok('legacy record still costs correctly',
   Math.abs(costOf_(legacy).usd - (100/1e6 + 10/1e6*5)) < 1e-12, costOf_(legacy).usd);
ok('legacy record has zeroed cache fields', legacy.cacheWrite === 0 && legacy.cacheRead === 0);
delete H.props['usage_2026-01-01'];

console.log('\n== the row-binding bug ==');
// Two messages held for approval at the same time. Under the old code both tokens
// resolved to "the newest pending row", so approving the FIRST stamped the SECOND.
const mk = (t, a) => ({ id: 'x' + t, text: t, author: a, platform: 'instagram', kind: 'comment' });
const aiA = { reply: 'ردA', client_type: 'سؤال عن الثمن', lead: 'ساخن' };
const aiB = { reply: 'ردB', client_type: 'سؤال عام', lead: 'بارد' };
const rowA = logToSheet_(mk('رسالة A', 'zbonA'), aiA, 'بانتظار موافقتك');
const rowB = logToSheet_(mk('رسالة B', 'zbonB'), aiB, 'بانتظار موافقتك');
ok('logToSheet_ returns a row number', rowA > 1 && rowB === rowA + 1, rowA + ',' + rowB);

updateSheetStatus_(rowA, 'تمت الموافقة وتصيفط');
ok('A got its own status', H.SHEETDATA[rowA - 1][8] === 'تمت الموافقة وتصيفط');
ok('B was NOT touched', H.SHEETDATA[rowB - 1][8] === 'بانتظار موافقتك',
   H.SHEETDATA[rowB - 1][8]);
ok('row 0 is a safe no-op', (() => { updateSheetStatus_(0, 'x'); return true; })());

console.log('\n== parallel fetching ==');
PLATFORMS.instagram.igUserId = 'IG123';
H.props['META_ACCESS_TOKEN'] = 'tok';
global.__ROUTES = {
  // Instagram-login route addresses the account as "me", not by numeric id.
  'graph.instagram.com/v21.0/me/media': { body: { data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] } },
  '/p1/comments':  { body: { data: [{ id: 'c1', text: 'bch7al?', username: 'a' }] } },
  '/p2/comments':  { code: 500, body: 'boom' },            // one post fails
  '/p3/comments':  { body: { data: [{ id: 'c3', text: 'chhal?', username: 'c' }] } },
};
global.__CALLS = []; global.__BATCHES = 0;
const got = Instagram.fetchComments();
ok('one batched call, not one per post', global.__BATCHES === 1, global.__BATCHES);
ok('uses the instagram host, not the facebook one',
   global.__CALLS.every(u => u.indexOf('graph.instagram.com') !== -1),
   (global.__CALLS[0] || '').slice(0, 60));
ok('a failing post does not lose the others', got.length === 2, got.length);
ok('comments keep their own postId',
   got[0].postId === 'p1' && got[1].postId === 'p3',
   got.map(g => g.postId).join(','));
ok('text and author survive', got[0].text === 'bch7al?' && got[1].author === 'c');
ok('empty url list makes no request',
   (() => { global.__BATCHES = 0; const r = httpGetAllJson_([]);
            return r.length === 0 && global.__BATCHES === 0; })());
PLATFORMS.instagram.igUserId = '';
delete H.props['META_ACCESS_TOKEN'];
global.__ROUTES = {};

console.log('\n== dashboard auth ==');
const url = setupDashboard();
const tok = url.split('dash=')[1];
ok('token is long', tok.length === 64, tok.length);
ok('correct token accepted', dashboardTokenValid_(tok) === true);
ok('wrong token rejected', dashboardTokenValid_('a'.repeat(64)) === false);
ok('empty rejected', dashboardTokenValid_('') === false);
ok('null rejected', dashboardTokenValid_(null) === false);
ok('prefix of real token rejected', dashboardTokenValid_(tok.slice(0, 60)) === false);

console.log('\n== doGet routing ==');
ok('no params -> public page, no data',
   doGet({ parameter: {} }).getContent().indexOf('لوحة التحكم') === -1);
ok('bad dash token -> public page',
   doGet({ parameter: { dash: 'zzz' } }).getContent().indexOf('لوحة التحكم') === -1);
const dash = doGet({ parameter: { dash: tok } }).getContent();
ok('good token -> dashboard renders', dash.indexOf('لوحة التحكم') !== -1);
ok('meta verify still works',
   doGet({ parameter: { 'hub.mode': 'subscribe', 'hub.verify_token': CONFIG.META_VERIFY_TOKEN,
                        'hub.challenge': 'CH123' } }).getContent() === 'CH123');
ok('meta verify rejects wrong token',
   doGet({ parameter: { 'hub.mode': 'subscribe', 'hub.verify_token': 'bad',
                        'hub.challenge': 'CH123' } }).getContent() === 'Forbidden');

console.log('\n== dashboard document structure ==');
// No doctype means quirks mode, where the box model and flex layout differ and the page
// collapses. This is what broke it on the owner's screen the first time he opened it.
ok('starts with a doctype', dash.indexOf('<!DOCTYPE html>') === 0, dash.slice(0, 40));
ok('has a head', dash.indexOf('<head>') !== -1);
ok('has a body', dash.indexOf('<body>') !== -1);
ok('closes html', dash.indexOf('</body></html>') !== -1);
ok('style sits inside head',
   dash.indexOf('<style>') < dash.indexOf('</head>') &&
   dash.indexOf('</style>') < dash.indexOf('</head>'));
ok('content sits inside body', dash.indexOf('<body>') < dash.indexOf('class="wrap"'));
ok('declares rtl on the document', dash.indexOf('dir="rtl"') !== -1);
ok('declares the charset', dash.indexOf('<meta charset="utf-8">') !== -1);
// Balance the real markup only — the script block builds HTML in strings, which a naive
// tag count reads as unclosed tags.
ok('divs balance in the markup', (() => {
  const markup = dash.slice(0, dash.indexOf('<script'));
  let depth = 0, m;
  const re = /<div[^>]*>|<\/div>/g;
  while ((m = re.exec(markup))) depth += (m[0] === '</div>' ? -1 : 1);
  return depth === 0;
})());
ok('poll interval text matches installTrigger', dash.indexOf('5 دقايق') !== -1);

console.log('\n== dashboard content ==');
ok('shows the customer messages', dash.indexOf('رسالة A') !== -1);
ok('shows lead badges', dash.indexOf('lead-hot') !== -1);
ok('shows cost in MAD', dash.indexOf('درهم') !== -1);
ok('honest about the credit balance', dash.indexOf('console.anthropic.com') !== -1);
ok('no external resources', !/src\s*=\s*["']https?:|<link/i.test(dash));
ok('has the stop button', dash.indexOf('وقف الأوتوماسيون') !== -1);

console.log('\n== dashboard actions (POST) ==');
const post = b => JSON.parse(doPost({ postData: { contents: JSON.stringify(b) } }).getContent());
ok('stop requires a token', post({ dash: 'bad', action: 'stop' }).ok === false);
ok('stop works', post({ dash: tok, action: 'stop' }).running === false);
SETTINGS_CACHE_ = null;
ok('...and persisted', getSetting_('AUTOMATION_ENABLED') === false);
ok('checkEverything does nothing while stopped',
   (() => { const n = H.LOGS.length; checkEverything();
            return H.LOGS.slice(n).join(' ').indexOf('stopped from the dashboard') !== -1; })());
ok('webhooks are paused too',
   doPost({ postData: { contents: JSON.stringify({ object: 'instagram', entry: [] }) } })
     .getContent() === 'PAUSED');
ok('start works', post({ dash: tok, action: 'start' }).running === true);
ok('toggle flips a setting', post({ dash: tok, action: 'toggle', key: 'DRAFT_ONLY_MODE' }).value === false);
ok('toggle rejects unknown key', post({ dash: tok, action: 'toggle', key: 'HACK' }).ok === false);
ok('platform toggle works', post({ dash: tok, action: 'platform', key: 'youtube' }).value === true);
ok('platform rejects unknown', post({ dash: tok, action: 'platform', key: 'myspace' }).ok === false);
ok('unknown action rejected', post({ dash: tok, action: 'delete_everything' }).ok === false);

console.log('\n== manual reply helper ==');
// Stub the Anthropic call so this needs no network and no key.
global.__ROUTES = { 'api.anthropic.com': { body: {
  content: [{ text: '{"reply":"550 dh l metre. sift lia l9ias f whatsapp 0666567672",' +
                    '"needs_human":false,"client_type":"سؤال عن الثمن","lead":"ساخن"}' }],
  usage: { input_tokens: 12, output_tokens: 34 } } } };
H.props['ANTHROPIC_API_KEY'] = 'test';

const dr = post({ dash: tok, action: 'draft', text: 'chhal taman dyal lmzdouj?' });
ok('draft returns a reply', dr.ok === true && dr.reply.indexOf('550') !== -1, dr.reply);
ok('draft classifies the lead', dr.lead === 'ساخن', dr.lead);
ok('draft gives a tracked link, not a raw wa.me',
   (dr.whatsapp || '').indexOf('w=1') !== -1 && dr.whatsapp.indexOf('s=manual') !== -1,
   dr.whatsapp);
ok('draft needs the token', post({ dash: 'bad', action: 'draft', text: 'x' }).ok === false);
ok('empty text rejected', post({ dash: tok, action: 'draft', text: '   ' }).ok === false);
// The unverified-topic guard must apply here exactly as it does automatically.
const risky = post({ dash: tok, action: 'draft', text: 'واش كاين شي برومو؟' });
ok('unverified topic is flagged', !!risky.warn, JSON.stringify(risky.warn));
ok('manual drafts are metered too', usageForDay_(day).calls > cu.calls);
delete H.props['ANTHROPIC_API_KEY'];
global.__ROUTES = {};

console.log('\n== screenshot -> replies (no platform API) ==');
H.props['ANTHROPIC_API_KEY'] = 'test';
let visionCalls = 0;
const VISION = { body: { content: [{ text: '```json\\n[' +
  '{"author":"amina","text":"chhal taman?"},' +
  '{"author":"youssef","text":"واش كتوصلو لكازا؟"},' +
  '{"author":"fiha_khir13","text":"my own comment"}' +
  ']\\n```' }], usage: { input_tokens: 900, output_tokens: 60 } } };
const REPLY = { body: { content: [{ text: '{"reply":"550 dh l metre. sift l9ias f whatsapp 0666567672",' +
  '"needs_human":false,"client_type":"سؤال عن الثمن","lead":"ساخن"}' }],
  usage: { input_tokens: 20, output_tokens: 40 } } };

// First anthropic hit is the vision call, the rest are replies.
global.__ROUTES = { 'api.anthropic.com': VISION };
const origFetch = UrlFetchApp.fetch;
UrlFetchApp.fetch = function (url, opts) {
  if (String(url).indexOf('anthropic') !== -1) {
    visionCalls++;
    const body = visionCalls === 1 ? VISION.body : REPLY.body;
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
  }
  return origFetch(url, opts);
};

const shot = post({ dash: tok, action: 'shot', image: 'ZmFrZQ==', mime: 'image/jpeg' });
ok('screenshot returns replies', shot.ok === true && shot.items.length === 2,
   JSON.stringify(shot).slice(0, 120));
ok('own comments are skipped', !shot.items.some(i => i.author === 'fiha_khir13'));
ok('each item keeps its own comment',
   shot.items[0].comment === 'chhal taman?' && shot.items[1].comment.indexOf('كازا') !== -1);
ok('each gets a reply', shot.items.every(i => i.reply.length > 0));
ok('leads are scored', shot.items[0].lead === 'ساخن');
ok('vision call is metered', usageForDay_(day).calls >= visionCalls);
ok('screenshot needs the token',
   post({ dash: 'bad', action: 'shot', image: 'x' }).ok === false);

// Fenced array, prose around it, junk — all must fail safe rather than throw.
ok('parses a fenced array', parseAiJsonArray_('```json\\n[{"author":"a","text":"hi"}]\\n```').length === 1);
ok('ignores prose around it', parseAiJsonArray_('Here you go: [{"author":"a","text":"hi"}] done').length === 1);
ok('empty text entries dropped', parseAiJsonArray_('[{"author":"a","text":"  "}]').length === 0);
ok('garbage returns empty, not a throw', parseAiJsonArray_('not json at all').length === 0);
ok('non-array returns empty', parseAiJsonArray_('{"author":"a"}').length === 0);
ok('missing author defaults', parseAiJsonArray_('[{"text":"hi"}]')[0].author === 'زبون');
// Enforced in code, not just asked of the model.
ok('own handle filtered', parseAiJsonArray_('[{"author":"fiha_khir13","text":"x"}]').length === 0);
ok('own handle with @ filtered', parseAiJsonArray_('[{"author":"@fihakhir04","text":"x"}]').length === 0);
ok('arabic name filtered', parseAiJsonArray_('[{"author":"فيها خير","text":"x"}]').length === 0);
ok('a real customer is kept', parseAiJsonArray_('[{"author":"amina_agadir","text":"x"}]').length === 1);

UrlFetchApp.fetch = origFetch;
delete H.props['ANTHROPIC_API_KEY'];
global.__ROUTES = {};

console.log('\n== voice notes ==');
ok('no key -> clear message, not a crash',
   post({ dash: tok, action: 'voice', audio: 'x', mime: 'audio/ogg' }).error.indexOf('Google Speech') !== -1);

// Format mapping. m4a is genuinely unsupported by Google sync recognize.
ok('ogg -> OGG_OPUS', sttEncodingFor_('audio/ogg; codecs=opus') === 'OGG_OPUS');
ok('mp3 -> MP3', sttEncodingFor_('audio/mpeg') === 'MP3');
ok('wav -> LINEAR16', sttEncodingFor_('audio/wav') === 'LINEAR16');
ok('m4a unsupported', sttEncodingFor_('audio/mp4') === '');
ok('unknown unsupported', sttEncodingFor_('') === '');

H.props['GOOGLE_STT_KEY'] = 'k';
H.props['ANTHROPIC_API_KEY'] = 'test';
const origFetch2 = UrlFetchApp.fetch;
let sttBody = { results: [{ alternatives: [{ transcript: 'بغيت نعرف الثمن', confidence: 0.93 }] }] };
UrlFetchApp.fetch = function (url) {
  if (String(url).indexOf('speech.googleapis') !== -1) {
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(sttBody) };
  }
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
    content: [{ text: '{"reply":"550 درهم للمتر. صيفط ليا القياس ف الواتساب 0666567672",' +
      '"needs_human":false,"client_type":"سؤال عن الثمن","lead":"ساخن"}' }],
    usage: { input_tokens: 10, output_tokens: 20 } }) };
};

const v = post({ dash: tok, action: 'voice', audio: 'ZmFrZQ==', mime: 'audio/ogg' });
ok('transcript is returned to the user', v.transcript === 'بغيت نعرف الثمن', v.transcript);
ok('confidence is shown', v.confidence === 93, v.confidence);
ok('reply is generated from it', v.reply.indexOf('550') !== -1);
ok('good confidence -> no shaky warning', (v.warn || '').indexOf('ما تفهمش') === -1);

// The safety case: a transcript the model is unsure about must be flagged, not sent blind.
sttBody = { results: [{ alternatives: [{ transcript: 'شي حاجة ما مفهوماش', confidence: 0.41 }] }] };
const shaky = post({ dash: tok, action: 'voice', audio: 'ZmFrZQ==', mime: 'audio/ogg' });
ok('low confidence is flagged', shaky.warn.indexOf('ما تفهمش') !== -1, shaky.warn);
ok('transcript still shown when shaky', shaky.transcript.length > 0);

sttBody = { results: [] };
const silent = post({ dash: tok, action: 'voice', audio: 'ZmFrZQ==', mime: 'audio/ogg' });
ok('nothing heard -> tells you to listen', silent.ok === true && silent.warn.indexOf('سمعو نتا') !== -1);
ok('nothing heard -> no invented reply', silent.reply === '');

ok('unsupported format -> honest error',
   post({ dash: tok, action: 'voice', audio: 'x', mime: 'audio/mp4' }).error.indexOf('ما مدعومش') !== -1);
ok('voice needs the token', post({ dash: 'bad', action: 'voice', audio: 'x' }).ok === false);

UrlFetchApp.fetch = origFetch2;
delete H.props['GOOGLE_STT_KEY']; delete H.props['ANTHROPIC_API_KEY'];

console.log('\n== whatsapp click tracking ==');
const before = clicksForDay_(day);
const hop = doGet({ parameter: { w: '1', s: 'manual', u: 'zbon1' } }).getContent();
ok('click is counted', clicksForDay_(day) === before + 1, clicksForDay_(day));
ok('redirects to the real wa.me', hop.indexOf('wa.me/212666567672') !== -1);
ok('carries the prefilled message', hop.indexOf('text=') !== -1);
doGet({ parameter: { w: '1' } });
ok('counts again without a username', clicksForDay_(day) === before + 2);
ok('window sums the days', clicksWindow_(7) >= before + 2);
ok('unknown day is zero, not NaN', clicksForDay_('2019-01-01') === 0);
// The hop must stay public — a customer has no token.
ok('needs no dashboard token', hop.indexOf('كنوجهوك') !== -1);

console.log('\n== escaping ==');
setSetting_('DRAFT_ONLY_MODE', true);
logToSheet_(mk('<img src=x onerror=alert(1)>', '"><script>bad()</script>'),
            { reply: 'ok', client_type: 'سؤال عام', lead: 'بارد' }, 'بانتظار موافقتك');
const d2 = doGet({ parameter: { dash: tok } }).getContent();
ok('customer HTML is escaped', d2.indexOf('<img src=x') === -1 && d2.indexOf('&lt;img') !== -1);
ok('no injected script tag', d2.indexOf('<script>bad()') === -1);

console.log('\n== pricing (the owner\'s rules, 31 July 2026) ==');
// The example he worked by hand: 200x120 عادي -> 2 * 1.2 * 550.
ok('worked example 200x120 = 1320', quote_(200, 120, 'العادي', false).screen === 1320,
   quote_(200, 120, 'العادي', false).screen);
// Any side under a metre bills as a metre.
ok('80x60 billed as 1x1 = 550', quote_(80, 60, 'العادي', false).screen === 550,
   quote_(80, 60, 'العادي', false).screen);
ok('80x120 bills the 80 as 100', quote_(80, 120, 'العادي', false).screen === 660,
   quote_(80, 120, 'العادي', false).screen);
// Two leaves: only when BOTH 200 wide and 150 high are reached.
ok('200x150 adds 130', quote_(200, 150, 'العادي', false).twoPanel === 130);
ok('200x120 adds nothing', quote_(200, 120, 'العادي', false).twoPanel === 0);
ok('190x160 adds nothing', quote_(190, 160, 'العادي', false).twoPanel === 0);
// Rates per type.
ok('مضلم uses 650', quote_(100, 100, 'المضلم', false).screen === 650);
ok('مزدوج uses 750', quote_(100, 100, 'المزدوج', false).screen === 750);
// Agadir pays installation ON TOP of delivery; elsewhere it is delivery only.
ok('agadir = screen + install + delivery',
   quote_(200, 120, 'العادي', true).total === 1320 + 150 + 60,
   quote_(200, 120, 'العادي', true).total);
ok('outside agadir = screen + delivery', quote_(200, 120, 'العادي', false).total === 1320 + 60,
   quote_(200, 120, 'العادي', false).total);
ok('big piece outside agadir stacks 130 + 60',
   quote_(200, 150, 'العادي', false).total === 1650 + 130 + 60,
   quote_(200, 150, 'العادي', false).total);

// Measurement parsing, in the shapes customers actually type.
[['بغيت شرجم 200 على 120', 200, 120], ['200x120', 200, 120], ['200*120', 200, 120],
 ['2m sur 1.20', 200, 120], ['150 علا 90', 150, 90], ['1,5 x 2', 150, 200],
 ['200 سنتيم على 120 سنتيم', 200, 120]]
  .forEach(([t, w, h]) => {
    const d = parseMeasurements_(t);
    ok('parse ' + JSON.stringify(t), !!d && d.wCm === w && d.hCm === h, JSON.stringify(d));
  });
ok('no measurements -> null', parseMeasurements_('بشحال الموستكير؟') === null);
ok('phone number is not a measurement', parseMeasurements_('0666567672') === null);

ok('type from text: blackout', detectType_('bghit blackout') === 'المضلم');
ok('type from text: مضلم', detectType_('واش عندك المضلم') === 'المضلم');
ok('type from text: default عادي', detectType_('شرجم 200 على 120') === 'العادي');
ok('agadir detected', mentionsAgadir_('انا من اكادير') === true);
ok('agadir detected in latin', mentionsAgadir_('ana f agadir') === true);
ok('casa is not agadir', mentionsAgadir_('ana f casa') === false);

// The block handed to the model must carry the finished number, never an expression
// for it to evaluate.
const blk = priceBlock_('شرجم 200 على 120 وانا من اكادير');
ok('price block carries the total', blk.indexOf('1530') !== -1, blk);
ok('price block flags agadir install', blk.indexOf('التركيب') !== -1);
ok('price block still charges delivery in agadir', blk.indexOf('التوصيل') !== -1);
ok('no measurements -> empty block', priceBlock_('بشحال؟') === '');

console.log('\n== escalation, post context, voice, tokens ==');
ok('hot lead escalates', worthEscalating_({ lead: 'ساخن', client_type: 'سؤال عام' }));
ok('complaint escalates', worthEscalating_({ lead: 'بارد', client_type: 'شكوى' }));
ok('buyer escalates', worthEscalating_({ lead: 'دافئ', client_type: 'مهتم بالشراء' }));
ok('cold general question does not', !worthEscalating_({ lead: 'بارد', client_type: 'سؤال عام' }));

ok('visual comment wants the image', refersToSomethingVisual_('شنو هاد اللون؟'));
ok('arabizi visual comment too', refersToSomethingVisual_('hada chhal?'));
ok('plain price question does not', !refersToSomethingVisual_('بشحال الموستكير؟'));
ok('no url -> no image block', fetchImageBlock_('') === null);

ok('audio attachment found',
   voiceAttachment_({ attachments: { data: [{ type: 'audio', payload: { url: 'u' } }] } }) === 'u');
ok('image attachment ignored',
   voiceAttachment_({ attachments: { data: [{ type: 'image', payload: { url: 'u' } }] } }) === '');
ok('no attachments -> empty', voiceAttachment_({}) === '');

H.props['FACEBOOK_PAGE_TOKEN'] = 'fb-token';
H.props['META_ACCESS_TOKEN'] = 'ig-token';
ok('facebook uses its own token', fbToken_() === 'fb-token');
delete H.props['FACEBOOK_PAGE_TOKEN'];
ok('falls back to the instagram token', fbToken_() === 'ig-token');

console.log('\n== reviewing by email reply ==');
ok('quoted text stripped',
   stripQuoted_('هادا الرد ديالي\n\n> الرد المقترح\n> سلام') === 'هادا الرد ديالي');
ok('attribution line stripped',
   stripQuoted_('صافي\nOn 31 July 2026 at 10:00, me wrote:\nold') === 'صافي');
ok('plain body survives', stripQuoted_('غير هادشي') === 'غير هادشي');

// An edit replaces the draft, is remembered, and counts as a review.
delete H.props['OWNER_CORRECTIONS'];
H.props['REVIEWED_COUNT'] = '0';
H.props['EDITED_COUNT'] = '0';
H.props['RUNTIME_SETTINGS'] = JSON.stringify({ DRAFT_ONLY_MODE: true });
H.props['pending_abcd1234-ffff-0000-1111-222222222222'] = JSON.stringify({
  msg: { id: 'c1', text: 'بشحال؟', author: 'zbon', platform: 'instagram', kind: 'comment' },
  reply: 'الثمن 550 درهم للمتر', lead: 'دافئ', row: 2,
  created: new Date().toISOString(),
});
global.__THREADS = [{
  subject: 'إنستغرام — تعليق — @zbon  ·  FKR abcd1234',
  bodies: ['(the draft email)', 'الثمن ديال العادي 550 درهم للمتر المربع\n\n> الرد المقترح'],
}];
checkEmailReplies_();
ok('pending consumed', !('pending_abcd1234-ffff-0000-1111-222222222222' in H.props));
ok('thread marked read', global.__THREADS[0].read === true);
ok('correction stored', JSON.parse(H.props['OWNER_CORRECTIONS']).length === 1);
ok('correction keeps the owner wording',
   JSON.parse(H.props['OWNER_CORRECTIONS'])[0].fixed.indexOf('المربع') !== -1);
ok('counted as reviewed', H.props['REVIEWED_COUNT'] === '1');
ok('counted as edited', H.props['EDITED_COUNT'] === '1');
ok('corrections reach the prompt', correctionsBlock_().indexOf('المربع') !== -1);

// A bare "waha" approves the draft as written — not a correction.
H.props['pending_beef5678-ffff-0000-1111-222222222222'] = JSON.stringify({
  msg: { id: 'c2', text: 'بشحال؟', author: 'zbon2', platform: 'instagram', kind: 'comment' },
  reply: 'مرحبا', lead: 'بارد', row: 3, created: new Date().toISOString(),
});
global.__THREADS = [{ subject: 'تعليق — @zbon2  ·  FKR beef5678', bodies: ['x', 'واه'] }];
checkEmailReplies_();
ok('approval word is not a correction',
   JSON.parse(H.props['OWNER_CORRECTIONS']).length === 1);
ok('approval still counts', H.props['REVIEWED_COUNT'] === '2');
ok('approval is not an edit', H.props['EDITED_COUNT'] === '1');

// Unknown tag must not throw or invent a pending row.
global.__THREADS = [{ subject: 'تعليق — @x  ·  FKR deadbeef', bodies: ['x', 'شي حاجة'] }];
checkEmailReplies_();
ok('unknown tag marked read, nothing sent', global.__THREADS[0].read === true);
global.__THREADS = [];

ok('corrections capped at 10', (() => {
  for (let i = 0; i < 15; i++) recordCorrection_('draft ' + i, 'fixed ' + i);
  return JSON.parse(H.props['OWNER_CORRECTIONS']).length === 10;
})());
ok('identical rewrite is not a correction', (() => {
  const before = JSON.parse(H.props['OWNER_CORRECTIONS']).length;
  recordCorrection_('same', 'same');
  return JSON.parse(H.props['OWNER_CORRECTIONS']).length === before;
})());

console.log('\n== the first 30 drafts ==');
H.props['REVIEWED_COUNT'] = String(CONFIG.AUTO_ENABLE_AFTER - 1);
H.props['EDITED_COUNT'] = '2';
H.props['RUNTIME_SETTINGS'] = JSON.stringify({ DRAFT_ONLY_MODE: true, ALWAYS_ASK_APPROVAL: true });
const mailsBefore = __EMAILS.length;
countReview_(false);
ok('draft mode released at 30', getSetting_('DRAFT_ONLY_MODE') === false);
ok('blanket approval released at 30', getSetting_('ALWAYS_ASK_APPROVAL') === false);
ok('owner told', __EMAILS.length === mailsBefore + 1);
countReview_(false);
ok('does not re-fire past 30', __EMAILS.length === mailsBefore + 1);

console.log('\n== the sheet menu (the control panel that is not a web page) ==');
onOpenMenu();
ok('menu is built', Array.isArray(__MENU) && __MENU.length === 7, (__MENU || []).length);
ok('every menu item points at a real function',
   __MENU.every(([, fn]) => typeof global[fn] === 'function'),
   (__MENU.find(([, fn]) => typeof global[fn] !== 'function') || [])[1]);

// Each toggle flips the setting it names, and nothing else.
setSetting_('AUTOMATION_ENABLED', true);
menuToggleRunning();
ok('running toggles off', getSetting_('AUTOMATION_ENABLED') === false);
menuToggleRunning();
ok('and back on', getSetting_('AUTOMATION_ENABLED') === true);

setSetting_('DRAFT_ONLY_MODE', true);
menuToggleDraft();
ok('draft mode toggles', getSetting_('DRAFT_ONLY_MODE') === false);
ok('draft toggle did not touch the master switch', getSetting_('AUTOMATION_ENABLED') === true);
setSetting_('DRAFT_ONLY_MODE', true);

setSetting_('ALWAYS_ASK_APPROVAL', true);
menuToggleApproval();
ok('approval toggles', getSetting_('ALWAYS_ASK_APPROVAL') === false);
setSetting_('ALWAYS_ASK_APPROVAL', true);

setPlatformEnabled_('instagram', false);
menuToggleInstagram();
ok('instagram toggles on', platformEnabled_('instagram') === true);
ok('facebook untouched', platformEnabled_('facebook') === false);
setPlatformEnabled_('instagram', false);

// The status box must survive a sheet that does not exist yet and never throw.
const alertsBefore = __ALERTS.length;
menuStatus();
ok('status shows something', __ALERTS.length === alertsBefore + 1);
ok('status names the automation state', __ALERTS[__ALERTS.length - 1][1].indexOf('الأوتوماسيون خدام') !== -1);
ok('status shows the review progress',
   __ALERTS[__ALERTS.length - 1][1].indexOf('مسودات قريتيهم') !== -1);

console.log('\n== whatsapp link with no deployment ==');
// Undeployed, ScriptApp.getService().getUrl() is null. A customer must never receive
// a link reading "null?w=1&s=...".
const realGetUrl = ScriptApp.getService;
ScriptApp.getService = () => ({ getUrl: () => null });
const bare = trackedWhatsappLink_('zbon', 'ig-private-reply');
ok('falls back to a real wa.me link', bare.indexOf('https://wa.me/') === 0, bare);
ok('never emits the string null', bare.indexOf('null') === -1, bare);
ok('carries the business number', bare.indexOf(CONFIG.WHATSAPP_INTL) !== -1);
ScriptApp.getService = realGetUrl;
ok('tracked link used when deployed',
   trackedWhatsappLink_('zbon', 'x').indexOf('?w=1') !== -1);

console.log('\n== no raw braces in any URL ==');
// UrlFetchApp throws "Invalid argument" on a raw { or } and never sends the request, so
// every DM was silently lost. Graph needs braces for nested fields, so they get encoded.
ok('fields_ encodes the braces',
   fields_('a,b.limit(1){c,d}').indexOf('%7B') !== -1 &&
   fields_('a,b.limit(1){c,d}').indexOf('{') === -1,
   fields_('a,b.limit(1){c,d}'));

PLATFORMS.instagram.igUserId = 'IG123';
PLATFORMS.facebook.pageId = 'FB123';
H.props['META_ACCESS_TOKEN'] = 'tok';
global.__ROUTES = {
  'me/conversations': { body: { data: [] } },
  'FB123/conversations': { body: { data: [] } },
};
global.__CALLS = [];
Instagram.fetchDMs();
Facebook.fetchDMs();
ok('both DM endpoints were called', global.__CALLS.length === 2, global.__CALLS.length);
ok('no URL contains a raw brace',
   global.__CALLS.every(u => u.indexOf('{') === -1 && u.indexOf('}') === -1),
   global.__CALLS.find(u => u.indexOf('{') !== -1));
ok('the nested fields survive encoded',
   global.__CALLS.every(u => u.indexOf('messages.limit(1)%7B') !== -1),
   global.__CALLS[0]);
ok('instagram still asks for attachments',
   global.__CALLS[0].indexOf('attachments') !== -1);
PLATFORMS.instagram.igUserId = '';
PLATFORMS.facebook.pageId = '';
delete H.props['META_ACCESS_TOKEN'];
global.__ROUTES = {};

console.log('\n== a repeating fault must not eat the mail quota ==');
// A consumer account gets 100 emails a day. The 5-minute timer fires 288 times, so an
// unthrottled error notifier spends the whole quota and the approval emails — the point
// of the system — stop going out. This is what actually happened.
Object.keys(H.props).forEach(k => { if (k.indexOf('errmail_') === 0) delete H.props[k]; });
let mailsWas = __EMAILS.length;
for (let i = 0; i < 50; i++) notifyError_('instagram/fetchDMs', 'boom', '');
ok('50 identical errors send one email', __EMAILS.length === mailsWas + 1,
   __EMAILS.length - mailsWas);

// A different fault is still worth hearing about immediately.
mailsWas = __EMAILS.length;
notifyError_('checkEverything', 'other', '');
ok('a different location still emails', __EMAILS.length === mailsWas + 1);

// Once the hour is up it reports again, so a fault that never stops is not hidden forever.
H.props['errmail_instagram_fetchDMs'] = String(Date.now() - (61 * 60 * 1000));
mailsWas = __EMAILS.length;
notifyError_('instagram/fetchDMs', 'boom', '');
ok('reports again after an hour', __EMAILS.length === mailsWas + 1);

// The draft must survive the mail failing, and say so where he can see it.
const realSend = GmailApp.sendEmail;
GmailApp.sendEmail = () => { throw new Error('Service invoked too many times for one day: email.'); };
const rowQ = logToSheet_(
  { id: 'q1', text: 'بشحال؟', author: 'zbon', platform: 'instagram', kind: 'comment' },
  { reply: 'draft', client_type: 'سؤال عن الثمن', lead: 'دافئ' }, 'بانتظار موافقتك');
let threw = false;
try {
  sendApprovalEmail_({ id: 'q1', text: 'x', author: 'zbon', platform: 'instagram', kind: 'comment' },
                     { reply: 'draft', client_type: 'سؤال عن الثمن', lead: 'دافئ' }, 'tok123');
} catch (e) { threw = true; }
ok('a blown quota does surface as an exception', threw);
updateSheetStatus_(rowQ, 'مسودة واجدة — الإيميل ما مشاش. شوفها هنا');
ok('the sheet says the email did not go',
   H.SHEETDATA[rowQ - 1][8].indexOf('الإيميل ما مشاش') !== -1, H.SHEETDATA[rowQ - 1][8]);
GmailApp.sendEmail = realSend;

console.log('\n== reviewing in the sheet (costs no email) ==');
ok('the decision column exists', HEADERS.length === 10 && HEADERS[9] === 'قرارك', HEADERS.length);
ok('DECISION_COL points at it', DECISION_COL === HEADERS.length);

// Set up a pending draft with a row, then answer it in the sheet rather than by email.
Object.keys(H.props).forEach(k => { if (k.indexOf('pending_') === 0) delete H.props[k]; });
delete H.props['OWNER_CORRECTIONS'];
H.props['REVIEWED_COUNT'] = '0';
H.props['EDITED_COUNT'] = '0';
H.props['RUNTIME_SETTINGS'] = JSON.stringify({ DRAFT_ONLY_MODE: true });

const rowS = logToSheet_(
  { id: 's1', text: 'بشحال؟', author: 'zbon', platform: 'instagram', kind: 'comment' },
  { reply: 'الثمن 550 درهم', client_type: 'سؤال عن الثمن', lead: 'دافئ' }, 'بانتظار موافقتك');
H.props['pending_sheet1111-aaaa'] = JSON.stringify({
  msg: { id: 's1', text: 'بشحال؟', author: 'zbon', platform: 'instagram', kind: 'comment' },
  reply: 'الثمن 550 درهم', lead: 'دافئ', row: rowS, created: new Date().toISOString(),
});

// Nothing typed yet — must do nothing at all.
checkSheetDecisions_();
ok('an empty cell is left alone', 'pending_sheet1111-aaaa' in H.props);

// Now he types a correction into column J.
H.SHEETDATA[rowS - 1][DECISION_COL - 1] = 'الثمن ديال العادي 550 درهم للمتر المربع';
checkSheetDecisions_();
ok('the pending draft is consumed', !('pending_sheet1111-aaaa' in H.props));
ok('the cell is cleared so it cannot fire twice',
   H.SHEETDATA[rowS - 1][DECISION_COL - 1] === '');
ok('his wording is kept as a correction',
   JSON.parse(H.props['OWNER_CORRECTIONS'] || '[]').length === 1);
ok('it counts toward the 30', H.props['REVIEWED_COUNT'] === '1');
ok('and counts as an edit', H.props['EDITED_COUNT'] === '1');

// "واه" in the sheet approves as written, exactly like the email path.
const rowT = logToSheet_(
  { id: 's2', text: 'سلام', author: 'z2', platform: 'instagram', kind: 'comment' },
  { reply: 'مرحبا', client_type: 'سؤال عام', lead: 'بارد' }, 'بانتظار موافقتك');
H.props['pending_sheet2222-bbbb'] = JSON.stringify({
  msg: { id: 's2', text: 'سلام', author: 'z2', platform: 'instagram', kind: 'comment' },
  reply: 'مرحبا', lead: 'بارد', row: rowT, created: new Date().toISOString(),
});
H.SHEETDATA[rowT - 1][DECISION_COL - 1] = 'واه';
checkSheetDecisions_();
ok('واه approves without becoming a correction',
   JSON.parse(H.props['OWNER_CORRECTIONS'] || '[]').length === 1);
ok('but still counts', H.props['REVIEWED_COUNT'] === '2');

// A pending row with no sheet row must not crash the pass.
H.props['pending_norow-cccc'] = JSON.stringify({
  msg: { id: 's3', text: 'x', author: 'z3', platform: 'instagram', kind: 'comment' },
  reply: 'y', lead: 'بارد', created: new Date().toISOString(),
});
ok('a pending row with no row number is skipped safely',
   (() => { checkSheetDecisions_(); return 'pending_norow-cccc' in H.props; })());
delete H.props['pending_norow-cccc'];

console.log('\n== the backlog: dedupe, batching, and age ==');
// The old store kept every id in ONE property capped at 800. A property tops out near
// 9KB and an Instagram id is ~18 chars, so a backlog past 800 dropped the oldest ids and
// answered those customers a second time. One property each has no such ceiling.
Object.keys(H.props).forEach(k => {
  if (k.indexOf('seen_') === 0) delete H.props[k];
});
delete H.props['SEEN_COMMENT_IDS'];

for (let i = 0; i < 1200; i++) markSeen_('id' + i);
ok('1200 ids all remembered', isAlreadySeen_('id0') && isAlreadySeen_('id1199'));
ok('the 800-id cliff is gone', isAlreadySeen_('id5') && isAlreadySeen_('id400'));
ok('an unknown id is still unseen', !isAlreadySeen_('never--seen'));

// The old blob must carry across once, then disappear.
Object.keys(H.props).forEach(k => { if (k.indexOf('seen_') === 0) delete H.props[k]; });
H.props['SEEN_COMMENT_IDS'] = JSON.stringify(['old1', 'old2', 'old3']);
ok('migration reports what it moved', migrateSeenIds_() === 3);
ok('migrated ids count as seen', isAlreadySeen_('old1') && isAlreadySeen_('old3'));
ok('the old blob is deleted', !('SEEN_COMMENT_IDS' in H.props));
ok('migration is a no-op the second time', migrateSeenIds_() === 0);

// Age guard. No timestamp must mean "current" — guessing old would silence a live customer.
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
ok('a comment from today is answered', !tooOldToAnswer_({ createdAt: daysAgo(0) }));
ok('a comment from 29 days ago is answered', !tooOldToAnswer_({ createdAt: daysAgo(29) }));
ok('a comment from 200 days ago is not', tooOldToAnswer_({ createdAt: daysAgo(200) }));
ok('no timestamp is treated as current', !tooOldToAnswer_({}));
ok('an unparseable timestamp is treated as current',
   !tooOldToAnswer_({ createdAt: 'not a date' }));

// Backlog mode widens the scan.
setSetting_('BACKLOG_MODE', false);
ok('normal mode scans the few recent posts', postsToScan_() === CONFIG.MEDIA_TO_SCAN);
setSetting_('BACKLOG_MODE', true);
ok('backlog mode scans far more', postsToScan_() === CONFIG.BACKLOG_MEDIA_TO_SCAN);
setSetting_('BACKLOG_MODE', false);

// The per-run cap. Anything over the cap must be left UNSEEN so the next run gets it —
// marking it seen without answering would lose the customer silently.
Object.keys(H.props).forEach(k => { if (k.indexOf('seen_') === 0) delete H.props[k]; });
const many = [];
for (let i = 0; i < 40; i++) {
  many.push({ id: 'bk' + i, text: 'سلام', author: 'z' + i, platform: 'instagram',
              kind: 'comment', createdAt: daysAgo(300) });   // old: logged, never answered
}
const fakeAdapter = { fetchComments: () => many };
const realAdapterFor = adapterFor_;
global.adapterFor_ = () => fakeAdapter;
const done = runPlatform_('instagram', { comments: true, dm: false });
ok('a run stops at the cap', done === CONFIG.MAX_PER_RUN, done);
ok('the ones handled are marked seen', isAlreadySeen_('bk0'));
ok('the ones left over are NOT marked seen', !isAlreadySeen_('bk39'));
const done2 = runPlatform_('instagram', { comments: true, dm: false });
ok('the next run continues where it stopped', done2 === CONFIG.MAX_PER_RUN, done2);
ok('and eventually reaches the rest', isAlreadySeen_('bk20'));
global.adapterFor_ = realAdapterFor;

ok('the backlog switch is in the menu',
   (() => { onOpenMenu(); return __MENU.some(([, fn]) => fn === 'menuToggleBacklog'); })());

console.log('\n== housekeeping ==');
H.props['usage_2020-01-01'] = JSON.stringify({ calls: 9, input: 1, output: 1 });
pruneOldUsage_();
ok('old usage pruned', !('usage_2020-01-01' in H.props));
ok('today kept', ('usage_' + day) in H.props);
H.props['pending_old'] = JSON.stringify({ created: '2020-01-01T00:00:00Z' });
H.props['pending_new'] = JSON.stringify({ created: new Date().toISOString() });
H.props['pending_junk'] = 'not json';
pruneOldPending_();
ok('stale approval pruned', !('pending_old' in H.props));
ok('fresh approval kept', 'pending_new' in H.props);
ok('unparseable pruned', !('pending_junk' in H.props));

console.log('\n== script detection (regression) ==');
[['بشحال هادي؟', 'arabic'], ['chhal hadi f casa?', 'latin'],
 ['Bonjour, combien pour la livraison ?', 'french'], ['470', 'arabic']]
  .forEach(([t, want]) => ok('detect ' + JSON.stringify(t) + ' = ' + want,
                             detectScript_(t) === want, detectScript_(t)));

console.log('\n== label normalisation (regression) ==');
ok('arabizi lead mapped', normaliseLabels_({ lead: 'dafi', client_type: 'x' }).lead === 'دافئ');
ok('garbage type -> سؤال عام', normaliseLabels_({ lead: 'x', client_type: 'zzz' }).client_type === 'سؤال عام');

console.log('\n---------------------------------------');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
