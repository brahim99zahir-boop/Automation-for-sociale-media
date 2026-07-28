/**
 * Minimal Apps Script runtime stub, enough to exercise the settings layer, the cost
 * maths, the row-binding fix and the dashboard renderer without deploying.
 */
const fs = require('fs');
const path = require('path');
const DIR = __dirname;   // the .gs files sit next to this file

// ---- stubs -------------------------------------------------------------
const _props = {};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in _props ? _props[k] : null),
    setProperty: (k, v) => { _props[k] = String(v); },
    deleteProperty: k => { delete _props[k]; },
    getKeys: () => Object.keys(_props),
  }),
};

global.Utilities = {
  getUuid: () => require('crypto').randomUUID(),   // real 36-char UUID, like Apps Script
  sleep: () => {},
  formatDate: (d, tz, fmt) => {
    const p = n => String(n).padStart(2, '0');
    const s = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    return fmt === 'yyyy-MM-dd' ? s : s + ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  },
};

global.Logger = { log: m => LOGS.push(String(m)) };
const LOGS = [];

// A fake sheet backed by an array, so appendRow/getLastRow/getRange behave.
const SHEETDATA = [['التاريخ','المنصة','النوع','اسم العميل','الرسالة',
                    'نوع العميل','درجة الاهتمام','الرد','الحالة']];
const fakeSheet = {
  appendRow: r => SHEETDATA.push(r.slice()),
  getLastRow: () => SHEETDATA.length,
  getDataRange: () => ({ getValues: () => SHEETDATA }),
  getRange: (row, col) => ({
    getValue: () => SHEETDATA[row - 1][col - 1],
    setValue: v => { SHEETDATA[row - 1][col - 1] = v; },
  }),
};
global.__fakeSheet = fakeSheet;
global.__SHEETDATA = SHEETDATA;

global.SpreadsheetApp = {
  openById: () => ({ getUrl: () => 'https://sheet', getSheetByName: () => fakeSheet }),
};
global.ScriptApp = { getService: () => ({ getUrl: () => 'https://script.example/exec' }) };
global.HtmlService = {
  createHtmlOutput: h => ({ _h: h, setTitle() { return this; }, addMetaTag() { return this; },
                            getContent() { return this._h; } }),
};
global.ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: t => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }),
};
global.GmailApp = { sendEmail: (...a) => EMAILS.push(a) };
const EMAILS = [];
global.__EMAILS = EMAILS;
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
global.UrlFetchApp = { fetch: () => { throw new Error('no network in harness'); } };

// ---- load the real source ---------------------------------------------
// Order matters: Config defines PROP/CONFIG that Settings reads.
for (const f of ['Config.gs', 'SystemPrompt.gs', 'Settings.gs', 'Platforms.gs',
                 'Code.gs', 'Dashboard.gs']) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  // `const X = ...` at top level of a .gs file is global; eval in global scope via
  // indirect eval, then re-expose the names we need.
  (0, eval)(src + '\n;' + exposeNames(src));
}

function exposeNames(src) {
  const names = new Set();
  const re = /^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return [...names].map(n => `try{global[${JSON.stringify(n)}]=${n}}catch(e){}`).join(';');
}

module.exports = { LOGS, EMAILS, SHEETDATA, props: _props };
