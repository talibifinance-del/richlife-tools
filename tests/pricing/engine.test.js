// node tests/pricing/engine.test.js   Exit code 0 = all pass.
const E = require('../../pricing/engine.js');
let pass = 0, fail = 0;
function near(name, got, want, eps = 0.01) {
  if (got != null && Math.abs(got - want) <= eps) pass++;
  else { fail++; console.log('FAIL', name, 'got', got, 'want', want); }
}
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : extra); } }

function months(v) { return Array(12).fill(v); }
function example() {
  return {
    biz: { type: 'murshe' },
    materials: [{ id: 'a', name: 'חומר', unit: 'יחידה', pack: 1, cost: 100 / 1.1 }],
    products: [{ id: 'p1', name: 'מוצר', lines: [{ mat: 'a', qty: 1 }], hours: 2, marginPct: 30, mix: 100 }],
    labor: { net: 12000, pension: 1000, fund: 500, hours: 160 },
    overhead: { marketing: [], admin: [{ name: 'קבועות', m: months(5000) }] },
    tax: { points: 2.75, saving: 0 }
  };
}

/* reference numbers: the worked example in the plan */
{
  const r = E.compute(example()), c = r.products[0].calc;
  near('preTax', r.preTax, 15186.22);
  near('social', r.tax.social, 1825.65);
  near('income', r.tax.income, 1360.57);
  near('net', r.tax.net, 12000);
  near('H', c.minPrice, 380.94);
  near('L', c.profit, 163.26);
  near('X', c.taxBase, 313.26);
  near('taxes', c.taxes, 83.18);
  near('P', c.preVat, 627.37);
  near('Q', c.withVat, 740.30);
  near('R', c.recommended, 750.29);
}
/* tax sheet reference points */
[[3000, 2.75, 2774.25], [9000, 2.75, 7938.98], [70000, 2.75, 40063.99], [100000, 0, 54398.49]].forEach(([p, pts, net]) => near('tax ' + p, E.tax(p, pts).net, net));
ok('no tax on zero income', E.tax(0, 2.75).total === 0 && E.tax(0, 2.75).net === 0);
ok('empty sheet is not 790', E.compute({}).tax.net === 0);
near('credits floor at 0', E.tax(5000, 20).income, 0);
{
  const at = E.tax(46690, 0), base = at.base;
  ok('national insurance stops at the ceiling', E.tax(90000, 0).ni === E.tax(120000, 0).ni, [E.tax(90000, 0).ni, E.tax(120000, 0).ni]);
  ok('base below preTax', base < 46690);
  const b = E.tax(200000, 0);
  ok('50% bracket is charged', b.incomeBefore > E.tax(100000, 0).incomeBefore + 40000);
}
/* the exact bracket boundary does not lose tax */
{
  const t = E.TABLES_2026, d = t.niDeductible / 100;
  const preTaxForBase = c => c + d * (Math.min(c, t.reducedThreshold) * t.niReduced / 100 + Math.max(0, Math.min(c, t.ceiling) - t.reducedThreshold) * t.niFull / 100);
  near('tax exactly on the 7,010 boundary', E.tax(preTaxForBase(7010), 0).incomeBefore, 701);
  near('tax exactly on the 10,060 boundary', E.tax(preTaxForBase(10060), 0).incomeBefore, 701 + 3050 * 0.14);
  near('tax exactly on the 60,130 boundary', E.tax(preTaxForBase(60130), 0).incomeBefore, 701 + 427 + 8940 * 0.2 + 6100 * 0.31 + 21590 * 0.35 + 13440 * 0.47);
}

/* conservation: one product uses all hours, no materials, 0 margin, 0 contingency => after tax leaves exactly the net asked */
[[12000, 2.75, 5000, 160], [8000, 2.25, 2000, 120], [30000, 2.75, 15000, 180], [70000, 4, 20000, 200]].forEach(([net, pts, oh, hrs]) => {
  const s = {
    biz: { type: 'murshe', contingencyPct: 0 }, materials: [],
    products: [{ id: 'p', name: 'x', lines: [], hours: hrs, marginPct: 0 }],
    labor: { net, pension: 1000, fund: 500, hours: hrs }, overhead: { admin: [{ m: months(oh) }] }, tax: { points: pts }
  };
  const r = E.compute(s), P = r.products[0].calc.preVat;
  const preTaxIncome = P - oh - 1500;
  near('conservation pre-tax ' + net, preTaxIncome, r.preTax, 0.02);
  near('conservation net ' + net, E.tax(preTaxIncome, pts).net, net, 0.02);
});

/* conservation: revenue - COGS - expenses - taxes = net asked (including savings) */
{
  const s = example(); s.tax.saving = 2000;
  s.labor.monthly = [{ gross: 8000, hours: 160 }]; s.labor.hourly = [{ rate: 60, hours: 40 }];
  s.overhead.marketing = [{ m: months(1500) }];
  s.products.push({ id: 'p2', name: 'ב', lines: [], hours: 1, marginPct: 40, mix: 30 }); s.products[0].mix = 70;
  const r = E.compute(s), a = r.annual;
  near('P&L closes', a.revenue - a.cogs - a.fund - a.pension - a.employees - a.admin - a.marketing - a.taxes, a.net, 0.05);
  near('net includes savings', a.net, (12000 + 2000) * 12, 0.05);
  near('mix sums', r.goals.reduce((x, g) => x + g.turnover, 0), a.revenue, 0.05);
}

/* chosen price: the default is the recommendation; typing the recommendation back changes nothing */
{
  const s = example(); const r0 = E.compute(s), p0 = r0.products[0];
  near('default net = P', p0.net, p0.calc.preVat, 1e-9);
  s.products[0].chosen = p0.calc.recommended;
  const r1 = E.compute(s);
  near('chosen round trip', r1.products[0].net, p0.calc.preVat, 1e-6);
  ok('status ok at the recommendation', r1.products[0].status === 'ok', r1.products[0].status);
  s.products[0].chosen = p0.calc.minPrice * 1.18 * 1.0135 * 1.2;
  ok('between min and rec', E.compute(s).products[0].status === 'below-rec');
  s.products[0].chosen = 100;
  ok('below min', E.compute(s).products[0].status === 'below-min');
  s.products[0].chosen = 800;
  near('chosen feeds price list and goals', E.compute(s).goals[0].price, 800 / 1.0135 / 1.18);
}
/* weighted margin: the example shown to Tali */
{
  const s = { biz: {}, materials: [{ id: 'a', pack: 1, cost: 10 / 1.1 }], labor: {}, overhead: {}, tax: {},
    products: [{ id: 'a1', lines: [], chosen: 118 * 1.0135, mix: 90 }, { id: 'b1', lines: [{ mat: 'a', qty: 8 }], chosen: 118 * 1.0135, mix: 10 }] };
  const r = E.compute(s);
  near('direct 80', r.products[1].direct, 80);
  near('weighted', r.grossMargin, (0.9 * 1 + 0.1 * 0.2), 1e-6);
  delete s.products[0].mix; delete s.products[1].mix;
  near('simple average without a mix', E.compute(s).grossMargin, 0.6, 1e-6);
  ok('usingMix flag', E.compute(s).usingMix === false);
}
/* exempt dealer: no VAT on the price */
{
  const s = example(); s.biz.type = 'patur';
  const c = E.compute(s).products[0].calc;
  near('patur Q = P', c.withVat, c.preVat, 1e-9);
  ok('patur over ceiling', E.compute(s).paturOver === true);
}
/* margin of 100% or more is capped and flagged, never silently zero */
{
  const s = example(); s.products[0].marginPct = 120;
  const c = E.compute(s).products[0].calc;
  ok('margin capped', c.marginCapped && c.marginPct === E.MAX_MARGIN && c.profit > 0);
}
/* two materials with the same name stay separate */
{
  const s = { materials: [{ id: 'x', name: 'בד', pack: 1, cost: 10 }, { id: 'y', name: 'בד', pack: 1, cost: 20 }] };
  near('same name by id', E.lineCost({ mat: 'y', qty: 1 }, s.materials, 0), 20);
}
/* pack quantity and wastage, like the helper table */
near('pack + wastage', E.lineCost({ mat: 'm', qty: 3 }, [{ id: 'm', pack: 12, cost: 240 }], 10), 3 / 12 * 264);

/* capacity */
{
  const r = E.compute(example());
  near('capacity', r.hoursNeededMonth, r.goals[0].unitsMonth * 2);
}

/* fuzz: 2,000 random inputs, nothing non-finite, no negative tax, net grows with income */
{
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = (...a) => a[Math.floor(rnd() * a.length)];
  const scan = (o, path, out) => {
    if (typeof o === 'number' && !isFinite(o)) out.push(path);
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) scan(o[k], path + '.' + k, out);
  };
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    const big = () => pick(0, '', null, undefined, 'abc', 1, 7703, 51910, 60130, rnd() * 100000, rnd() * 5000000);
    const s = {
      biz: { type: pick('murshe', 'patur'), vatPct: pick(undefined, 0, 18), feePct: pick(undefined, 0, 3), wastePct: pick(undefined, 0, 30), contingencyPct: pick(undefined, 0, 100) },
      materials: [{ id: 'a', pack: big(), cost: big() }],
      products: Array.from({ length: Math.floor(rnd() * 4) }, (_, k) => ({ id: 'p' + k, lines: [{ mat: 'a', qty: big() }], hours: pick(0, 1, rnd() * 400), specific: big(), marginPct: pick(0, 30, 99, 100, 150, ''), market: big(), chosen: pick(0, '', big()), mix: pick(0, 50, 100, ''), plan: [big()] })),
      labor: { net: big(), pension: big(), fund: big(), hours: pick(0, 1, 160, ''), monthly: [{ gross: big(), hours: big(), factor: pick('', 1.35, 0) }], hourly: [{ rate: big(), hours: big() }] },
      overhead: { marketing: [{ m: [big()] }], admin: [{ m: months(big()) }] },
      tax: { points: pick(0, 2.75, 30, ''), saving: big() }
    };
    const r = E.compute(s), out = [];
    scan(r, 'r', out);
    if (out.length) { bad++; if (bad < 4) console.log('non-finite', out.slice(0, 3)); }
    if (r.tax.income < 0 || r.tax.total < 0) { bad++; console.log('negative tax'); }
    const a = rnd() * 200000, b = a + rnd() * 50000, pts = rnd() * 8;
    if (E.tax(b, pts).net < E.tax(a, pts).net - 1e-6) { bad++; console.log('net fell', a, b, pts); }
  }
  ok('fuzz clean', bad === 0, bad);
}

/* ---------- ongoing management ---------- */
{
  near('BTL example: 12,000 a month is 1,288 a month', E.depositTax(12000, 0, 0, 0).social, 3864 / 3, 1);
  // Worked by hand: 10,000 income, 600 pension, 300 fund, 2.75 points.
  const d = E.depositTax(10000, 600, 300, 2.75);
  near('fund deduction', d.fundDed, 300); near('pension deduction is two thirds', d.penDed, 400); near('pension credit is a third at 35%', d.penCredit, 70);
  near('base after deposits and 52% of NI', d.base, 9032.31, 0.1); near('NI', d.ni, 514.87, 0.1); near('health', d.health, 317.54, 0.1);
  near('income tax', d.incomeTax, 248.62, 0.1);
  near('fund capped at 4.5%', E.depositTax(10000, 0, 1500, 0).fundDed, 450);
  near('fund capped at the yearly ceiling', E.depositTax(40000, 0, 5000, 0).fundDed, 13203 / 12);
  near('pension capped at the income ceiling', E.depositTax(40000, 12000, 0, 0).penDed, 19400 * 0.11);
  near('compulsory pension below half the wage', E.mandatoryPension(5000), 222.5);
  near('compulsory pension tops out near 1,170', E.mandatoryPension(50000) * 12, 14044, 2);

  const empty = () => ({ income: [], direct: [], marketing: [], admin: [], finance: [] });
  const three = v => [v, v, v, '', '', '', '', '', '', '', '', ''];
  const opsState = (extra = {}) => ({
    biz: { type: 'murshe', vatPct: 18 }, tax: { points: 2.75 },
    ops: Object.assign({
      rows: { income: [{ name: 'a', m: three(47200) }], direct: [{ name: 'b', m: three(4720) }], marketing: [{ name: 'c', m: three(5900) }], admin: [{ name: 'd', m: three(7080) }], finance: [{ name: 'e', m: three(500), vat: false }] },
      private: [], draw: { salary: three(12000), pension: three(1400), fund: three(600), savings: three(2000), loan: three(1000) }, paid: { income: three(1000), ni: three(2000), vat: three(1000) }, bank: { opening: 10000, end: [] }
    }, extra)
  });
  const a = E.ops(opsState());
  near('filled three months', a.k, 3);
  near('revenue without VAT', a.months[0].revenue, 40000); near('gross profit', a.months[0].gross, 36000); near('operating profit', a.months[0].operating, 25000); near('pre-tax profit', a.months[0].preTax, 24500);
  near('annual income is projected', a.annual.income, 480000);
  near('net plus tax is pre-tax', a.months[0].net + a.months[0].tax, a.months[0].preTax);
  near('left is net less what was drawn', a.months[0].left, a.months[0].net - 17000 + 0);
  near('total tax across the months equals the share of the year', a.total.tax, a.annual.total / 4, 1);
  near('due to date is a quarter of the year', a.due.income, a.annual.incomeTax / 4);
  near('VAT left to pay', a.vatOwed, 3 * (7200 - 720 - 900 - 1080) - 3000);
  near('bank: expected balance', a.bank.expected, 10000 + 3 * (47200 - 4720 - 5900 - 7080 - 500 - 17000 - 4000));

  const priv = opsState({ home: true, private: [{ name: 'חשמל', group: 'home', rec: 25, vat: false, m: three(1000) }] });
  const b = E.ops(priv);
  near('private expense leaves profit alone', b.months[0].preTax, a.months[0].preTax);
  near('private expense is recognised at its percent', b.annual.privateRecognised, 3000);
  ok('private expense lowers the tax', b.annual.total < a.annual.total);
  near('private group switched off does not count', E.ops(opsState({ home: false, private: priv.ops.private })).annual.total, a.annual.total);
  near('private expense leaves the bank alone', b.bank.expected, a.bank.expected);

  const pat = opsState(); pat.biz.type = 'patur'; const c = E.ops(pat);
  near('patur keeps the amounts', c.months[0].revenue, 47200); near('patur has no VAT', c.vatOwed, 0);

  const noAdmin = () => { const st = opsState(); st.ops.rows.admin = []; return E.ops(st).annual.bizRecognised; };
  const phone = v => { const st = opsState(); st.ops.rows.admin = [{ name: 't', rule: 'phone', vat: false, m: three(v) }]; return E.ops(st).annual.bizRecognised - noAdmin(); };
  near('phone above the cap: over 115 wins', phone(300), 185 * 12); near('phone below: half wins', phone(150), 75 * 12);
  const gift = { name: 'g', rule: 'gift', vat: false, people: 2, m: three(500) };
  const gs = opsState(); gs.ops.rows.admin = [gift]; near('gifts capped per person and not projected', E.ops(gs).annual.bizRecognised - noAdmin(), 480);
  const os = opsState(); os.ops.rows.admin = [{ name: 'x', vat: false, oneOff: true, m: ['900', '', '', '', '', '', '', '', '', '', '', ''] }]; near('one-off counted once', E.ops(os).annual.pnlCosts - E.ops(opsState({ rows: { ...opsState().ops.rows, admin: [] } })).annual.pnlCosts, 900);
  const up = opsState({ upto: 1 }); near('choosing a month limits the period', E.ops(up).annual.income, 480000); near('choosing a month sets k', E.ops(up).k, 1);
  near('nothing filled', E.ops({ biz: {}, tax: {}, ops: { rows: empty(), private: [], draw: {}, paid: {}, bank: {} } }).annual.total, 0);
  ok('saving per 1,000 is plausible', a.annual.savedPer1000 > 250 && a.annual.savedPer1000 < 700, a.annual.savedPer1000);

  const R = E.compute(example());
  const w = E.whatIf(R, 0, 10);
  near('what-if raises the customer price', w.customer, R.products[0].customer * 1.1);
  near('what-if at zero changes nothing', E.whatIf(R, 0, 0).perSale, 0);
  near('units needed keep the same money', w.unitsNeeded * w.newLeft, w.unitsNow * w.oldLeft, 0.01);
  ok('rank has the product', E.productRank(R).list.length === 1);

  near('credit points: woman, birth this year, 70 days of reserve duty', E.creditPoints({ k0: 1, miluim: '2' }), 7.25);
  near('credit points: defer moves one out', E.creditPoints({ k0: 1, defer: true }), 4.25);
  near('credit points: man with a 7 year old', E.creditPoints({ gender: 'man', k612: 1 }), 3.25);
  near('credit points: woman with a 7 year old', E.creditPoints({ k612: 1 }), 4.75);
  near('credit points: age table', E.creditPoints({ k1: 1, k2: 1, k3: 1, k45: 1, k18: 1 }), 2.75 + 4.5 + 4.5 + 3.5 + 2.5 + 0.5);
  const refund = opsState(); refund.ops.rows.income.push({ name: 'r', refund: true, m: three(2360) });
  const rr = E.ops(refund);
  near('a refund lowers revenue', rr.months[0].revenue, 38000); near('a refund lowers cash in', rr.months[0].cashIn, 44840); near('a refund lowers VAT', rr.months[0].vatOut, 7200 - 360); near('a refund lowers the projected income', rr.annual.income, 456000);
  const matS = opsState(); matS.ops.otherIncome = 42000; const mat = E.ops(matS), noMat = E.ops(opsState());
  ok('maternity pay raises income tax', mat.annual.incomeTax > noMat.annual.incomeTax);
  near('maternity pay leaves NI alone', mat.annual.ni, noMat.annual.ni);
  near('maternity pay stays out of the business tax line', mat.months[0].tax, noMat.months[0].tax);
  near('maternity pay stays out of the profit', mat.total.net, noMat.total.net);
  const wh = opsState(); wh.ops.otherIncome = 42000; wh.ops.otherWithheld = 3000; const wr = E.ops(wh);
  near('withheld tax comes off what is left', wr.annual.incomeTaxLeft, mat.annual.incomeTax - 3000);
  const low = E.ops({ biz: { type: 'patur' }, tax: { points: 7.25 }, ops: { rows: { income: [{ m: three(10000) }] }, private: [], draw: {}, paid: {}, bank: {} } });
  ok('unused credits are reported', low.annual.unusedCredits > 0 && low.annual.incomeTax === 0, low.annual.unusedCredits);

  let badOps = 0;
  for (let n = 0; n < 1000; n++) {
    const r = () => Math.random() < 0.3 ? '' : Math.round(Math.random() * 50000);
    const arr = () => Array.from({ length: 12 }, r);
    const st = { biz: { type: Math.random() < 0.3 ? 'patur' : 'murshe' }, tax: { points: Math.random() * 5 }, ops: { home: true, rows: { income: [{ m: arr() }], direct: [{ m: arr() }], marketing: [{ m: arr() }], admin: [{ m: arr(), rule: 'phone' }, { m: arr(), rule: 'gift', people: 3 }], finance: [{ m: arr(), vat: false }] }, private: [{ group: 'home', rec: 25, m: arr() }], draw: { salary: arr(), pension: arr(), fund: arr(), savings: arr(), loan: arr() }, paid: { income: arr(), ni: arr(), vat: arr() }, bank: { opening: r(), end: arr() } } };
    const x = E.ops(st), f = v => typeof v === 'number' && isFinite(v);
    if (![x.annual.total, x.total.net, x.total.left, x.bank.expected, x.annual.advancePct].every(f) || x.annual.total < 0) badOps++;
    if (Math.abs(x.total.net + x.total.tax - x.total.preTax) > 0.01) badOps++;
  }
  ok('ops fuzz clean', badOps === 0, badOps);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
