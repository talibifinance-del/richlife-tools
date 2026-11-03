// Browser self-test for the pricing tool. Drives the real page with real typing.
// Usage: PW=<dir with playwright+axe-core node_modules> PY=python3 node tests/pricing/selftest.mjs <baseUrl> <outDir> [--live-share]
import { createRequire } from 'module';
import fs from 'fs';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const PW = process.env.PW || '/Users/talisharabi/AIOS/my-aios/build/client-portal/node_modules/';
const { chromium } = require(PW + 'playwright');
const axeSrc = fs.readFileSync(require.resolve(PW + 'axe-core/axe.min.js'), 'utf8');
const Engine = require('../../pricing/engine.js');
const [BASE, OUT] = process.argv.slice(2);
const LIVE_SHARE = process.argv.includes('--live-share');
const URL_ = BASE.replace(/\/$/, '') + '/pricing/';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) { if (cond) pass++; else { fail++; failures.push(name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
function near(name, got, want, eps = 0.01) { ok(name, typeof got === 'number' && Math.abs(got - want) <= eps, { got, want }); }

const browser = await chromium.launch();
async function newPage(vp = { width: 1440, height: 900 }, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'he-IL', acceptDownloads: true, ...opts });
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', e => p.errs.push('PAGE ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|Failed to load|facebook/.test(m.text())) p.errs.push(m.text()); });
  await ctx.route(/fonts\.g|facebook|fbevents/, r => r.abort());
  return { ctx, p };
}
async function open(p, hash = '') {
  await p.goto(URL_ + hash); await p.waitForFunction(() => window.__pricing);
  await p.waitForTimeout(150);
  const dec = p.locator('#rl-consent .rl-no');
  if (await dec.isVisible().catch(() => false)) await dec.click();
}
const go = (p, n) => p.evaluate(x => window.__pricing.go(x), n);
const R = p => p.evaluate(() => JSON.parse(JSON.stringify(window.__pricing.R)));
const St = p => p.evaluate(() => JSON.parse(JSON.stringify(window.__pricing.S)));
const type = async (p, path, v) => { const l = p.locator(`[data-path="${path}"]`).first(); await l.fill(''); await l.pressSequentially(String(v)); };
const clean = async (p, label) => {
  const t = await p.evaluate(() => document.getElementById('view').innerText);
  ok(label + ': no broken values', !/NaN|#DIV|#N\/A|undefined|Infinity|null|\[object/.test(t), t.match(/NaN|#DIV|#N\/A|undefined|Infinity|null|\[object/)?.[0]);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(label + ': no page overflow', over <= 0, over);
};
const axe = async (p, label) => {
  await p.evaluate(axeSrc);
  const r = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map(v => [v.id, v.impact, v.nodes.length, v.nodes[0].html.slice(0, 120)]));
  ok(label + ': axe clean', r.length === 0, r);
};

/* ---- A. a real business, typed from scratch ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  ok('A plain link starts on the welcome step', (await p.textContent('#stepTitle')).includes('לפני שמתחילים'));
  await clean(p, 'A0'); await axe(p, 'A0 desktop');
  await type(p, 'biz.name', 'סטודיו בדיקה');
  ok('A name shows in the header', (await p.textContent('#bizLabel')).includes('סטודיו בדיקה'));
  await p.click('[data-goto="1"].btn');
  ok('A focus moves to the step title', await p.evaluate(() => document.activeElement.id === 'stepTitle'));
  await clean(p, 'A1 empty');
  await p.click('[data-add="material"]');
  ok('A new row focuses its name', await p.evaluate(() => document.activeElement.getAttribute('data-path') === 'materials.0.name'));
  await type(p, 'materials.0.name', 'בד כותנה');
  await type(p, 'materials.0.pack', '12'); await type(p, 'materials.0.cost', '1200');
  ok('A thousands separator while typing', (await p.inputValue('[data-path="materials.0.cost"]')) === '1,200');
  ok('A typing keeps focus', await p.evaluate(() => document.activeElement.getAttribute('data-path') === 'materials.0.cost'));
  near('A material price with wastage', (await R(p)).settings.wastePct, 10);
  ok('A live wastage value', (await p.textContent('[data-live="matPrice"]')).includes('1,320'));
  await p.click('[data-add="material"]');
  await type(p, 'materials.1.name', 'בד כותנה'); await type(p, 'materials.1.pack', '1'); await type(p, 'materials.1.cost', '50');
  await axe(p, 'A1 filled');
  await go(p, 2);
  await p.click('[data-add="product"]');
  await type(p, 'products.0.name', 'שמלה');
  await p.click('[data-addline="0"]');
  const opts = await p.locator('[data-path="products.0.lines.0.mat"] option').allTextContents();
  ok('A materials in the select', opts.filter(x => x === 'בד כותנה').length === 2, opts);
  const secondId = (await St(p)).materials[1].id;
  await p.selectOption('[data-path="products.0.lines.0.mat"]', secondId);
  await type(p, 'products.0.lines.0.qty', '2');
  near('A same-named material resolves by id', (await R(p)).products[0].direct, 110);
  await p.click('[data-add="product"]');
  await type(p, 'products.1.name', 'ייעוץ');
  await axe(p, 'A2 filled'); await clean(p, 'A2');
  await go(p, 3);
  await type(p, 'labor.net', '12000'); await type(p, 'labor.pension', '1000'); await type(p, 'labor.fund', '500'); await type(p, 'labor.hours', '160');
  await p.click('[data-add="monthly"]');
  await type(p, 'labor.monthly.0.name', 'דנה'); await type(p, 'labor.monthly.0.gross', '8000'); await type(p, 'labor.monthly.0.hours', '100');
  near('A employer coefficient applied', (await R(p)).labor.monthlyCost, 10800);
  await p.click('[data-add="hourly"]');
  await type(p, 'labor.hourly.0.name', 'יוסי'); await type(p, 'labor.hourly.0.rate', '60'); await type(p, 'labor.hourly.0.hours', '20');
  near('A hourly cost', (await R(p)).labor.hourlyCost, 1620);
  near('A total hours', (await R(p)).labor.totalHours, 280);
  await axe(p, 'A3'); await clean(p, 'A3');
  await go(p, 4);
  await p.locator('[data-quick="overhead.admin.0"]').fill('3000');
  await p.locator('[data-quick="overhead.marketing.2"]').fill('1000');
  let r = await R(p);
  near('A quick value fills 12 months', r.overhead.annual, 48000);
  await p.locator('[data-how="ohadmin3"] > summary').click();
  await p.locator('[data-path="overhead.admin.3.m.5"]').fill('600');
  near('A one month detail counts', (await R(p)).overhead.annual, 48600);
  ok('A quick shows varied', (await p.locator('[data-quick="overhead.admin.3"]').getAttribute('placeholder')) === 'משתנה');
  await axe(p, 'A4'); await clean(p, 'A4');
  await go(p, 5);
  await type(p, 'tax.points', '2.75'); await type(p, 'tax.saving', '1000');
  r = await R(p);
  near('A tax solves the net plus saving', r.tax.net, 13000, 0.02);
  await p.locator('[data-how="taxTables"] > summary').click();
  await axe(p, 'A5'); await clean(p, 'A5');
  await go(p, 6);
  await type(p, 'products.0.hours', '2'); await type(p, 'products.0.marginPct', '30'); await type(p, 'products.0.market', '700');
  await type(p, 'products.1.hours', '1.5'); await type(p, 'products.1.marginPct', '50');
  r = await R(p);
  const c0 = r.products[0].calc;
  ok('A breakdown shows the recommended price', (await p.locator('[data-live="prodLedger"][data-arg="0"]').textContent()).includes(c0.recommended.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
  await p.locator('[data-how="price0"] > summary').click();
  ok('A how box opens', await p.locator('[data-how="price0"] .how-b').isVisible());
  await type(p, 'products.0.hours', '2.5');
  ok('A how box stays open while typing', await p.locator('[data-how="price0"] .how-b').isVisible());
  await type(p, 'products.0.hours', '2');
  await type(p, 'products.0.chosen', '100');
  ok('A below-min warning', (await p.locator('[data-live="prodChosen"][data-arg="0"]').textContent()).includes('לא מכסה'));
  await type(p, 'products.0.chosen', String(Math.round(c0.minPrice * 1.18 * 1.0135 * 1.05)));
  ok('A below-recommended note', (await p.locator('[data-live="prodChosen"][data-arg="0"]').textContent()).includes('חסרים'));
  await type(p, 'products.0.chosen', String(Math.ceil(c0.recommended) + 10));
  ok('A above-recommended ok', (await p.locator('[data-live="prodChosen"][data-arg="0"]').textContent()).includes('מכסה הכל'));
  const chosenVal = Math.ceil(c0.recommended) + 10;
  r = await R(p);
  near('A chosen price feeds the list', r.products[0].net, chosenVal / 1.0135 / 1.18, 1e-6);
  await type(p, 'products.1.marginPct', '120');
  ok('A margin over 100 warns', (await p.locator('[data-live="prodLedger"][data-arg="1"]').textContent()).includes('לא אפשרי'));
  await type(p, 'products.1.marginPct', '50');
  await axe(p, 'A6'); await clean(p, 'A6');
  await go(p, 7);
  ok('A no mix: says simple average', (await p.locator('[data-live="mixNote"]').textContent()).includes('ממוצע פשוט') || (await St(p)).products[0].mix !== '');
  await type(p, 'products.0.mix', '70'); await type(p, 'products.1.mix', '20');
  ok('A mix must reach 100', (await p.locator('[data-live="mixNote"]').textContent()).includes('צריך להגיע'));
  await type(p, 'products.1.mix', '30');
  ok('A mix 100 ok', (await p.locator('[data-live="mixNote"]').textContent()).includes('100%'));
  r = await R(p);
  near('A weighted margin', r.grossMargin, 0.7 * r.products[0].grossPct + 0.3 * r.products[1].grossPct, 1e-9);
  await axe(p, 'A7'); await clean(p, 'A7');
  await go(p, 8);
  r = await R(p);
  ok('A revenue is shown', (await p.locator('[data-live="reverse"]').textContent()).includes(Math.round(r.annual.revenue).toLocaleString('he-IL')));
  near('A P&L closes', r.annual.revenue - r.annual.cogs - r.annual.fund - r.annual.pension - r.annual.employees - r.annual.admin - r.annual.marketing - r.annual.taxes, r.annual.net, 0.05);
  await axe(p, 'A8'); await clean(p, 'A8');
  await go(p, 9);
  await p.click('[data-act="spread"]');
  r = await R(p);
  ok('A spread reaches the units goal', r.goals.every(g => g.planned >= g.unitsYear - 1e-6 && g.planned < g.unitsYear + 1), r.goals.map(g => [g.planned, g.unitsYear]));
  ok('A plan compared with goal', (await p.locator('[data-live="planGap"]').textContent()).includes('תכננת'));
  await type(p, 'plan.launches.2', 'השקת קולקציה');
  await p.locator('[data-path="products.0.plan.0"]').fill('5000');
  ok('A capacity warning for a month over hours', (await p.locator('[data-live="planGap"]').textContent()).includes('שעות'));
  await p.locator('[data-path="products.0.plan.0"]').fill(String((await St(p)).products[0].plan[1]));
  await axe(p, 'A9'); await clean(p, 'A9');
  await go(p, 10);
  ok('A summary has the price list', (await p.locator('[data-live="summaryList"]').textContent()).includes('שמלה'));
  await axe(p, 'A10'); await clean(p, 'A10');
  ok('A rail shows steps done', (await p.textContent('#railCount')).includes('9 מתוך 9'), await p.textContent('#railCount'));
  await p.screenshot({ path: `${OUT}/a-summary.png`, fullPage: true });

  /* ---- H. Excel download ---- */
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xlsxBtn')]);
  const xfile = `${OUT}/${'export.xlsx'}`; await dl.saveAs(xfile);
  ok('H file name carries the business', dl.suggestedFilename().includes('סטודיו בדיקה'), dl.suggestedFilename());
  ok('H file is a real workbook', fs.readFileSync(xfile).slice(0, 2).toString() === 'PK');
  execFileSync(process.env.PY || 'python3', ['-I', new globalThis.URL('./dump_xlsx.py', import.meta.url).pathname, xfile, xfile + '.json', '--cached']);
  const dump = JSON.parse(fs.readFileSync(xfile + '.json', 'utf8'));
  ok('H 9 sheets', Object.keys(dump.formulas).length === 9, Object.keys(dump.formulas));
  r = await R(p);
  near('H revenue in the file', dump.cached['רווח רצוי'].B16, r.annual.revenue, 0.01);
  near('H break-even in the file', dump.cached['רווח רצוי'].B19, r.breakEven, 0.01);
  ok('H no other brand in the file', !/MASTER|מאסטר/i.test(JSON.stringify(dump)));
  ok('H success note', (await p.textContent('#xlsxOut')).includes('הקובץ ירד'));

  /* ---- I. PDF ---- */
  await p.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await p.click('[data-act="pdf"]');
  ok('I print called', await p.evaluate(() => window.__printed === true));
  const pdf = `${OUT}/summary.pdf`;
  await p.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
  const pages = (fs.readFileSync(pdf, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok('I PDF has 3 pages', pages === 3, pages);
  await p.emulateMedia({ media: 'print' }); await p.setViewportSize({ width: 794, height: 1123 });
  await p.screenshot({ path: `${OUT}/print.png`, fullPage: true });
  ok('I app hidden in print', await p.evaluate(() => getComputedStyle(document.querySelector('.app')).display === 'none'));
  ok('I print fits the page', await p.evaluate(() => [...document.querySelectorAll('#printRoot table')].every(t => t.scrollWidth <= t.parentElement.clientWidth + 1)));
  ok('I print has no controls text', !/(להשלים|לתקן)$/.test(await p.textContent('#printRoot')));
  await p.emulateMedia({ media: 'screen' }); await p.setViewportSize({ width: 1440, height: 900 });

  /* ---- F. draft ---- */
  await p.waitForTimeout(500);
  await p.goto(URL_); await p.waitForFunction(() => window.__pricing); await p.waitForTimeout(200);
  ok('F plain link does not load data by itself', (await St(p)).biz.name === '');
  ok('F offers the draft by name', (await p.textContent('#draftCard')).includes('סטודיו בדיקה'));
  await p.click('[data-act="resume"]');
  ok('F resume restores', (await St(p)).products.length === 2 && (await St(p)).biz.name === 'סטודיו בדיקה');
  ok('F resume keeps the numbers', Math.abs((await R(p)).annual.revenue - r.annual.revenue) < 0.01);
  await p.goto(URL_); await p.waitForFunction(() => window.__pricing); await p.waitForTimeout(200);
  await p.click('[data-act="fresh"]');
  ok('F fresh clears the screen', (await St(p)).products.length === 0);
  ok('F fresh keeps a backup of the old draft', await p.evaluate(() => (localStorage.getItem('rl_pricing_v4_prev') || '').includes('סטודיו בדיקה')));
  ok('A no console errors', p.errs.length === 0, p.errs);
  await ctx.close();
}

/* ---- B. empty tool: every step explains, nothing breaks ---- */
for (const [label, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const { ctx, p } = await newPage(vp); await open(p);
  for (let i = 0; i <= 10; i++) { await go(p, i); await clean(p, `B ${label} empty step ${i}`); }
  await go(p, 6); ok('B step 6 says what is missing', (await p.locator('[data-live="need6"]').textContent()).includes('חסרים'));
  await go(p, 8); ok('B step 8 says what is missing', (await p.locator('[data-live="need8"]').textContent()).includes('חסרים'));
  await go(p, 9); ok('B step 9 says what is missing', (await p.locator('[data-live="need9"]').textContent()).includes('מחירון'));
  await p.click('[data-live="need9"] [data-goto="6"]'); ok('B the link goes to the step', (await p.textContent('#stepTitle')).includes('תמחור'));
  ok('B no console errors ' + label, p.errs.length === 0, p.errs);
  await ctx.close();
}

/* ---- C. service only, D. exempt dealer ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  await go(p, 1); await p.check('#noMat');
  ok('C materials hidden for a service', await p.locator('#matCard').isHidden());
  await go(p, 2); await p.click('[data-add="product"]'); await type(p, 'products.0.name', 'שיחת ייעוץ');
  ok('C no material button', await p.locator('[data-addline="0"]').count() === 0);
  await go(p, 3); await type(p, 'labor.net', '9000'); await type(p, 'labor.hours', '120');
  await go(p, 5); await type(p, 'tax.points', '2.75');
  await go(p, 6); await type(p, 'products.0.hours', '1'); await type(p, 'products.0.marginPct', '20');
  const r = await R(p);
  ok('C single product needs no mix', r.annual.revenue > 0 && Math.abs(r.goals[0].turnover - r.annual.revenue) < 0.01);
  near('C service margin is 100%', r.grossMargin, 1, 1e-9);
  for (let i = 1; i <= 10; i++) { await go(p, i); await clean(p, 'C step ' + i); }
  await go(p, 0); await p.click('[data-type="patur"]');
  const r2 = await R(p);
  near('D exempt: no VAT', r2.products[0].calc.withVat, r2.products[0].calc.preVat, 1e-9);
  await go(p, 6);
  ok('D exempt: no VAT field', await p.locator('[data-path="biz.vatPct"]').count() === 0);
  ok('D exempt: no VAT line', !(await p.locator('[data-live="prodLedger"]').first().textContent()).includes('מע"מ 18'));
  await go(p, 3); await type(p, 'labor.net', '20000');
  await go(p, 8);
  ok('D exempt: warns over the ceiling', (await p.locator('[data-live="reverse"]').textContent()).includes('תקרת עוסק פטור'));
  await go(p, 1);
  ok('C/D no console errors', p.errs.length === 0, p.errs);
  await ctx.close();
}

/* ---- E. odd input ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  await p.click('[data-act="demo"]');
  await go(p, 3);
  await p.locator('[data-path="labor.net"]').fill('abc');
  ok('E letters are dropped', (await p.inputValue('[data-path="labor.net"]')) === '');
  await p.locator('[data-path="labor.net"]').fill('999999999');
  await go(p, 8); await clean(p, 'E huge income');
  await go(p, 3); await p.locator('[data-path="labor.hours"]').fill('0');
  await go(p, 6); await clean(p, 'E zero hours');
  await go(p, 3); await p.locator('[data-path="labor.net"]').fill('0.5'); await p.locator('[data-path="labor.hours"]').fill('0.25');
  await go(p, 10); await clean(p, 'E tiny numbers');
  await go(p, 1);
  await p.locator('[data-del="materials"]').first().click();
  await go(p, 2); await clean(p, 'E deleted material still referenced');
  ok('E deleted material costs 0', (await R(p)).products[0].calc.direct < 100);
  const del = p.locator('[data-delprod="0"]');
  await del.click();
  ok('E product delete asks first', (await St(p)).products.length === 3 && (await del.textContent()).includes('בטוח'));
  await del.click();
  ok('E product deleted', (await St(p)).products.length === 2);
  await go(p, 0);
  /* stress: 20 products */
  await p.evaluate(() => { const s = window.__pricing.S; for (let i = 0; i < 18; i++) s.products.push({ id: 'x' + i, name: 'מוצר ' + i, lines: [{ mat: s.materials[0].id, qty: 1 }], hours: 1, specific: '', marginPct: 30, market: '', chosen: '', mix: 5, plan: Array(12).fill(1) }); });
  await go(p, 6);
  const t0 = Date.now(); await type(p, 'biz.contingencyPct', '12'); const ms = Date.now() - t0;
  ok('E 20 products stay responsive', ms < 1500, ms);
  ok('E with many products only the first is open', await p.locator('details.prod[open]').count() === 1, await p.locator('details.prod[open]').count());
  await clean(p, 'E 20 products');
  await go(p, 9); await clean(p, 'E 20 products plan');
  ok('E no console errors', p.errs.length === 0, p.errs);
  await ctx.close();
}

/* ---- G. encrypted live link ---- */
{
  const store = new Map(); let posted = [], offline = false;
  const mock = async route => {
    if (offline) return route.abort('internetdisconnected');
    if (LIVE_SHARE) return route.continue();
    const req = route.request(), u = new globalThis.URL(req.url()), id = u.searchParams.get('id'), headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.method() === 'POST') { posted.push(req.postData()); if (id) { if (!store.has(id)) return route.fulfill({ status: 404, headers, body: '{}' }); store.set(id, req.postData()); return route.fulfill({ headers, body: '{"ok":true}' }); } const nid = 'abc' + store.size; store.set(nid, req.postData()); return route.fulfill({ headers, body: JSON.stringify({ id: nid }) }); }
    if (!store.has(id)) return route.fulfill({ status: 404, headers, body: '{}' });
    return route.fulfill({ headers: { ...headers, 'content-type': 'text/plain' }, body: store.get(id) });
  };
  const a = await newPage(); await a.ctx.route(/richlife-share/, mock); await open(a.p);
  await a.p.click('[data-act="demo"]'); await go(a.p, 10);
  await a.p.click('#shareBtn');
  await a.p.waitForSelector('#linkField');
  const link = await a.p.inputValue('#linkField');
  ok('G link has id and key', /#p=[^.]+\.[\w-]{40,}$/.test(link), link);
  ok('G badge is on', await a.p.locator('#liveBadge').isVisible());
  if (!LIVE_SHARE) {
    ok('G server gets ciphertext only', posted.length > 0 && !posted.some(b => /הסטודיו|שרשרת|labor/.test(b) || /הסטודיו/.test(Buffer.from(b.replace(/^v4\./, ''), 'base64').toString('utf8'))));
    ok('G key never sent', !posted.some(b => b.includes(link.split('.').pop())));
  }
  const before = await R(a.p);
  const b = await newPage({ width: 390, height: 844 }); await b.ctx.route(/richlife-share/, mock);
  await b.p.goto(link); await b.p.waitForFunction(() => window.__pricing); await b.p.waitForTimeout(800);
  ok('G other device opens the same business', (await St(b.p)).biz.name === (await St(a.p)).biz.name);
  near('G same revenue on the other device', (await R(b.p)).annual.revenue, before.annual.revenue, 0.01);
  ok('G opens on the summary', (await b.p.textContent('#stepTitle')).includes('התמונה המלאה'));
  await a.p.evaluate(() => window.__pricing.go(3));
  await type(a.p, 'labor.net', '20000');
  await a.p.waitForTimeout(1900);
  const c = await newPage(); await c.ctx.route(/richlife-share/, mock);
  await c.p.goto(link); await c.p.waitForFunction(() => window.__pricing); await c.p.waitForTimeout(800);
  ok('G edits reach the same link', Number((await St(c.p)).labor.net) === 20000, (await St(c.p)).labor.net);
  await a.p.waitForTimeout(500);
  const urlBefore = a.p.url(); ok('G the link stays in the address bar', urlBefore === link);
  const wrong = await newPage(); await wrong.ctx.route(/richlife-share/, mock);
  await wrong.p.goto(link.replace(/\.[\w-]+$/, '.' + Buffer.alloc(32, 7).toString('base64url'))); await wrong.p.waitForFunction(() => window.__pricing); await wrong.p.waitForTimeout(500);
  ok('G wrong key shows a message', (await wrong.p.textContent('#view')).includes('לא הצלחנו לפתוח'));
  ok('G wrong key loads nothing', (await St(wrong.p)).products.length === 0);
  await wrong.ctx.close();
  const gone = await newPage(); await gone.ctx.route(/richlife-share/, mock);
  await gone.p.goto(URL_ + '#p=nosuchid.' + Buffer.alloc(32, 7).toString('base64url')); await gone.p.waitForFunction(() => window.__pricing); await gone.p.waitForTimeout(500);
  ok('G missing link says so', (await gone.p.textContent('#view')).includes('כבר לא פעיל'));
  await gone.ctx.close();
  /* offline after attach: nothing is lost */
  offline = true;
  await go(a.p, 3); await type(a.p, 'labor.net', '21000'); await a.p.waitForTimeout(1900);
  ok('G offline tells the truth', (await a.p.textContent('#saveState')).includes('אין כרגע חיבור'), await a.p.textContent('#saveState'));
  ok('G offline keeps a local copy', await a.p.evaluate(id => (localStorage.getItem('rl_pricing_v4_doc_' + id) || '').includes('21000'), link.match(/#p=([^.]+)/)[1]));
  offline = false;
  /* new start detaches and never overwrites the link */
  const nb = a.p.locator('#newBtn'); await nb.click(); await nb.click();
  ok('G new start detaches', !(a.p.url().includes('#p=')) && (await St(a.p)).products.length === 0);
  ok('G badge off after detach', await a.p.locator('#liveBadge').isHidden());
  ok('G no console errors', a.p.errs.filter(e => !/net::|Failed to fetch/.test(e)).length === 0, a.p.errs);
  await a.ctx.close(); await b.ctx.close(); await c.ctx.close();
}

/* ---- J. phone: all steps, axe, screenshots ---- */
{
  for (const [nm, vp] of [['d', { width: 1440, height: 900 }], ['m', { width: 390, height: 844 }], ['t', { width: 820, height: 1100 }]]) {
    const { ctx, p } = await newPage(vp); await open(p);
    await p.click('[data-act="demo"]');
    for (let i = 0; i <= 10; i++) {
      await go(p, i);
      if (i === 9) await p.click('[data-act="spread"]');
      await clean(p, `J ${nm} step ${i}`);
      if (nm !== 't') await axe(p, `J ${nm} step ${i}`);
      await p.screenshot({ path: `${OUT}/${nm}-${String(i).padStart(2, '0')}.png`, fullPage: true });
    }
    if (nm === 'm') {
      await p.selectOption('#mobSelect', '4');
      ok('J phone step picker works', (await p.textContent('#stepTitle')).includes('עלויות עקיפות'));
      await go(p, 4);
      const small = await p.evaluate(() => [...document.querySelectorAll('#view input')].filter(e => e.offsetParent && e.getBoundingClientRect().width < 44).length);
      ok('J phone inputs are not squeezed', small === 0, small);
      await go(p, 9);
      ok('J phone calendar scrolls inside its box', await p.evaluate(() => { const w = document.querySelector('.cal').parentElement; return w.scrollWidth > w.clientWidth && document.documentElement.scrollWidth <= innerWidth; }));
    }
    ok(`J ${nm} no console errors`, p.errs.length === 0, p.errs);
    await ctx.close();
  }
}

/* ---- K. kit and content rules, on the served page ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  const html = await p.content();
  const res = await ctx.request.get(URL_); const raw = await res.text();
  ok('K a11y widget', await p.locator('#brain-a11y-btn').count() === 1);
  ok('K statement link', await p.locator('a[href*="negishut"]').count() >= 1);
  ok('K consent banner', raw.includes('id="rl-consent-css"'));
  ok('K noindex', raw.includes('name="robots" content="noindex"'));
  ok('K avatar alt', (await p.locator('.avatar').getAttribute('alt')).length > 0);
  ok('K other brand absent', !/MASTER PRICE|מאסטר פ/i.test(raw));
  const visible = await p.evaluate(() => document.body.innerText);
  const jsSrc = raw.replace(/<img[^>]+>/g, '');
  ok('K no long dashes', !/[–—]/.test(visible) && !/[–—]/.test(jsSrc.slice(jsSrc.indexOf('RichLife pricing tool UI'), jsSrc.indexOf('window.__pricing'))));
  ok('K no slash gender', !/[֐-׿]\/[יה](?![֐-׿])/.test(jsSrc.slice(jsSrc.indexOf('RichLife pricing tool UI'), jsSrc.indexOf('window.__pricing'))));
  await p.click('[data-act="demo"]'); await go(p, 10);
  ok('K ליווי CTA', await p.locator('.cta-btn[href*="service1one1"]').count() === 1);
  await ctx.close();
}

/* ---- O. ongoing management, typed like a real month ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  await go(p, 11); await clean(p, 'O11 empty'); await axe(p, 'O11 empty');
  ok('O only income is open at first', await p.evaluate(() => [...document.querySelectorAll('details.ops-sec')].filter(d => d.open).length) === 1);
  await p.evaluate(() => document.querySelectorAll('details.ops-sec').forEach(d => { d.open = true; }));
  ok('O starts on January', await p.locator('[data-opsedit="0"][aria-pressed="true"]').count() === 1);
  await type(p, 'ops.rows.income.0.m.0', '47200');
  await type(p, 'ops.rows.direct.1.m.0', '4720');
  await type(p, 'ops.rows.marketing.1.m.0', '5900');
  ok('O every expense row offers VAT and one-off', await p.locator('[data-check="ops.rows.marketing.3.oneOff"]').first().isVisible() && await p.locator('[data-check="ops.rows.finance.0.vat"]').first().isVisible());
  ok('O Facebook starts without VAT', (await p.evaluate(() => window.__pricing.S.ops.rows.marketing[0].vat)) === false);
  await type(p, 'ops.rows.admin.5.m.0', '7080');
  await type(p, 'ops.rows.finance.1.m.0', '500');
  await type(p, 'ops.draw.salary.0', '12000');
  await p.waitForTimeout(450);
  await go(p, 12); await clean(p, 'O12'); await axe(p, 'O12');
  const ladder = await p.locator('[data-live="opsLadder"]').innerText();
  ok('O ladder revenue without VAT', ladder.includes('40,000'), ladder);
  ok('O ladder gross', ladder.includes('36,000'));
  ok('O ladder operating', ladder.includes('25,000'));
  await p.click('.ti summary >> nth=0');
  ok('O explanation opens', (await p.locator('.ti-b').first().innerText()).includes('המכירות'));
  ok('O explanation survives typing refresh', await p.evaluate(() => document.querySelector('.ti').open));
  await p.click('details[data-how="opsGridRO"] summary');
  const grid = await p.locator('details[data-how="opsGridRO"]').innerText();
  ok('O yearly table shows the rows as entered', grid.includes('7,080') && grid.includes('47,200') && grid.includes('מנויים ומערכות'), grid.slice(0, 300));
  ok('O yearly table hides empty rows', !grid.includes('ריטיינר'));
  await axe(p, 'O12 yearly table');
  await p.screenshot({ path: OUT + '/o12-desktop.png', fullPage: true });
  await go(p, 13); await clean(p, 'O13 no points');
  const noPts = await p.locator('[data-live="opsTaxOut"]').innerText();
  await type(p, 'tax.points', '2.75'); await p.waitForTimeout(100);
  const pts = await p.locator('[data-live="opsTaxOut"]').innerText();
  ok('O points change the estimate', noPts !== pts);
  ok('O saving line shows', pts.includes('חוסכים'));
  ok('O tax year is written', (await p.locator('#view').innerText()).includes('לשנת מס 2026'));
  await p.click('[data-how="pickPoints"] summary');
  await p.locator('#pk_k0').pressSequentially('1');
  await p.selectOption('#pk_miluim', '2');
  ok('O picker fills the points', (await p.inputValue('[data-path="tax.points"]')) === '7.25', await p.inputValue('[data-path="tax.points"]'));
  ok('O picker shows the total', (await p.textContent('#pickTotal')).includes('7.25'));
  ok('O picker stays open while choosing', await p.locator('details[data-how="pickPoints"]').evaluate(d => d.open));
  await p.locator('[data-path="ops.otherIncome"]').pressSequentially('42000');
  const m = await p.evaluate(() => window.__pricing.O.annual);
  near('O maternity pay counted', m.otherIncome, 42000);
  await axe(p, 'O13 picker open');
  await axe(p, 'O13'); await p.screenshot({ path: OUT + '/o13-desktop.png', fullPage: true });

  // private expense lowers tax only
  const before = await p.evaluate(() => { const E = window.PricingEngine, S = window.__pricing.S; const o = E.ops(S); return [o.annual.total, o.months[0].preTax]; });
  await go(p, 11);
  ok('O home rows hidden until asked', await p.locator('[data-path="ops.private.0.m.0"]').count() === 0);
  await p.click('[data-check="ops.home"]');
  ok('O home rows appear', await p.locator('[data-path="ops.private.0.m.0"]').count() === 1);
  ok('O home box keeps its state', await p.locator('[data-check="ops.home"]').isChecked());
  await type(p, 'ops.private.0.m.0', '1000');
  const after = await p.evaluate(() => { const E = window.PricingEngine, S = window.__pricing.S; const o = E.ops(S); return [o.annual.total, o.months[0].preTax]; });
  ok('O private expense lowers tax', after[0] < before[0], [before, after]);
  near('O private expense leaves profit alone', after[1], before[1]);

  // one way to fill at a time: the yearly table replaces the month rows, and both hold the same data
  ok('O month mode has no yearly table', await p.locator('#view .grid-tbl').count() === 0);
  await p.click('[data-fillmode="year"]');
  ok('O yearly mode hides the month rows', await p.locator('.ops-rowwrap').count() === 0);
  ok('O yearly mode hides the month tabs', await p.locator('[data-opsedit]').count() === 0);
  ok('O grid shows empty rows too', (await p.locator('#view .grid-tbl').innerText()).includes('ריטיינר'));
  ok('O a cell exists once', await p.locator('[data-path="ops.rows.admin.11.m.0"]').count() === 1);
  await p.locator('[data-path="ops.rows.admin.11.m.0"]').pressSequentially('590');
  ok('O grid totals update', (await p.locator('[data-live="gridRow"][data-arg="ops.rows.admin.11.m"]').innerText()) === '590');
  await axe(p, 'O11 yearly mode');
  await p.click('[data-fillmode="month"]');
  ok('O the month view shows what the table got', (await p.inputValue('[data-path="ops.rows.admin.11.m.0"]')) === '590');
  await p.locator('[data-path="ops.rows.admin.11.m.0"]').fill('');
  await p.locator('[data-path="ops.rows.admin.11.m.0"]').pressSequentially('0');
  // February, copy from January
  await p.click('[data-opsedit="1"]');
  await p.click('[data-act="copyPrev"]');
  ok('O a section with data opens by itself', await p.locator('details[data-how="sec_admin"]').evaluate(d => d.open));
  ok('O copied expense', (await p.inputValue('[data-path="ops.rows.admin.5.m.1"]')) === '7,080');
  ok('O income is not copied', (await p.inputValue('[data-path="ops.rows.income.0.m.1"]')) === '');
  ok('O salary copied', (await p.inputValue('[data-path="ops.draw.salary.1"]')) === '12,000');

  // bank, including an overdraft
  await p.click('[data-opsedit="0"]');
  await p.locator('#bankOpen').fill('5000');
  const exp = await p.evaluate(() => window.PricingEngine.ops(window.__pricing.S).bank.expected);
  ok('O bank asks for the real balance', (await p.locator('[data-live="opsBank"]').innerText()).includes('אמורים'));
  await p.click('[data-opsedit="1"]'); await p.locator('#bankEnd').pressSequentially('-300');
  ok('O overdraft keeps the minus', (await p.inputValue('#bankEnd')) === '-300');
  const gap = await p.evaluate(() => window.PricingEngine.ops(window.__pricing.S).bank);
  near('O bank gap', gap.gap, -300 - gap.expected);
  ok('O bank gap shown', (await p.locator('[data-live="opsBank"]').innerText()).includes('פער'));

  // type switch and settings
  await p.click('[data-type="patur"]');
  ok('O patur hides the VAT payment', await p.locator('[data-path="ops.paid.vat.1"]').count() === 0);
  await go(p, 12);
  ok('O patur keeps the full amount', (await p.locator('[data-live="opsLadder"]').innerText()).includes('47,200'));
  await go(p, 11); await p.click('[data-type="murshe"]');
  await p.click('[data-how="opsSettings"] summary');
  await p.locator('[data-check="ops.rows.admin.5.vat"]').first().uncheck();
  ok('O both VAT boxes follow each other', !(await p.locator('[data-check="ops.rows.admin.5.vat"]').last().isChecked()));
  near('O row VAT switch', await p.evaluate(() => window.PricingEngine.ops(window.__pricing.S).months[0].admin), 7080);
  await axe(p, 'O11 settings open');

  // saved across a reload
  await p.waitForTimeout(500); await p.reload(); await p.waitForFunction(() => window.__pricing);
  await p.waitForTimeout(150);
  await p.click('[data-act="resume"]');
  ok('O resume lands on the results', (await p.textContent('#stepTitle')).includes('רווח ותזרים'));
  ok('O data survived', (await p.locator('[data-live="opsLadder"]').innerText()).includes('40,000'));
  await ctx.close();
}
/* ---- P. a draft saved before this feature still opens ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  await p.evaluate(() => { localStorage.setItem('rl_pricing_v4', JSON.stringify({ v: 4, biz: { name: 'ישן', type: 'murshe' }, materials: [], products: [], labor: { net: 9000, pension: 600, fund: 200, hours: 150, monthly: [], hourly: [] }, overhead: { marketing: [], admin: [] }, tax: { points: 2.75, saving: 0, tables: null }, plan: { dates: [], launches: [], promos: [], focus: [] } })); });
  await p.reload(); await p.waitForFunction(() => window.__pricing); await p.waitForTimeout(150);
  await p.click('[data-act="resume"]');
  await go(p, 11); await clean(p, 'P old draft');
  ok('P pension arrives from the salary step', (await p.inputValue('[data-path="ops.draw.pension.0"]')) === '600');
  ok('P fund arrives in every month', String(await p.evaluate(() => window.__pricing.S.ops.draw.fund[5])) === '200');
  ok('P no page errors', p.errs.length === 0, p.errs);
  await ctx.close();
}
/* ---- Q. phone, demo, decision tools ---- */
{
  const { ctx, p } = await newPage({ width: 400, height: 800 }); await open(p);
  await p.click('[data-act="demo"]');
  await go(p, 12); await p.click('details[data-how="opsGridRO"] summary'); await clean(p, 'Q12 yearly table'); await p.click('details[data-how="opsGridRO"] summary');
  await go(p, 11); await p.click('[data-fillmode="year"]'); await clean(p, 'Q11 yearly mode'); await axe(p, 'Q11 yearly mode'); await p.screenshot({ path: OUT + '/q11-year-phone.png' }); await p.click('[data-fillmode="month"]');
  for (const n of [7, 11, 12, 13]) { await go(p, n); await clean(p, 'Q' + n + ' phone'); await p.screenshot({ path: OUT + '/q' + n + '-phone.png', fullPage: true }); }
  await go(p, 12);
  await p.click('[data-opsview="q0"]');
  const avgQ = await p.locator('[data-live="opsAvg"]').innerText();
  ok('Q average for a quarter', avgQ.includes('40,000') && avgQ.includes('רבעון 1'), avgQ);
  ok('Q quarter ladder', (await p.locator('[data-live="opsLadder"]').innerText()).includes('120,000'));
  await p.click('[data-opsview="q1"]');
  ok('Q empty quarter says so', (await p.locator('[data-live="opsAvg"]').innerText()).includes('אין נתונים'));
  await p.click('[data-opsview="year"]');
  await p.click('[data-tableby="quarters"]');
  const qt = await p.locator('[data-live="opsTable"]').innerText();
  ok('Q table by quarters', qt.includes('רבעון 4') && !qt.includes('אוגוסט') && qt.includes('ממוצע בחודש'), qt.slice(0, 200));
  await axe(p, 'Q12 quarters'); await clean(p, 'Q12 quarters');
  const plain = await p.locator('[data-live="opsPlain"]').innerText();
  ok('Q plain words', plain.includes('העסק הרוויח') && plain.includes('חשבון הבנק'), plain);
  await p.click('details[data-how="t_cashNet"] summary');
  ok('Q table row explains itself', (await p.locator('details[data-how="t_cashNet"] .ti-b').innerText()).includes('החשבון'));
  await axe(p, 'Q12 row explanation'); await clean(p, 'Q12 row explanation');
  await p.click('details[data-how="t_cashNet"] summary');
  await p.selectOption('#opsUpto2', '2');
  const lim = await p.locator('[data-live="opsPlain"]').innerText();
  ok('Q says when months are left out', lim.includes('לא נספר') && lim.includes('רק עד פברואר'), lim);
  ok('Q total header names the month', (await p.locator('[data-live="opsTable"]').innerText()).includes('סך הכל עד פברואר'));
  await p.selectOption('#opsUpto2', '');
  const cash = await p.locator('[data-live="opsCash"]').innerText();
  ok('Q cash section', cash.includes('נכנס לחשבון') && cash.includes('יצא מהחשבון') && cash.includes('תזרים'), cash);
  ok('Q table has the cash rows', qt.includes('נכנס לחשבון') && qt.includes('תזרים'));
  await p.click('[data-tableby="months"]');
  const l = await p.locator('[data-live="opsLadder"]').innerText();
  ok('Q demo ladder, three months', l.includes('120,000') && l.includes('108,000') && l.includes('75,000'), l);
  await axe(p, 'Q12 phone');
  await go(p, 7);
  ok('Q rank renders', (await p.locator('[data-live="rankOut"]').innerText()).includes('לשעה'));
  await p.selectOption('#wiPct', '10');
  const up = await p.locator('[data-live="whatIfOut"]').innerText();
  await p.selectOption('#wiPct', '-20');
  const down = await p.locator('[data-live="whatIfOut"]').innerText();
  ok('Q what-if reacts', up !== down);
  ok('Q discount says sell more', down.includes('צריך למכור') || down.includes('מפסידים'), down);
  await axe(p, 'Q7 phone');
  await go(p, 3);
  ok('Q demo pension alert', (await p.locator('[data-live="pensionAlert"]').innerText()).includes('חובת ההפקדה'));
  ok('Q no page errors', p.errs.length === 0, p.errs);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log('FAILURES:\n' + failures.join('\n'));
process.exit(fail ? 1 : 0);
