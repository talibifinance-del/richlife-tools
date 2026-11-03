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
const go12 = async p => { await go(p, 12); await p.evaluate(() => { const d = document.querySelector('details[data-how="opsNumbers"]'); if (d && !d.open) d.open = true; }); await p.waitForTimeout(60); };
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
  await p.locator('[data-how="ledger0"] > summary').click();
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
  await go12(p); await clean(p, 'O12'); await axe(p, 'O12');
  const heroO = await p.locator('[data-live="homeHero"]').innerText();
  ok('O hero speaks in words', heroO.includes('העסק מרוויח'), heroO);
  ok('O chart has a text description', (await p.locator('.h-svg').first().getAttribute('aria-label')).includes('ינואר'));
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
  await go12(p);
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
  ok('O resume lands on the results', (await p.textContent('#stepTitle')).includes('איך העסק שלי'));
  await go12(p); ok('O data survived', (await p.locator('[data-live="opsLadder"]').innerText()).includes('40,000'));
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
  await go12(p); await p.click('details[data-how="opsGridRO"] summary'); await clean(p, 'Q12 yearly table'); await p.click('details[data-how="opsGridRO"] summary');
  await go(p, 11); await p.click('[data-fillmode="year"]'); await clean(p, 'Q11 yearly mode'); await axe(p, 'Q11 yearly mode'); await p.screenshot({ path: OUT + '/q11-year-phone.png' }); await p.click('[data-fillmode="month"]');
  for (const n of [7, 11, 12, 13]) { await go(p, n); await clean(p, 'Q' + n + ' phone'); await p.screenshot({ path: OUT + '/q' + n + '-phone.png', fullPage: true }); }
  await go12(p);
  await p.click('[data-opsperiod="q"]');
  await p.click('[data-opsview="q0"]');
  const avgQ = await p.locator('[data-live="opsPlain"]').innerText();
  ok('Q average for a quarter', avgQ.includes('24,500') && avgQ.includes('רבעון 1'), avgQ);
  ok('Q quarter ladder', (await p.locator('[data-live="opsLadder"]').innerText()).includes('120,000'));
  await p.click('[data-opsview="q1"]');
  ok('Q empty quarter says so', (await p.locator('[data-live="opsPlain"]').innerText()).includes('אין נתונים'));
  await p.click('[data-opsperiod="year"]');
  await p.click('[data-tableby="quarters"]');
  const qt = await p.locator('[data-live="opsTable"]').innerText();
  ok('Q table by quarters', qt.includes('רבעון 4') && !qt.includes('אוגוסט') && qt.includes('ממוצע בחודש'), qt.slice(0, 200));
  await axe(p, 'Q12 quarters'); await clean(p, 'Q12 quarters');
  const plain = await p.locator('[data-live="opsPlain"]').innerText();
  ok('Q plain words', plain.includes('העסק הרוויח') && plain.includes('חשבון הבנק'), plain);
  await p.click('details[data-how="t_cashNet"] summary');
  ok('Q table row explains itself', (await p.locator('details[data-how="t_cashNet"] .ti-b').innerText()).includes('בחשבון'));
  await axe(p, 'Q12 row explanation'); await clean(p, 'Q12 row explanation');
  await p.click('details[data-how="t_cashNet"] summary');
  await p.selectOption('#opsUpto2', '2');
  const lim = await p.locator('[data-live="opsPlain"]').innerText();
  ok('Q says when months are left out', lim.includes('לא נספר') && lim.includes('רק עד פברואר'), lim);
  ok('Q the hero says it too', (await p.locator('[data-live="homeHero"]').innerText()).includes('רק עד פברואר'));
  ok('Q total header names the month', (await p.locator('[data-live="opsTable"]').innerText()).includes('סך הכל עד פברואר'));
  await p.selectOption('#opsUpto2', '');
  const bank = await p.locator('[data-live="opsBankTable"]').innerText();
  ok('Q bank table', bank.includes('כסף שנכנס') && bank.includes('כסף שיצא') && bank.includes('יתרה בחשבון'), bank.slice(0, 200));
  ok('Q bank table explains the VAT gap', bank.includes('למה'));
  ok('Q profit table is short', !qt.includes('רווח גולמי') && qt.includes('הוצאות העסק'));
  await p.click('[data-tableby="months"]');
  const l = await p.locator('[data-live="opsLadder"]').innerText();
  ok('Q demo ladder, three months', l.includes('120,000') && l.includes('108,000') && l.includes('75,000'), l);
  await axe(p, 'Q12 phone');
  await go(p, 7);
  ok('Q rank renders', (await p.locator('[data-live="rankOut"]').innerText()).includes('לשעה'));
  ok('Q launch is the first question', await p.locator('[data-wimode="launch"][aria-pressed="true"]').count() === 1);
  await p.locator('[data-path="whatIf.baseUnits"]').pressSequentially('30');
  ok('Q launch says how many are needed', (await p.locator('[data-live="whatIfOut"]').innerText()).includes('לפחות'));
  await p.locator('[data-path="whatIf.launchUnits"]').pressSequentially('100');
  const lo = await p.locator('[data-live="whatIfOut"]').innerText();
  ok('Q launch gives a verdict', lo.includes('משתלמת'), lo);
  ok('Q launch counts hours', lo.includes('שעות'), lo);
  ok('Q launch says how it moves the goal', lo.includes('איך זה מקדם אותך'), lo);
  await p.locator('[data-path="whatIf.launchUnits"]').fill('5'); await p.locator('[data-path="whatIf.launchUnits"]').dispatchEvent('input');
  ok('Q a small launch does not pay', (await p.locator('[data-live="whatIfOut"]').innerText()).includes('לא משתלמת'));
  await p.selectOption('#wiLaunch', '-50'); await clean(p, 'Q deep discount');
  await axe(p, 'Q launch');
  await p.click('[data-wimode="raise"]');
  const ra = await p.locator('[data-live="whatIfOut"]').innerText();
  ok('Q raise says what can be lost', ra.includes('אפשר לאבד'), ra);
  await p.selectOption('#wiRaise', '30'); ok('Q raise reacts', ra !== await p.locator('[data-live="whatIfOut"]').innerText());
  await axe(p, 'Q raise');
  await p.click('[data-wimode="mid"]');
  await p.selectOption('#wiFrom', '6');
  const mi = await p.locator('[data-live="whatIfOut"]').innerText();
  ok('Q mid year names the month', mi.includes('יולי') && mi.includes('אילו זה היה כל השנה'), mi);
  await p.selectOption('#wiMid', '-20'); ok('Q mid year discount shows a loss', (await p.locator('[data-live="whatIfOut"]').innerText()).includes('-'));
  await p.click('[data-wimode="launch"]');
  await axe(p, 'Q7 phone');
  await go(p, 3);
  ok('Q demo pension alert', (await p.locator('[data-live="pensionAlert"]').innerText()).includes('חובת ההפקדה'));
  ok('Q no page errors', p.errs.length === 0, p.errs);
  await ctx.close();
}

/* ---- T. every working step says what to do ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  await p.click('[data-act="demo"]');
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13]) {
    await go(p, n);
    const g = p.locator('details.guide');
    ok('T step ' + n + ' has a guide', await g.count() === 1);
    const items = await g.locator('.g-list li').count();
    ok('T step ' + n + ' lists what to do', items >= 3, items);
    await clean(p, 'T step ' + n); 
  }
  await go(p, 6);
  const top = await p.locator('[data-live="prodPriceTop"]').first().innerText();
  const rec = await p.evaluate(() => Math.round(window.__pricing.R.products[0].calc.recommended).toLocaleString('he-IL'));
  ok('T the recommended price is on top', top.includes(rec), [top, rec]);
  await axe(p, 'T step 6'); await p.screenshot({ path: OUT + '/t6.png', fullPage: true });
  await go(p, 3); await p.locator('details.guide > summary').click();
  ok('T a guide can be closed', !(await p.locator('details.guide').evaluate(d => d.open)));
  await p.waitForTimeout(80); await go(p, 4); await p.waitForTimeout(80); await go(p, 3);
  ok('T it stays closed when coming back', !(await p.locator('details.guide').evaluate(d => d.open)));
  await axe(p, 'T closed guide');
  ok('T no page errors', p.errs.length === 0, p.errs);
  await ctx.close();
  const ph = await newPage({ width: 400, height: 800 }); await open(ph.p); await ph.p.click('[data-act="demo"]');
  for (const n of [1, 3, 6, 7, 9]) { await go(ph.p, n); await clean(ph.p, 'T phone ' + n); await ph.p.screenshot({ path: OUT + '/t-phone-' + n + '.png', fullPage: true }); }
  await axe(ph.p, 'T phone'); await ph.ctx.close();
}
/* ---- U. what the business sells ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  await axe(p, 'U welcome');
  await p.click('[data-sell="group"]'); await p.click('[data-sell="service"]');
  ok('U choices stay marked', await p.locator('[data-sell="group"][aria-pressed="true"]').count() === 1);
  await go(p, 1); await p.click('details[data-how="shared"] summary');
  await p.fill('#shName', 'חומרים ללק'); await p.fill('#shSpent', '600'); await p.fill('#shCount', '100'); await p.click('[data-act="addShared"]');
  ok('U shared material says the price', (await p.locator('#shOut').innerText()).includes('6'));
  ok('U shared material joins the list', (await p.evaluate(() => window.__pricing.S.materials[0].pack)) === 100);
  await p.click('[data-add="material"]'); await type(p, 'materials.1.name', 'מחברת'); await type(p, 'materials.1.pack', '1'); await type(p, 'materials.1.cost', '37');
  await p.fill('[data-path="biz.wastePct"]', '0');
  await go(p, 2);
  ok('U only chosen types can be added', await p.locator('[data-addtype="group"]').count() === 1 && await p.locator('[data-add="product"]').count() === 0 && await p.locator('[data-addtype="digital"]').count() === 0);
  await p.click('[data-addtype="group"]');
  ok('U a group starts with a size', (await p.inputValue('[data-path="products.0.size"]')) === '10');
  await type(p, 'products.0.name', 'סדנת ילדים');
  await p.click('[data-addline="0"]');
  await p.selectOption('[data-path="products.0.lines.0.mat"]', { label: 'מחברת' }); await type(p, 'products.0.lines.0.qty', '1');
  ok('U materials count per person', (await p.locator('[data-live="prodDirect"]').first().innerText()).includes('למשתתף'));
  // the room belongs to the whole event
  ok('U a new group starts with a room', (await p.inputValue('[data-path="products.0.eventCosts.0.name"]')) === 'שכירת חדר');
  await type(p, 'products.0.eventCosts.0.price', '100'); await type(p, 'products.0.eventCosts.0.qty', '3');
  ok('U price times hours', (await p.locator('[data-live="eventRow"]').first().innerText()).includes('300'));
  const evs = await p.locator('[data-live="eventSum"]').first().innerText();
  ok('U the room is split, not multiplied', evs.includes('300') && evs.includes('30'), evs);
  await p.click('[data-addevent="0"]'); ok('U adding a shared cost focuses it', await p.evaluate(() => document.activeElement.getAttribute('data-path') === 'products.0.eventCosts.1.name'));
  await p.click('[data-delevent="0:1"]'); near('U removing a shared cost', await p.evaluate(() => window.__pricing.S.products[0].eventCosts.length), 1);
  await axe(p, 'U group costs'); await clean(p, 'U group costs'); await p.screenshot({ path: OUT + '/u-step2.png', fullPage: true });
  // the rates of the approved picture
  await p.evaluate(() => { const S = window.__pricing.S; S.labor = { net: 11000, pension: 800, fund: 400, hours: 150, monthly: [], hourly: [{ name: 'x', role: '', rate: 45, hours: 30, factor: 1.35 }] }; S.tax.points = 2.75; S.tax.saving = 1000; S.overhead.marketing[2].m = S.overhead.marketing[2].m.map(() => 1200); S.overhead.marketing[1].m = S.overhead.marketing[1].m.map(() => 500); S.overhead.admin[0].m = S.overhead.admin[0].m.map(() => 1800); S.overhead.admin[3].m = S.overhead.admin[3].m.map(() => 120); S.overhead.admin[5].m = S.overhead.admin[5].m.map(() => 350); S.overhead.admin[9].m = S.overhead.admin[9].m.map(() => 400); });
  await go(p, 6);
  await type(p, 'products.0.hours', '5'); await p.fill('[data-path="products.0.marginPct"]', '40'); await type(p, 'products.0.chosen', '150');
  ok('U the event cost is shown, not asked again', await p.locator('[data-path="products.0.specific"]').count() === 0 && (await p.locator('[data-live="eventInSix"]').innerText()).includes('300'));
  await p.waitForTimeout(100);
  const hero = await p.locator('[data-live="prodGroupHero"]').innerText();
  ok('U the screen says how many are needed', hero.includes('12 משתתפים') && hero.includes('150'), hero);
  const kids = await p.locator('[data-live="prodGroup"]').innerText();
  ok('U each size shows what is left', kids.includes('הפסד 518') && kids.includes('נשאר 725'), kids);
  ok('U recommended price per person', kids.includes('311') && kids.includes('202'), kids);
  ok('U the head of the card is per person', (await p.locator('[data-live="prodHead"]').first().innerText()).includes('למשתתף'));
  await clean(p, 'U group'); await axe(p, 'U group'); await p.screenshot({ path: OUT + '/u-group.png', fullPage: true });
  // duplicate, and the original stays
  await go(p, 2); const before = await p.evaluate(() => JSON.stringify(window.__pricing.S.products[0]));
  await p.click('[data-dupprod="0"]');
  near('U duplicate adds one', await p.evaluate(() => window.__pricing.S.products.length), 2);
  ok('U the original did not move', before === await p.evaluate(() => JSON.stringify(window.__pricing.S.products[0])));
  await p.locator('[data-path="products.1.lines.0.qty"]').fill('3');
  ok('U the copy is separate', (await p.evaluate(() => window.__pricing.S.products[0].lines[0].qty)) === '1' || (await p.evaluate(() => window.__pricing.S.products[0].lines[0].qty)) === 1);
  ok('U a copy has its own id', await p.evaluate(() => window.__pricing.S.products[0].id !== window.__pricing.S.products[1].id));
  // changing the type asks the right questions
  await p.selectOption('[data-path="products.1.type"]', 'digital');
  ok('U digital has no materials', await p.locator('[data-path="products.1.lines.0.qty"]').count() === 0);
  await go(p, 6);
  ok('U digital asks about making it', await p.locator('[data-path="products.1.devHours"]').count() === 1 && await p.locator('[data-path="products.1.expected"]').count() === 1);
  await p.locator('[data-path="products.1.devHours"]').pressSequentially('40'); await p.locator('[data-path="products.1.expected"]').pressSequentially('100'); await p.locator('[data-path="products.1.devCost"]').pressSequentially('2000');
  near('U digital spreads the cost', await p.evaluate(() => window.__pricing.R.products[1].calc.specific), 20);
  await clean(p, 'U digital');
  // Excel keeps working with a group
  await go(p, 10);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xlsxBtn')]);
  ok('U Excel downloads with a group', !!(await dl.path()));
  ok('U no page errors', p.errs.length === 0, p.errs);
  await ctx.close();
  const ph = await newPage({ width: 400, height: 800 }); await open(ph.p);
  await clean(ph.p, 'U phone welcome'); await ph.p.screenshot({ path: OUT + '/u-phone-0.png', fullPage: true });
  await ph.p.click('[data-act="demo"]'); await go(ph.p, 6); await clean(ph.p, 'U phone group'); await axe(ph.p, 'U phone group');
  await ph.p.screenshot({ path: OUT + '/u-phone-6.png', fullPage: true }); await ph.ctx.close();
}
/* ---- V. sales and how they get paid ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  await p.click('[data-act="demo"]');
  const ymNow = await p.evaluate(() => { const m = +new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', month: 'numeric' }).format(new Date()), y = +new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', year: 'numeric' }).format(new Date()); return y + '-' + (m < 10 ? '0' : '') + m; });
  await go(p, 14); await clean(p, 'V demo'); await axe(p, 'V demo');
  ok('V the demo shows a forecast', (await p.locator('[data-live="salesForecast"]').innerText()).includes('צפוי'));
  await p.click('[data-act="newSale"]');
  ok('V a new sale opens for typing', await p.evaluate(() => document.activeElement.getAttribute('data-path') === 'sales.3.client'));
  await type(p, 'sales.3.client', 'נועה');
  await p.selectOption('[data-path="sales.3.product"]', 'p1');
  const price = await p.evaluate(() => Math.round(window.__pricing.R.products[0].customer));
  near('V the price comes from the price list', +(await p.evaluate(() => window.__pricing.S.sales[3].total)), price);
  // the payment types
  await p.click('[data-salekind="3:equal"]');
  await p.locator('[data-path="sales.3.total"]').fill('6600'); await p.locator('[data-path="sales.3.n"]').fill('6');
  await p.waitForTimeout(60);
  ok('V equal payments are spelled out', (await p.locator('[data-live="salePlan"][data-arg="3"]').innerText()).includes('1,100'));
  await p.locator('[data-check="sales.3.lump"]').check();
  ok('V paid at once', (await p.locator('[data-live="salePlan"][data-arg="3"]').innerText()).includes('6,600'));
  await p.locator('[data-check="sales.3.lump"]').uncheck();
  await p.click('[data-salekind="3:custom"]');
  await p.locator('[data-path="sales.3.parts.0.amount"]').pressSequentially('1000');
  await p.click('[data-addpart="3"]');
  await p.locator('[data-path="sales.3.parts.1.amount"]').pressSequentially('1120');
  await p.waitForTimeout(60);
  const plan2 = await p.locator('[data-live="salePlan"][data-arg="3"]').innerText();
  ok('V varied payments listed', plan2.includes('1,000') && plan2.includes('1,120'), plan2);
  ok('V says when the parts do not add up', plan2.includes('מסתכמים'), plan2);
  await axe(p, 'V custom');
  await p.click('[data-salekind="3:sub"]');
  await p.locator('[data-path="sales.3.monthly"]').pressSequentially('1500');
  await p.waitForTimeout(60);
  ok('V retainer in the summary', (await p.locator('[data-live="saleLine"][data-arg="3"]').innerText()).includes('מנוי'));
  // the forecast adds this sale
  const fcBefore = await p.evaluate(ym => window.PricingEngine.salesForecast(window.__pricing.S, ym, 1).total, ymNow);
  await p.selectOption('[data-path="sales.3.cancelled"]', ymNow);
  await p.waitForTimeout(60);
  const fcAfter = await p.evaluate(ym => window.PricingEngine.salesForecast(window.__pricing.S, ym, 1).total, ymNow);
  near('V a cancelled sale leaves the forecast', fcBefore - fcAfter, 1500);
  await p.locator('[data-live="salesForecast"] .f-col').first().hover();
  ok('V hovering a month lists it', (await p.locator('#hTip').innerText()).includes('צפוי להיכנס'));
  ok('V monthly counts table', (await p.locator('[data-live="salesCounts"]').innerText()).includes('נמכרו'));
  // the home screen and the monthly fill see it
  await go(p, 12); ok('V the home screen shows it', (await p.locator('[data-live="homeForecast"]').innerText()).includes('צפוי להיכנס'));
  await axe(p, 'V home');
  await go(p, 11);
  await p.evaluate(ym => { window.__pricing.S.ops.edit = +ym.slice(5, 7) - 1; }, ymNow); await go(p, 11);
  const yearOk = await p.evaluate(ym => window.__pricing.S.ops.year === +ym.slice(0, 4), ymNow);
  if (yearOk) ok('V the monthly fill shows what is expected', (await p.locator('[data-live="opsExpected"]').innerText()).includes('צפויים'));
  // delete asks first, and it survives a reload
  await go(p, 14);
  await p.locator('details.sale[open] [data-delsale="3"]').click();
  ok('V delete asks first', await p.evaluate(() => window.__pricing.S.sales.length) === 4);
  await p.locator('details.sale[open] [data-delsale="3"]').click();
  ok('V delete removes', await p.evaluate(() => window.__pricing.S.sales.length) === 3);
  await p.waitForTimeout(450); await p.reload(); await p.waitForFunction(() => window.__pricing); await p.waitForTimeout(150); await p.click('[data-act="resume"]');
  ok('V sales survive a reload', await p.evaluate(() => window.__pricing.S.sales.length) === 3);
  ok('V no page errors', p.errs.length === 0, p.errs);
  await ctx.close();
  const ph = await newPage({ width: 400, height: 800 }); await open(ph.p); await ph.p.click('[data-act="demo"]'); await go(ph.p, 14);
  await clean(ph.p, 'V phone'); await axe(ph.p, 'V phone'); await ph.p.screenshot({ path: OUT + '/v-phone.png', fullPage: true }); await ph.ctx.close();
  const d = await newPage(); await open(d.p); await d.p.click('[data-act="demo"]'); await go(d.p, 14);
  await d.p.locator('details.sale > summary').first().click(); await d.p.waitForTimeout(80);
  await d.p.screenshot({ path: OUT + '/v-desk.png', fullPage: true }); await d.ctx.close();
}
/* ---- X. saving to move the business forward ---- */
{
  const { ctx, p } = await newPage(); await open(p); await p.click('[data-act="demo"]');
  const before = await p.evaluate(() => ({ t: window.__pricing.R.targetNet, r: window.__pricing.R.annual.revenue }));
  await go(p, 3); await type(p, 'labor.growth', '2000'); await p.waitForTimeout(60);
  const after = await p.evaluate(() => ({ t: window.__pricing.R.targetNet, r: window.__pricing.R.annual.revenue }));
  near('X the target grows', after.t - before.t, 2000); ok('X so does the sales target', after.r > before.r);
  await go(p, 5); ok('X the tax step says so', (await p.locator('[data-live="taxNeed"]').innerText()).includes('לקידום העסק'));
  await clean(p, 'X'); await axe(p, 'X'); await ctx.close();
}
/* ---- W. a group saved with the old single field keeps its money ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  await p.evaluate(() => localStorage.setItem('rl_pricing_v4', JSON.stringify({ v: 4, biz: { name: 'ישן', type: 'murshe' }, materials: [], products: [{ id: 'g', type: 'group', size: 10, name: 'סדנה', lines: [], hours: 5, specific: 300, marginPct: 40, plan: [] }], labor: { net: 9000, hours: 150, monthly: [], hourly: [] }, overhead: { marketing: [], admin: [] }, tax: { points: 2.75, saving: 0, tables: null } })));
  await p.reload(); await p.waitForFunction(() => window.__pricing); await p.waitForTimeout(150); await p.click('[data-act="resume"]');
  const st = await p.evaluate(() => window.__pricing.S.products[0]);
  ok('W the old amount became a row', st.eventCosts.length === 1 && +st.eventCosts[0].price === 300 && st.specific === '', st);
  near('W the money is counted once', await p.evaluate(() => window.__pricing.R.products[0].calc.specific), 300);
  await ctx.close();
}
/* ---- S. the home screen says the right thing, and years work ---- */
{
  const { ctx, p } = await newPage(); await open(p);
  await p.click('[data-act="demo"]');
  await go12(p);
  // three states of the sentence, checked against the numbers
  const hero = () => p.locator('[data-live="homeHero"]').innerText();
  const O_ = () => p.evaluate(() => { const o = window.__pricing.O; return { net: o.total.net, left: o.total.left }; });
  let n = await O_(); ok('S demo covers what was taken', n.left > 0 && (await hero()).includes('מכוסה'), [n, await hero()]);
  await p.evaluate(() => { const S = window.__pricing.S; S.ops.draw.salary = S.ops.draw.salary.map(v => v === '' ? '' : 30000); });
  await go12(p); n = await O_(); ok('S taking too much is said', n.left < 0 && n.net > 0 && (await hero()).includes('יותר ממה שהרווחת'), [n, await hero()]);
  ok('S the tile warns', (await p.locator('[data-live="homeTiles"]').innerText()).includes('לקחת יותר מהרווח'));
  await p.evaluate(() => { const S = window.__pricing.S; S.ops.rows.admin[0].m = S.ops.rows.admin[0].m.map(v => v === '' ? '' : 90000); });
  await go12(p); n = await O_(); ok('S a loss is said', n.net <= 0 && (await hero()).includes('הפסיד'), [n, await hero()]);
  await clean(p, 'S loss'); await axe(p, 'S loss');
  await p.evaluate(() => { const S = window.__pricing.S; S.ops.rows.admin[0].m = S.ops.rows.admin[0].m.map(v => v === '' ? '' : 5000); S.ops.draw.salary = S.ops.draw.salary.map(v => v === '' ? '' : 12000); S.ops.notes[1] = 'חופשת לידה'; });
  await go12(p);
  ok('S the month note reaches the chart', (await p.locator('[data-live="homeBars"]').innerHTML()).includes('חופשת לידה'));
  // hover and tap give the numbers
  await p.locator('[data-live="homeBars"] .h-hit').first().hover();
  const tip1 = await p.locator('#hTip').innerText();
  ok('S hovering a month shows its numbers', tip1.includes('ינואר') && tip1.includes('הכנסות') && tip1.includes('רווח לפני מס'), tip1);
  await p.locator('[data-live="homeBalance"] .h-hit').first().hover();
  ok('S hovering the balance shows it', (await p.locator('#hTip').innerText()).includes('יתרה בסוף החודש'));
  await p.locator('h1').first().hover();
  ok('S the tip goes away', await p.locator('#hTip').isHidden());
  // a month view
  await p.click('[data-opsperiod="m"]'); await p.click('[data-opsview="0"]');
  ok('S the out-of-100 card is gone', await p.locator('[data-live="homeShare"]').count() === 0);
  ok('S a month speaks about that month', (await hero()).includes('בינואר'), await hero());
  await p.click('[data-opsview="7"]'); ok('S an empty month says so', (await hero()).includes('אין נתונים'));
  await p.click('[data-opsperiod="year"]');
  await p.screenshot({ path: OUT + '/s-home.png', fullPage: true });
  // close the year
  const before = await p.evaluate(() => { const o = window.__pricing.O; return { pre: o.total.preTax, end: o.bank.expected, y: o.year }; });
  await p.click('[data-act="closeYear"]');
  ok('S closing asks first', (await p.locator('[data-act="closeYear"]').innerText()).includes('בטוח'));
  await p.click('[data-act="closeYear"]');
  ok('S lands on filling the new year', (await p.textContent('#stepTitle')).includes('מילוי החודש'));
  const after = await p.evaluate(() => { const P = window.__pricing; return { y: P.S.ops.year, open: P.S.ops.bank.opening, k: P.O.k, old: !!P.S.years[2026] || Object.keys(P.S.years).length }; });
  near('S next year', after.y, before.y + 1); near('S balance carried', after.open, before.end); near('S empty', after.k, 0); ok('S old year kept', !!after.old);
  await clean(p, 'S new year 11');
  await p.locator('[data-path="ops.rows.income.3.m.0"]').pressSequentially('11800');
  await go12(p); await clean(p, 'S new year 12');
  const hasTbl = await p.evaluate(y => window.PricingEngine.hasTables(y), after.y);
  if (!hasTbl) ok('S says the tables are not updated', (await hero()).includes('עוד לא עודכנו'));
  ok('S trend appears', (await p.locator('[data-live="homeTrend"]').innerText()).includes('מול ' + before.y), await p.locator('[data-live="homeTrend"]').innerText());
  await axe(p, 'S trend');
  // back to the old year, change it, and it stays
  await p.click('[data-opsyear="' + before.y + '"]');
  near('S old year numbers are back', await p.evaluate(() => window.__pricing.O.total.preTax), before.pre);
  await go(p, 11); await p.click('[data-opsedit="0"]'); await p.evaluate(() => document.querySelectorAll('details.ops-sec').forEach(d => { d.open = true; })); await p.locator('[data-path="ops.rows.finance.1.m.0"]').fill('');
  await p.locator('[data-path="ops.rows.finance.1.m.0"]').pressSequentially('100');
  await p.waitForTimeout(450);
  await p.reload(); await p.waitForFunction(() => window.__pricing); await p.waitForTimeout(150); await p.click('[data-act="resume"]');
  near('S the year in use survives a reload', await p.evaluate(() => window.__pricing.S.ops.year), before.y);
  near('S the edit in the old year stayed', +(await p.evaluate(() => window.__pricing.S.ops.rows.finance[1].m[0])), 100);
  await go12(p); ok('S both years listed', await p.locator('[data-opsyear]').count() === 2);
  ok('S no page errors', p.errs.length === 0, p.errs);
  await ctx.close();
}
/* ---- R. the client board, against a stand-in share server ---- */
{
  const store = new Map(); let seq = 0;
  const mock = async route => {
    const req = route.request(), url = new URL(req.url()), id = url.searchParams.get('id');
    const headers = { 'access-control-allow-origin': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.method() === 'POST') {
      if (id) { if (!store.has(id)) return route.fulfill({ status: 404, headers, body: '{}' }); store.set(id, req.postData()); return route.fulfill({ status: 200, headers, body: JSON.stringify({ id }) }); }
      const nid = 'b' + (++seq); store.set(nid, req.postData()); return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ id: nid }) });
    }
    if (!store.has(id)) return route.fulfill({ status: 404, headers, body: 'gone' });
    return route.fulfill({ status: 200, headers, body: store.get(id) });
  };
  const BOARD = BASE.replace(/\/$/, '') + '/pricing/clients/';
  const { ctx, p } = await newPage(); await ctx.route(/richlife-share/, mock);
  await p.goto(BOARD); await p.waitForSelector('[data-act="createBoard"]');
  const dec = p.locator('#rl-consent .rl-no'); if (await dec.isVisible().catch(() => false)) await dec.click();
  await axe(p, 'R start');
  await p.click('[data-act="createBoard"]'); await p.waitForSelector('#addForm');
  ok('R board gets its own link', /#p=b1\./.test(p.url()), p.url());
  await p.fill('#cName', 'דנה <b>כהן</b>'); await p.fill('#cBiz', 'סטודיו דנה'); await p.click('#addForm [type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('#list tbody tr').length === 1);
  ok('R a name with markup stays text', (await p.locator('#list tbody tr td.nm').innerHTML()).includes('&lt;b&gt;'));
  await p.fill('#cName', 'נועה'); await p.fill('#cBiz', ''); await p.click('[data-ctype="patur"]'); await p.click('#addForm [type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('#list tbody tr').length === 2);
  await axe(p, 'R board'); await p.screenshot({ path: OUT + '/r-board.png', fullPage: true });
  const clean2 = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok('R no page overflow', clean2 <= 0, clean2);
  const link = await p.locator('#list tbody tr').first().locator('a.btn').getAttribute('href');

  // the client opens her own link
  const cl = await newPage({ width: 400, height: 800 }); await cl.ctx.route(/richlife-share/, mock);
  await cl.p.goto(link); await cl.p.waitForFunction(() => window.__pricing); await cl.p.waitForTimeout(300);
  const d2 = cl.p.locator('#rl-consent .rl-no'); if (await d2.isVisible().catch(() => false)) await d2.click();
  ok('R client lands on the welcome step', (await cl.p.textContent('#stepTitle')).includes('לפני שמתחילים'));
  ok('R client sees her business', (await cl.p.inputValue('[data-path="biz.name"]')) === 'סטודיו דנה');
  ok('R no demo on a personal link', await cl.p.locator('[data-act="demo"]').count() === 0);
  await go(cl.p, 11);
  await type(cl.p, 'ops.rows.income.3.m.0', '11800');
  await cl.p.waitForTimeout(2200);
  await cl.ctx.close();

  // the board shows what she filled
  await p.reload(); await p.waitForSelector('#list tbody tr'); await p.waitForFunction(() => !document.querySelector('#list').innerText.includes('טוען'));
  const rows = await p.locator('#list').innerText();
  ok('R board shows the month filled', rows.includes('ינואר'), rows);
  ok('R board shows the profit', rows.includes('10,000'), rows);
  ok('R the second client is still empty', rows.includes('עוד לא מילאו'));

  // a new year on her link reaches the board, with the comparison
  const c2 = await newPage(); await c2.ctx.route(/richlife-share/, mock);
  await c2.p.goto(link); await c2.p.waitForFunction(() => window.__pricing); await c2.p.waitForTimeout(300);
  const d4 = c2.p.locator('#rl-consent .rl-no'); if (await d4.isVisible().catch(() => false)) await d4.click();
  await go(c2.p, 12); await c2.p.click('[data-act="closeYear"]'); await c2.p.click('[data-act="closeYear"]');
  await type(c2.p, 'ops.rows.income.3.m.0', '11800'); await c2.p.waitForTimeout(2200); await c2.ctx.close();
  await p.reload(); await p.waitForSelector('#list tbody tr'); await p.waitForFunction(() => !document.querySelector('#list').innerText.includes('טוען'));
  const rows2 = await p.locator('#list').innerText();
  ok('R board shows the comparison with last year', rows2.includes('0%'), rows2);
  ok('R board names the year', /ינואר 20\d\d/.test(rows2), rows2);
  ok('R the board reads the new year', rows2.includes('10,000'), rows2);
  // archive keeps the data
  await p.locator('[data-archive]').nth(1).click();
  await p.waitForFunction(() => document.querySelectorAll('#list tbody tr').length === 1);
  await p.click('[data-act="toggleArchive"]'); ok('R archive lists it', (await p.locator('.arch').innerText()).includes('נועה'));
  await p.click('[data-restore]'); await p.waitForFunction(() => document.querySelectorAll('#list tbody tr').length === 2);

  // existing link, wrong link, same link twice
  await p.click('#addForm details summary');
  await p.fill('#cLink', 'https://example.com/nope'); await p.click('[data-act="addExisting"]');
  ok('R a wrong link is refused', (await p.locator('#addOut').innerText()).includes('לא נראה'));
  await p.fill('#cLink', link); await p.click('[data-act="addExisting"]');
  ok('R the same link is not added twice', (await p.locator('#addOut').innerText()).includes('כבר בלוח'));

  // the plain address returns to the board on this device
  await p.goto(BOARD); await p.waitForSelector('#addForm');
  await p.waitForSelector('#list tbody tr');
  ok('R remembered board keeps the clients', await p.locator('#list tbody tr').count() === 2);
  ok('R no page errors', p.errs.length === 0, p.errs);
  const ph = await newPage({ width: 400, height: 800 }); await ph.ctx.route(/richlife-share/, mock);
  const bu = await p.inputValue('#boardLink'); await ph.p.goto(bu); await ph.p.waitForSelector('#list tbody tr');
  const d3 = ph.p.locator('#rl-consent .rl-no'); if (await d3.isVisible().catch(() => false)) await d3.click();
  const over = await ph.p.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok('R phone no overflow', over <= 0, over);
  await axe(ph.p, 'R phone'); await ph.ctx.close();
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log('FAILURES:\n' + failures.join('\n'));
process.exit(fail ? 1 : 0);
