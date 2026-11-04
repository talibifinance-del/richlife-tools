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

  const pr = opsState(); pr.ops.draw.prior = three(1836); const prr = E.ops(pr), base0 = E.ops(opsState());
  near('prior-year instalment leaves profit alone', prr.months[0].preTax, base0.months[0].preTax);
  near('prior-year instalment leaves tax alone', prr.annual.total, base0.annual.total);
  near('prior-year instalment leaves VAT alone', prr.vatOwed, base0.vatOwed);
  near('prior-year instalment lowers what is left', prr.months[0].left, base0.months[0].left - 1836);
  near('prior-year instalment leaves the account', prr.bank.expected, base0.bank.expected - 3 * 1836);

  near('cash net is in less out', prr.months[0].cashNet, prr.months[0].cashIn - prr.months[0].cashOut);
  near('cash net sums to the bank movement', prr.total.cashNet, prr.bank.expected - prr.bank.opening);
  near('prior-year instalment counts in cash', prr.months[0].cashOut - base0.months[0].cashOut, 1836);

  // years
  const yb = opsState(); yb.ops.year = 2026; yb.tax.pick = { k0: 1, miluim: '2', defer: true }; yb.ops.bank.end = Array(12).fill('');
  const yBefore = E.ops(yb), closed = E.closeYear(yb);
  near('a new year starts next year', closed.ops.year, 2027);
  near('opening is the computed balance', closed.ops.bank.opening, yBefore.bank.expected);
  near('the new year starts empty', E.ops(closed).k, 0);
  ok('row names stay', closed.ops.rows.income[0].name === 'a');
  near('the closed year is intact', E.yearOps(closed, 2026).total.preTax, yBefore.total.preTax);
  ok('the source state is untouched', yb.ops.year === 2026 && !yb.years);
  ok('a deferred point arrives next year', closed.tax.pick.deferredLast === true && closed.tax.pick.defer === false);
  near('a baby is one year old', +closed.tax.pick.k1, 1); ok('reserve duty is not carried', closed.tax.pick.miluim === '');
  near('next year points follow the ages', closed.tax.points, 2.75 + 4.5 + 1);
  const endSet = opsState(); endSet.ops.year = 2026; endSet.ops.bank.end = Array(12).fill(''); endSet.ops.bank.end[11] = '-500';
  near('a real December balance wins', E.closeYear(endSet).ops.bank.opening, -500);
  const sw = E.closeYear(yb); E.switchYear(sw, 2026);
  near('switching back brings the year', sw.ops.year, 2026); near('switching back brings its points', sw.tax.points, 2.75);
  ok('the other year waits', !!sw.years[2027] && !sw.years[2026]);
  E.switchYear(sw, 2027); near('and forward again', sw.ops.year, 2027);
  near('year list', E.yearList(sw).length, 2);
  ok('2026 has tables, 2027 does not yet', E.hasTables(2026) && !E.hasTables(2027));
  ok('a year without tables uses the latest', E.tablesFor(2027).year === 2026);
  const a2 = E.ops(opsState()), half = opsState({ upto: 1 });
  const cy = E.compareYears(E.ops(half), a2);
  near('comparison uses the same months only', cy.n, 1);
  near('comparison revenue flat when equal', cy.revenue[2], 0);

  // product types: the numbers from the approved picture
  const m12 = v => Array(12).fill(v);
  const gs0 = { biz: { type: 'murshe', wastePct: 0 }, materials: [{ id: 'k', name: 'לכל ילד', unit: 'יחידה', pack: 1, cost: 37 }],
    products: [{ id: 'g', type: 'group', size: 10, name: 'סדנה', lines: [{ mat: 'k', qty: 1 }], hours: 5, specific: 300, marginPct: 40, chosen: 150, mix: 100 }],
    labor: { net: 11000, pension: 800, fund: 400, hours: 150, monthly: [], hourly: [{ name: 'x', rate: 45, hours: 30, factor: 1.35 }] },
    overhead: { marketing: [{ m: m12(1200) }, { m: m12(500) }], admin: [{ m: m12(1800) }, { m: m12(120) }, { m: m12(350) }, { m: m12(400) }] }, tax: { points: 2.75, saving: 1000 } };
  const gR = E.compute(gs0), gv = E.groupView(gR, gs0, gs0.products[0]);
  near('group: people needed to cover costs', gv.minHeads, 12);
  const gRow = n => gv.rows.filter(r => r.n === n)[0];
  near('group: 5 people lose', gRow(5).left, -518, 1); near('group: 10 people lose', gRow(10).left, -104, 1); near('group: 15 people leave', gRow(15).left, 311, 1); near('group: 20 people leave', gRow(20).left, 725, 1);
  near('group: recommended per person at 10', gRow(10).recPerHead, 311, 1); near('group: recommended per person at 20', gRow(20).recPerHead, 202, 1);
  near('group: the event carries all the materials', gR.products[0].direct, 370);
  near('group: the chosen price is per person', gR.products[0].customer, 1500);
  near('group: size changes nothing but the count', E.expandProduct(gs0.products[0]).lines[0].qty, 10);
  ok('expanding twice changes nothing', E.expandProduct(E.expandProduct(gs0.products[0])).lines[0].qty === 10);
  const plainP = { id: 'a', name: 'x', lines: [{ mat: 'k', qty: 2 }], hours: 1, marginPct: 30 };
  ok('a product without a type passes through', E.expandProduct(plainP) === plainP);
  const svc = { id: 's', type: 'service', lines: [{ mat: 'k', qty: 1 }], hours: 1, marginPct: 30 };
  ok('a service is an ordinary product', E.expandProduct(svc) === svc);
  const dg = E.expandProduct({ id: 'd', type: 'digital', devHours: 40, devCost: 2000, expected: 100, marginPct: 50 });
  near('digital: hours spread over sales', dg.hours, 0.4); near('digital: cost spread over sales', dg.specific, 20);
  near('digital: no expected sales is safe', E.expandProduct({ type: 'digital', devHours: 40 }).hours, 0);
  const noneUp = E.groupView(gR, gs0, Object.assign({}, gs0.products[0], { chosen: 20 }));
  ok('group: a price below the cost per person never covers', noneUp.minHeads === null);

  // sales and payments
  near('month arithmetic over a year', +E.ymAdd('2026-11', 3).slice(0, 4), 2027); ok('month arithmetic', E.ymAdd('2026-11', 3) === '2027-02' && E.ymAdd('2026-01', -1) === '2025-12');
  const once = E.salePayments({ kind: 'once', total: 3000, start: '2026-11' });
  ok('one payment', once.length === 1 && once[0].ym === '2026-11' && once[0].amount === 3000);
  const eqp = E.salePayments({ kind: 'equal', total: 6600, n: 6, start: '2026-11' });
  ok('equal payments', eqp.length === 6 && eqp[0].amount === 1100 && eqp[5].ym === '2027-04');
  const lump = E.salePayments({ kind: 'equal', total: 6600, n: 6, lump: true, start: '2026-11' });
  ok('card installments paid at once', lump.length === 1 && lump[0].amount === 6600);
  const parts = E.salePayments({ kind: 'custom', parts: [{ ym: '2026-11', amount: 1000 }, { ym: '2026-12', amount: 1120 }, { ym: '', amount: 5 }, { ym: '2027-01', amount: '' }] });
  ok('varied payments, skipping empty rows', parts.length === 2 && parts[1].amount === 1120);
  const subO = E.salePayments({ kind: 'sub', monthly: 1500, start: '2026-11' }, '2027-10');
  ok('open retainer counts to the horizon and is marked', subO.length === 12 && subO[0].assumed === true);
  const subE = E.salePayments({ kind: 'sub', monthly: 1500, start: '2026-11', end: '2027-01' }, '2027-10');
  ok('retainer with an end', subE.length === 3 && !subE[0].assumed);
  const canc = E.salePayments({ kind: 'equal', total: 6000, n: 6, start: '2026-11', cancelled: '2027-01' });
  ok('a cancelled sale stops there', canc.length === 2);
  const fcs = { sales: [{ kind: 'equal', total: 6600, n: 6, start: '2026-11', client: 'א' }, { kind: 'custom', client: 'ב', parts: [{ ym: '2026-11', amount: 1000 }, { ym: '2026-12', amount: 1120 }, { ym: '2027-01', amount: 1120 }] }, { kind: 'sub', monthly: 1500, start: '2026-11', client: 'ג' }] };
  const fc = E.salesForecast(fcs, '2026-11', 3);
  near('forecast, first month', fc.months[0].total, 3600); near('forecast, second month', fc.months[1].total, 3720); near('forecast, third month', fc.months[2].total, 3720);
  near('forecast separates what is assumed', fc.months[0].assumed, 1500); near('forecast adds up', fc.total, 11040);
  ok('forecast ignores past months', E.salesForecast({ sales: [{ kind: 'once', total: 5, start: '2020-01' }] }, '2026-11', 3).total === 0);
  // marking what came in
  const rs = { sales: [
    { client: 'שירה', kind: 'equal', total: 6000, n: 6, start: '2026-08', marks: { '2026-08': { paid: true }, '2026-09': { got: 400 }, '2026-10': { to: '2026-12' } } },
    { client: 'טל', kind: 'equal', total: 3000, n: 3, start: '2026-10', auto: true, marks: { '2026-11': { failed: true } } },
    { client: 'רוני', kind: 'sub', monthly: 500, start: '2026-11', auto: true },
    { client: 'בוטל', kind: 'equal', total: 3000, n: 3, start: '2026-09', cancelled: '2026-10' }
  ] };
  const st0 = E.paymentStates(rs.sales[0], '2026-11', '2027-11');
  ok('a marked payment is in', st0[0].state === 'paid' && st0[0].left === 0);
  ok('a part payment leaves the rest late', st0[1].state === 'late' && st0[1].got === 400 && st0[1].left === 600);
  ok('a moved payment waits for its new month', st0[2].state === 'future' && st0[2].due === '2026-12' && st0[2].moved);
  ok('a payment this month is not late', st0[3].state === 'due');
  const st1 = E.paymentStates(rs.sales[1], '2026-11', '2027-11');
  ok('collected on its own counts as in', st1[0].state === 'paid' && st1[0].self);
  ok('collected on its own can fail', st1[1].state === 'due' && st1[1].failed && st1[1].got === 0);
  ok('collected on its own waits for its month', st1[2].state === 'future' && st1[2].got === 0);
  const rcv = E.receivables(rs, '2026-11');
  near('late total', rcv.lateTotal, 600 + 1000); ok('late counted by person', rcv.lateCount === 2 && rcv.lateClients === 2, rcv.lateNames);
  near('this month due', rcv.monthDue, 1000 + 1000 + 500); near('this month in', rcv.monthGot, 500); near('this month left', rcv.monthLeft, 2000);
  near('due, in and left agree', rcv.monthDue - rcv.monthGot - rcv.monthLeft, 0);
  near('coming months', rcv.nextLeft, 3000 + 1000 + 6000); near('assumed part', rcv.nextAssumed, 6000);
  ok('the chart runs from two months back to twelve ahead', rcv.months.length === 15 && rcv.months[0].ym === '2026-09' && rcv.months[14].ym === '2027-11');
  near('chart adds up, late', rcv.months.reduce((a, m) => a + m.late, 0), rcv.lateTotal);
  ok('a cancelled sale is never late after it stopped', !rcv.late.some(p => rs.sales[p.sale].client === 'בוטל' && p.due >= '2026-10'));
  const f2 = E.salesForecast(rs, '2026-12', 1, '2026-11');
  near('a moved payment lands in its new month', f2.months[0].left, 1000 + 1000 + 1000 + 500);
  const noMarks = { sales: [{ kind: 'equal', total: 600, n: 2, start: '2026-11' }] };
  near('no marks: left equals total', E.salesForecast(noMarks, '2026-11', 2, '2026-11').left, E.salesForecast(noMarks, '2026-11', 2).total);
  const cnt = E.salesCounts({ sales: [{ product: 'a', month: '2026-03' }, { product: 'a', month: '2026-03' }, { product: 'b', month: '2026-04' }, { product: 'a', month: '2025-03' }] }, 2026);
  ok('monthly counts', cnt.a.m[2] === 2 && cnt.a.total === 2 && cnt.b.m[3] === 1);
  const closedS = E.closeYear(Object.assign({}, opsState(), { sales: fcs.sales }));
  near('a new year keeps the sales', closedS.sales.length, 3);

  // a room by the hour is the same money as one amount, and is not multiplied by the people
  const ev0 = JSON.parse(JSON.stringify(gs0)); ev0.products[0].specific = ''; ev0.products[0].eventCosts = [{ name: 'חדר', price: 100, qty: 3 }];
  const evR = E.compute(ev0), evV = E.groupView(evR, ev0, ev0.products[0]);
  near('group: room by the hour', E.eventCost(ev0.products[0]), 300);
  near('group: empty amount counts once', E.eventCost({ eventCosts: [{ price: 40, qty: '' }] }), 40);
  near('group: event costs give the same answer', evV.minHeads, 12);
  near('group: event costs give the same left', evV.rows.filter(r => r.n === 20)[0].left, 725, 1);
  near('group: the room is not multiplied', evR.products[0].calc.specific, 300);
  near('group: more people, same room', E.groupView(evR, ev0, Object.assign({}, ev0.products[0], { size: 20 })).eventCost, 300);

  // what if
  const wiR = E.compute(example()), wi0 = E.whatIf(wiR, 0, -20);
  const lc = E.launchCase(wiR, 0, -20, 50, 30);
  near('launch: gain against no discount', lc.gain, 50 * wi0.newLeft - 30 * wi0.oldLeft);
  near('launch: sales needed', lc.breakEven, Math.ceil(30 * wi0.oldLeft / wi0.newLeft));
  ok('launch: at the break-even it pays', E.launchCase(wiR, 0, -20, lc.breakEven, 30).gain >= -1e-6);
  ok('launch: one less does not', E.launchCase(wiR, 0, -20, lc.breakEven - 1, 30).gain < 0);
  near('launch: hours', lc.hours, 100);
  near('launch: turnover', lc.turnover, 50 * wi0.net);
  const rc = E.raiseCase(wiR, 0, 10);
  near('raise: losing exactly this many keeps the money', (rc.w.unitsNow - rc.canLose) * rc.w.newLeft, rc.w.unitsNow * rc.w.oldLeft, 0.01);
  near('raise: effect', rc.w.yearEffect, rc.w.unitsNow * rc.w.perSale);
  ok('raise: a discount has nothing to lose', E.raiseCase(wiR, 0, -10).canLose === 0);
  const mc = E.midYearCase(wiR, 0, 10, 6);
  near('mid year: half the year by average', mc.unitsLeft, wiR.goals[0].unitsYear / 2); ok('mid year: no plan yet', mc.usePlan === false);
  near('mid year: effect on what is left', mc.effect, mc.fullYear / 2);
  const planned = example(); planned.products[0].plan = [10, 10, 10, 10, 10, 10, 5, 5, 5, 5, 5, 5];
  const pmc = E.midYearCase(E.compute(planned), 0, 10, 6);
  near('mid year: by the plan', pmc.unitsLeft, 30); ok('mid year: says it used the plan', pmc.usePlan === true);
  near('mid year: December only', E.midYearCase(E.compute(planned), 0, 10, 11).unitsLeft, 5);

  // saving to move the business forward counts like any money wanted after tax
  const gr = example(); gr.labor.growth = 2000; const gsv = example(); gsv.tax.saving = 2000;
  near('growth raises the target', E.compute(gr).targetNet, 14000);
  near('growth needs the same profit as a saving', E.compute(gr).preTax, E.compute(gsv).preTax);
  ok('growth raises the sales target', E.compute(gr).annual.revenue > E.compute(example()).annual.revenue);
  const both = example(); both.labor.growth = 1000; both.tax.saving = 500;
  near('growth and a saving add up', E.compute(both).targetNet, 13500);

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

/* what will be in the bank */
{
  const blank = extra => Object.assign({ biz: { type: 'murshe', vatPct: 18 }, labor: {}, overhead: { marketing: [], admin: [] }, tax: { points: 0 }, materials: [], products: [], sales: [], forecast: { today: 10000, todayAt: '2026-11-01', newSales: '', fixed: 4000, draw: 8000, tax: 1000, items: [] } }, extra || {});
  // the same shape the tool saves
  const mk = (extra, fc) => { const s = blank(extra); Object.assign(s.forecast, fc || {}); s.ops = s.ops || { year: 2026, rows: {}, draw: {}, paid: {}, bank: { opening: '', end: [] } }; s.years = s.years || {}; return s; };
  const b = (extra, fc) => E.bankForecast(mk(extra, fc), '2026-11');

  // no money in, three fixed amounts out; typed on the 1st, so the whole month still moves it
  let f = b();
  ok('forecast: 13 months', f.months.length === 13);
  ok('forecast: starts this month', f.months[0].ym === '2026-11' && f.months[12].ym === '2027-11');
  near('forecast: first month', f.months[0].balance, 10000 - 13000);
  near('forecast: second month', f.months[1].balance, 10000 - 26000);
  ok('forecast: the first minus is found', f.firstNeg === '2026-11');
  ok('forecast: lowest is the last', f.low.ym === '2027-11');
  near('forecast: a year on', f.end, 10000 - 13 * 13000);

  // typed mid month: only the part of the month that is left moves it
  f = E.bankForecast(mk({}, { todayAt: '2026-11-16' }), '2026-11');
  near('forecast: half a month left', f.months[0].outTotal, 13000 * 15 / 30);
  near('forecast: the next month is whole', f.months[1].outTotal, 13000);

  // a sale: what has come in is already in the balance
  const sale = { client: 'א', kind: 'equal', total: 3000, n: 3, start: '2026-11', month: '2026-11', marks: { '2026-11': { paid: true } } };
  f = b({ biz: { type: 'patur' }, sales: [sale] });
  ok('forecast: a marked payment is not counted twice', f.months[0].sold === 0);
  near('forecast: next payments count', f.months[1].sold, 1000);
  near('forecast: and the last', f.months[2].sold, 1000);
  ok('forecast: nothing after the sale ends', f.months[3].sold === 0);

  // a balance from the end of last month: this month's money is not in it yet
  const fill = { year: 2026, rows: { income: [{ m: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1000, 0, 0] }] }, draw: {}, paid: {}, bank: { opening: '', end: ['', '', '', '', '', '', '', '', '', 7000, '', ''] } };
  f = E.bankForecast(mk({ biz: { type: 'patur' }, sales: [sale], ops: fill }, { today: '' }), '2026-11');
  ok('forecast: balance comes from the fill', f.has && f.base.source === 'end' && f.base.amount === 7000 && f.base.ym === '2026-10', f.base);
  near('forecast: a paid payment of this month still counts', f.months[0].sold, 1000);

  // a payment that is late is not assumed to arrive
  const lateSale = { client: 'ב', kind: 'once', total: 900, start: '2026-08', month: '2026-08' };
  f = b({ biz: { type: 'patur' }, sales: [lateSale] });
  ok('forecast: late money stays out', f.months.every(m => m.sold === 0));
  near('forecast: and is reported', f.late, 900);

  // new sales start next month, and the warning without them stays
  f = b({ biz: { type: 'patur' } }, { newSales: 20000 });
  ok('forecast: new sales not this month', f.months[0].fresh === 0);
  near('forecast: new sales from next month', f.months[1].fresh, 20000);
  ok('forecast: without new sales the money runs out', f.bareNeg === '2026-11');
  near('forecast: with them it grows', f.months[1].balance, 10000 - 13000 + 20000 - 13000);

  // a payment with an end, a one-off, and a payment already inside the fixed costs
  const items = [{ kind: 'until', name: 'מחשב', amount: 420, end: '2026-12' }, { kind: 'once', name: 'ביטוח', amount: 2400, ym: '2027-01' }, { kind: 'until', name: 'ייעוץ', amount: 800, end: '2026-12', inFixed: true }];
  f = b({ biz: { type: 'patur' } }, { items });
  near('forecast: payment while it runs', f.months[1].outTotal, 13420);
  near('forecast: inside fixed costs it adds nothing', f.months[1].fixed, 4000);
  near('forecast: after the end the fixed costs drop', f.months[2].fixed, 3200);
  near('forecast: and the payment stops, the one-off lands', f.months[2].outTotal, 3200 + 8000 + 1000 + 2400);
  near('forecast: one-off is once', f.months[3].outTotal, 12200);

  // VAT: out in odd months for the two before, on money in less money out
  const vatSale = { client: 'ג', kind: 'sub', monthly: 11800, start: '2026-11', end: '2027-02', month: '2026-11', auto: true };
  f = b({ sales: [vatSale] });
  ok('forecast: no VAT in an even month', f.months[1].vat === 0);
  near('forecast: January pays for Nov and Dec', f.months[2].vat, 3600);
  near('forecast: March pays for Jan and Feb', f.months[4].vat, 3600);
  near('forecast: May has nothing to pay', f.months[6].vat, 0);
  f = b({ biz: { type: 'patur' }, sales: [vatSale] });
  ok('forecast: exempt pays no VAT', f.months.every(m => m.vat === 0));

  // typed balance that went stale, and no balance at all
  f = E.bankForecast(mk({}, { todayAt: '2026-09-20' }), '2026-11');
  ok('forecast: an old balance is flagged', f.base.stale === true);
  f = E.bankForecast(mk({}, { today: '' }), '2026-11');
  ok('forecast: no balance says so', f.has === false && f.base === null);
  ok('forecast: a balance of zero counts', E.bankForecast(mk({}, { today: 0 }), '2026-11').has === true);

  // defaults come from the last three filled months, without one-offs and without prior-year invoices
  const m3 = (a, b_, c_) => [0, 0, 0, 0, 0, 0, 0, a, b_, c_, 0, 0];
  const ops3 = { year: 2026, rows: { income: [{ m: m3(5000, 5000, 5000) }], admin: [{ m: m3(1000, 2000, 3000), vat: false }, { m: m3(0, 9000, 0), oneOff: true, vat: false }] }, draw: { salary: m3(6000, 6000, 9000), prior: m3(500, 500, 500) }, paid: {}, bank: { opening: 1000, end: [] } };
  f = E.bankForecast(mk({ biz: { type: 'patur' }, ops: ops3 }, { today: '', fixed: '', draw: '', tax: '' }), '2026-11');
  near('forecast: fixed is the three month average', f.fixed, 2000);
  near('forecast: draw leaves out prior-year invoices', f.draw, 7000);
  near('forecast: prior-year invoices are reported', f.defaults.prior, 500);
  ok('forecast: a typed number wins', E.bankForecast(mk({ biz: { type: 'patur' }, ops: ops3 }, { fixed: 1500 }), '2026-11').fixed === 1500);
  ok('forecast: a typed zero wins', E.bankForecast(mk({ biz: { type: 'patur' }, ops: ops3 }, { fixed: 0 }), '2026-11').fixed === 0);

  // the forecast never writes to what it reads
  const st = mk({ sales: [sale] }), before = JSON.stringify(st);
  E.bankForecast(st, '2026-11');
  ok('forecast: reads only', JSON.stringify(st) === before);

  // never NaN on a half empty state
  let bad = 0;
  for (let n = 0; n < 500; n++) {
    const rnd = () => Math.random() < 0.4 ? '' : Math.round(Math.random() * 30000);
    const x = E.bankForecast(mk({ sales: Math.random() < 0.5 ? [sale, lateSale] : [] }, { today: rnd(), todayAt: Math.random() < 0.5 ? '2026-11-20' : '', newSales: rnd(), fixed: rnd(), draw: rnd(), tax: rnd(), items: Math.random() < 0.5 ? items : [] }), '2026-11');
    if (!x.months.every(m => isFinite(m.balance) && isFinite(m.outTotal) && m.outTotal >= 0)) bad++;
  }
  ok('forecast: fuzz clean', bad === 0, bad);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
