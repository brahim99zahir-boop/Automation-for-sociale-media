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
    setProperties: o => { Object.keys(o).forEach(k => { _props[k] = String(o[k]); }); },
    getKeys: () => Object.keys(_props),
  }),
};

global.Utilities = {
  getUuid: () => require('crypto').randomUUID(),   // real 36-char UUID, like Apps Script
  sleep: () => {},
  base64Encode: b => Buffer.from(b).toString('base64'),
  formatDate: (d, tz, fmt) => {
    const p = n => String(n).padStart(2, '0');
    const s = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    return fmt === 'yyyy-MM-dd' ? s : s + ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  },
};

global.Logger = { log: m => LOGS.push(String(m)) };
const LOGS = [];

// A fake sheet backed by an array, so appendRow/getLastRow/getRange behave.
function makeSheet(data) {
  return {
    appendRow: r => data.push(r.slice()),
    getLastRow: () => data.length,
    getDataRange: () => ({ getValues: () => data }),
    getRange: (row, col) => {
      // Formatting calls are chainable no-ops; only the value is worth modelling.
      const cell = {
        getValue: () => (data[row - 1] || [])[col - 1],
        setValue: v => {
          if (!data[row - 1]) data[row - 1] = [];
          data[row - 1][col - 1] = v;
        },
      };
      ['setNote', 'setBackground', 'setFontWeight', 'setFontColor', 'setValues',
       'setHorizontalAlignment', 'setWrap'].forEach(m => { cell[m] = () => cell; });
      return cell;
    },
    setRightToLeft() {}, setFrozenRows() {}, setColumnWidth() {}, clear() {},
    setConditionalFormatRules() {},
  };
}

const SHEETDATA = [['التاريخ','المنصة','النوع','اسم العميل','الرسالة',
                    'نوع العميل','درجة الاهتمام','الرد','الحالة','قرارك']];
const PASTEDATA = [['الرسالة ديال الزبون','اسم الزبون','الرد','النوع','الاهتمام']];
const fakeSheet = makeSheet(SHEETDATA);
const pasteFake = makeSheet(PASTEDATA);
global.__fakeSheet = fakeSheet;
global.__SHEETDATA = SHEETDATA;
global.__PASTEDATA = PASTEDATA;

// Alerts raised by the sheet menu land in global.__ALERTS as [title, body]; the menu
// definition itself lands in global.__MENU as [[label, functionName], ...].
const ALERTS = [];
global.__ALERTS = ALERTS;
const fakeMenu = {
  _items: [],
  addItem(label, fn) { this._items.push([label, fn]); return this; },
  addSeparator() { return this; },
  addToUi() { global.__MENU = this._items.slice(); this._items = []; },
};
global.SpreadsheetApp = {
  openById: () => ({
    getUrl: () => 'https://sheet',
    getId: () => 'TEST_SHEET',
    getSheetByName: n => (n === 'لصق' ? pasteFake : fakeSheet),
    insertSheet: n => (n === 'لصق' ? pasteFake : fakeSheet),
  }),
  create: () => ({ getUrl: () => 'https://sheet', getId: () => 'TEST_SHEET',
                   getSheetByName: n => (n === 'لصق' ? pasteFake : fakeSheet),
                   insertSheet: n => (n === 'لصق' ? pasteFake : fakeSheet) }),
  newConditionalFormatRule: () => {
    const r = {};
    ['whenTextEqualTo', 'setBackground', 'setFontColor', 'setRanges']
      .forEach(m => { r[m] = () => r; });
    r.build = () => ({});
    return r;
  },
  getUi: () => ({
    ButtonSet: { OK: 'OK' },
    alert: (title, body) => ALERTS.push([title, body]),
    createMenu: () => fakeMenu,
  }),
};
global.ScriptApp = { getService: () => ({ getUrl: () => 'https://script.example/exec' }) };
global.HtmlService = {
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
  createHtmlOutput: h => ({ _h: h, setTitle() { return this; }, addMetaTag() { return this; },
                            setXFrameOptionsMode() { return this; },
                            getContent() { return this._h; } }),
};
global.ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: t => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }),
};
// Gmail stub. Tests describe threads in global.__THREADS as {subject, bodies:[...]};
// the last body stands in for the owner's reply.
global.GmailApp = {
  sendEmail: (...a) => EMAILS.push(a),
  search: () => (global.__THREADS || []).map(t => ({
    getFirstMessageSubject: () => t.subject,
    getMessages: () => t.bodies.map(b => ({ getPlainBody: () => b })),
    markRead() { t.read = true; },
  })),
};
const EMAILS = [];
global.__EMAILS = EMAILS;
// Google reports the real remaining allowance; tests set global.__QUOTA to fake it.
global.MailApp = {
  getRemainingDailyQuota: () => (global.__QUOTA === undefined ? 100 : global.__QUOTA),
};
// Drive stub. Tests put images in global.__DRIVE as [{name, mime, bytes}]; a file that
// is "moved" lands in global.__DRIVE_DONE.
global.__DRIVE = [];
global.__DRIVE_DONE = [];
const mkFile = (f) => ({
  getName: () => f.name,
  getMimeType: () => f.mime,
  getBlob: () => ({ getBytes: () => f.bytes || [1, 2, 3] }),
  moveTo: () => { global.__DRIVE_DONE.push(f); },
});
const mkFolder = () => ({
  getFiles: () => {
    let i = 0;
    return { hasNext: () => i < global.__DRIVE.length,
             next: () => mkFile(global.__DRIVE[i++]) };
  },
  getFoldersByName: () => ({ hasNext: () => true, next: () => mkFolder() }),
  createFolder: () => mkFolder(),
});
global.DriveApp = {
  getFoldersByName: () => ({ hasNext: () => true, next: () => mkFolder() }),
  createFolder: () => mkFolder(),
};

global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
// Scriptable HTTP stub. Tests set global.__ROUTES = {urlSubstring: {code, body}}.
const mkRes = (code, body) => ({
  getResponseCode: () => code,
  getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
function route_(url) {
  global.__CALLS.push(url);
  const routes = global.__ROUTES || {};
  for (const key of Object.keys(routes)) {
    if (url.indexOf(key) !== -1) {
      const r = routes[key];
      return mkRes(r.code || 200, r.body);
    }
  }
  return mkRes(404, '{}');
}
global.__CALLS = [];
global.UrlFetchApp = {
  fetch: (url) => route_(url),
  // The real fetchAll takes request objects and returns responses in the same order.
  fetchAll: (reqs) => { global.__BATCHES = (global.__BATCHES || 0) + 1;
                        return reqs.map(r => route_(r.url)); },
};

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
