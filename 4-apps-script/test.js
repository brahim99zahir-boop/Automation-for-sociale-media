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
  '/IG123/media':  { body: { data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] } },
  '/p1/comments':  { body: { data: [{ id: 'c1', text: 'bch7al?', username: 'a' }] } },
  '/p2/comments':  { code: 500, body: 'boom' },            // one post fails
  '/p3/comments':  { body: { data: [{ id: 'c3', text: 'chhal?', username: 'c' }] } },
};
global.__CALLS = []; global.__BATCHES = 0;
const got = Instagram.fetchComments();
ok('one batched call, not one per post', global.__BATCHES === 1, global.__BATCHES);
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
