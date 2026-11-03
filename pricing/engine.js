/* RichLife pricing engine: pure calculations, no DOM. Runs in the browser (window.PricingEngine) and in node (module.exports).
   Monthly figures unless a name says annual. Rates are fractions inside the engine; percentages live in the state. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PricingEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Verified 2.11.26: kolzchut.org.il (income tax), btl.gov.il (self-employed, from 1.1.26). Update yearly. */
  var TABLES_2026 = {
    year: 2026,
    brackets: [
      { to: 7010, rate: 10 }, { to: 10060, rate: 14 }, { to: 19000, rate: 20 }, { to: 25100, rate: 31 },
      { to: 46690, rate: 35 }, { to: 60130, rate: 47 }, { to: null, rate: 50 }
    ],
    pointValue: 242,
    niReduced: 4.47, niFull: 12.83,
    healthReduced: 3.23, healthFull: 5.17,
    reducedThreshold: 7703, ceiling: 51910,
    niDeductible: 52
  };
  var TABLES_BY_YEAR = { 2026: TABLES_2026 };
  function hasTables(year) { return !!TABLES_BY_YEAR[year]; }
  function tablesFor(year) {
    if (TABLES_BY_YEAR[year]) return TABLES_BY_YEAR[year];
    var ys = Object.keys(TABLES_BY_YEAR).map(Number).sort(); return TABLES_BY_YEAR[ys[ys.length - 1]];
  }
  var PATUR_CEILING_2026 = 122833;
  var MAX_MARGIN = 95;

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v == null) return 0;
    var n = parseFloat(String(v).replace(/[,\s₪%]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function pos(v) { return Math.max(0, num(v)); }
  function sum(arr, fn) { return (arr || []).reduce(function (a, x) { return a + (fn ? fn(x) : num(x)); }, 0); }
  function safeDiv(a, b) { return b ? a / b : 0; }

  /* ---------- step 1-2: materials and cost of sale ---------- */
  function materialUnitPrice(m, wastePct) { return pos(m && m.cost) * (1 + pos(wastePct) / 100); }

  function lineCost(line, materials, wastePct) {
    var m = (materials || []).filter(function (x) { return x.id === line.mat; })[0];
    if (!m || !pos(m.pack)) return 0;
    return pos(line.qty) / pos(m.pack) * materialUnitPrice(m, wastePct);
  }
  function productDirect(p, materials, wastePct) {
    return sum(p.lines, function (l) { return lineCost(l, materials, wastePct); });
  }

  /* ---------- step 3: labor ---------- */
  function labor(l) {
    l = l || {};
    var net = pos(l.net), pension = pos(l.pension), fund = pos(l.fund), ownerHours = pos(l.hours);
    var ownerCost = net + pension + fund;
    var monthly = (l.monthly || []).map(function (e) {
      var factor = e.factor === '' || e.factor == null ? 1.35 : pos(e.factor);
      return { gross: pos(e.gross), cost: pos(e.gross) * factor, hours: pos(e.hours) };
    });
    var hourly = (l.hourly || []).map(function (e) {
      var factor = e.factor === '' || e.factor == null ? 1.35 : pos(e.factor);
      var gross = pos(e.rate) * pos(e.hours);
      return { gross: gross, cost: gross * factor, hours: pos(e.hours) };
    });
    var monthlyCost = sum(monthly, function (e) { return e.cost; }), monthlyHours = sum(monthly, function (e) { return e.hours; });
    var hourlyCost = sum(hourly, function (e) { return e.cost; }), hourlyHours = sum(hourly, function (e) { return e.hours; });
    var totalCost = ownerCost + monthlyCost + hourlyCost, totalHours = ownerHours + monthlyHours + hourlyHours;
    return {
      net: net, pension: pension, fund: fund, ownerCost: ownerCost, ownerHours: ownerHours,
      monthly: monthly, hourly: hourly, monthlyCost: monthlyCost, monthlyHours: monthlyHours, hourlyCost: hourlyCost, hourlyHours: hourlyHours,
      employeesCost: monthlyCost + hourlyCost, totalCost: totalCost, totalHours: totalHours,
      costPerHour: safeDiv(totalCost, totalHours), netPerHour: safeDiv(net, ownerHours)
    };
  }

  /* ---------- step 4: overhead ---------- */
  function rowsAnnual(rows) { return sum(rows, function (r) { return sum(r.m); }); }
  function overhead(o, totalHours) {
    o = o || {};
    var marketing = rowsAnnual(o.marketing), admin = rowsAnnual(o.admin), annual = marketing + admin, monthly = annual / 12;
    return { marketingAnnual: marketing, adminAnnual: admin, annual: annual, monthly: monthly, perHour: safeDiv(monthly, totalHours) };
  }

  /* ---------- step 5: tax ---------- */
  function incomeTaxBeforeCredits(taxable, t) {
    var tax = 0, prev = 0;
    t.brackets.forEach(function (b) {
      var top = b.to == null ? Infinity : b.to;
      tax += Math.max(0, Math.min(taxable, top) - prev) * b.rate / 100;
      prev = top;
    });
    return tax;
  }
  function niOn(c, t) {
    return Math.min(c, t.reducedThreshold) * t.niReduced / 100 + Math.max(0, Math.min(c, t.ceiling) - t.reducedThreshold) * t.niFull / 100;
  }
  function healthOn(c, t) {
    return Math.min(c, t.reducedThreshold) * t.healthReduced / 100 + Math.max(0, Math.min(c, t.ceiling) - t.reducedThreshold) * t.healthFull / 100;
  }
  /* 52% of national insurance is deductible, so the income it is charged on solves c + 0.52 * NI(c) = preTax. */
  function niBase(preTax, t) {
    var d = t.niDeductible / 100, nr = t.niReduced / 100, nf = t.niFull / 100, T = t.reducedThreshold;
    if (preTax <= 0) return 0;
    if (preTax <= T * (1 + d * nr)) return preTax / (1 + d * nr);
    var niCeil = niOn(t.ceiling, t);
    if (preTax <= t.ceiling + d * niCeil) return (preTax + d * T * (nf - nr)) / (1 + d * nf);
    return preTax - d * niCeil;
  }
  function tax(preTax, points, tables) {
    var t = tables || TABLES_2026, p = Math.max(0, num(preTax));
    var base = niBase(p, t);
    var ni = niOn(base, t), health = healthOn(base, t);
    var before = incomeTaxBeforeCredits(base, t);
    var credit = pos(points) * t.pointValue;
    var income = Math.max(0, before - credit);
    var social = ni + health;
    return {
      preTax: p, base: base, ni: ni, health: health, social: social, incomeBefore: before, credit: credit, income: income,
      total: social + income, net: p - social - income,
      socialRate: safeDiv(social, p), incomeRate: safeDiv(income, p), totalRate: safeDiv(social + income, p)
    };
  }
  function solvePreTax(targetNet, points, tables) {
    var target = num(targetNet);
    if (target <= 0) return 0;
    var lo = 0, hi = Math.max(target * 2, 1000);
    while (tax(hi, points, tables).net < target) hi *= 2;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (tax(mid, points, tables).net < target) lo = mid; else hi = mid;
    }
    return hi;
  }

  /* ---------- step 6: price one product ---------- */
  function priceProduct(input) {
    var B = pos(input.direct), C = pos(input.hours), F = pos(input.specific);
    var D = pos(input.overheadPerHour) * C, E = pos(input.laborPerHour) * C;
    var marginPct = Math.min(pos(input.marginPct), MAX_MARGIN);
    var G = pos(input.contingencyPct) / 100 * (B + D + E + F);
    var H = B + D + E + F + G;
    var K = 1 - marginPct / 100;
    var L = H / K - H;
    var M = H + L;
    var X = L + C * pos(input.netPerHour);
    var nRate = pos(input.socialRate), iRate = pos(input.incomeRate), rate = Math.min(nRate + iRate, 0.95);
    var taxes = X / (1 - rate) - X;
    var N = safeDiv(taxes * nRate, nRate + iRate), O = taxes - N;
    var P = M + taxes;
    var vat = pos(input.vatPct) / 100, fee = pos(input.feePct) / 100;
    var Q = P * (1 + vat), R = Q * (1 + fee);
    return {
      direct: B, hours: C, overheadCost: D, laborCost: E, specific: F, contingency: G, minPrice: H,
      marginPct: marginPct, marginCapped: pos(input.marginPct) > MAX_MARGIN, profit: L, beforeTax: M, taxBase: X,
      ni: N, income: O, taxes: taxes, preVat: P, withVat: Q, recommended: R
    };
  }

  /* The price the client pays, walked back through card fee and VAT, so it compares directly with preVat. */
  function chosenNet(chosen, vatPct, feePct) { return pos(chosen) / (1 + pos(feePct) / 100) / (1 + pos(vatPct) / 100); }

  /* ---------- product types ----------
     A group is priced as one whole event, a digital product spreads what it took to make over the expected sales.
     After this step everything downstream is the ordinary product model. A product without a type passes through untouched. */
  /* What a group costs whoever comes: a room by the hour, shared refreshments. No wastage here, a room is not wasted. */
  function eventCost(p) { return sum(p.eventCosts, function (e) { return pos(e.price) * (e.qty === '' || e.qty == null ? 1 : pos(e.qty)); }); }
  function expandProduct(p) {
    if (!p || (p.type !== 'group' && p.type !== 'digital')) return p;
    var q = {}; for (var k in p) q[k] = p[k];
    if (p.type === 'group') {
      var size = pos(p.size) || 1;
      q.lines = (p.lines || []).map(function (l) { return { mat: l.mat, qty: pos(l.qty) * size }; });
      q.chosen = pos(p.chosen) > 0 ? pos(p.chosen) * size : '';
      q.market = pos(p.market) > 0 ? pos(p.market) * size : '';
      q.specific = pos(p.specific) + eventCost(p);
    } else {
      var expected = pos(p.expected);
      q.lines = [];
      q.hours = expected > 0 ? pos(p.devHours) / expected : 0;
      q.specific = expected > 0 ? pos(p.devCost) / expected : 0;
    }
    q.type = 'product';
    return q;
  }
  function expandState(state) {
    var q = {}; for (var k in state) q[k] = state[k];
    q.products = (state.products || []).map(expandProduct);
    return q;
  }
  /* What a group looks like at different sizes: the price per person, and how many people cover the costs. */
  function groupView(R, state, raw) {
    var set = R.settings, perHead = productDirect(raw, state.materials, set.wastePct), size = pos(raw.size) || 1;
    var calc = function (n) {
      return priceProduct({
        direct: perHead * n, hours: raw.hours, specific: pos(raw.specific) + eventCost(raw), marginPct: raw.marginPct,
        overheadPerHour: R.overhead.perHour, laborPerHour: R.labor.costPerHour, netPerHour: R.labor.netPerHour,
        contingencyPct: set.contingencyPct, socialRate: R.tax.socialRate, incomeRate: R.tax.incomeRate, vatPct: set.vatPct, feePct: set.feePct
      });
    };
    var recHere = calc(size).recommended / size, hasChosen = pos(raw.chosen) > 0, price = hasChosen ? pos(raw.chosen) : recHere;
    var netHead = chosenNet(price, set.vatPct, set.feePct);
    var sizes = [5, 10, 15, 20]; if (sizes.indexOf(size) < 0) sizes.push(size);
    sizes.sort(function (a, b) { return a - b; });
    var rows = sizes.map(function (n) {
      var c = calc(n);
      return { n: n, recPerHead: c.recommended / n, recTotal: c.recommended, min: c.minPrice, net: netHead * n, left: netHead * n - c.minPrice };
    });
    var minHeads = null;
    for (var n = 1; n <= 1000; n++) if (netHead * n >= calc(n).minPrice) { minHeads = n; break; }
    return { size: size, perHead: perHead, eventCost: pos(raw.specific) + eventCost(raw), price: price, hasChosen: hasChosen, recHere: recHere, minHeads: minHeads, rows: rows };
  }

  /* ---------- sales and how they get paid ----------
     Months are 'YYYY-MM' strings, so they sort and compare as text. Amounts are what the client pays, as in the bank. */
  function ymAdd(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1);
  }
  function salePayments(sale, horizon) {
    var out = [], kind = sale.kind || 'once', start = sale.start || sale.month, i;
    if (!start && kind !== 'custom') return out;
    if (kind === 'once') { if (pos(sale.total) > 0) out.push({ ym: start, amount: pos(sale.total) }); }
    else if (kind === 'equal') {
      var n = Math.max(1, Math.floor(pos(sale.n)) || 1);
      if (sale.lump) out.push({ ym: start, amount: pos(sale.total) });
      else for (i = 0; i < n; i++) out.push({ ym: ymAdd(start, i), amount: pos(sale.total) / n });
    } else if (kind === 'custom') {
      (sale.parts || []).forEach(function (p) { if (p.ym && pos(p.amount) > 0) out.push({ ym: p.ym, amount: pos(p.amount) }); });
    } else if (kind === 'sub') {
      /* No end date: counted up to the horizon, and marked as an assumption. */
      var end = sale.end || horizon, open = !sale.end, ym = start, guard = 0;
      while (ym <= end && guard++ < 600) { out.push({ ym: ym, amount: pos(sale.monthly), assumed: open }); ym = ymAdd(ym, 1); }
    }
    if (sale.cancelled) out = out.filter(function (p) { return p.ym < sale.cancelled; });
    return out;
  }
  function saleTotal(sale, horizon) { return sum(salePayments(sale, horizon), function (p) { return p.amount; }); }
  function salesForecast(state, startYm, count) {
    var last = ymAdd(startYm, count - 1), months = [], i, map = {};
    for (i = 0; i < count; i++) { var ym = ymAdd(startYm, i); map[ym] = { ym: ym, total: 0, sure: 0, assumed: 0, items: [] }; months.push(map[ym]); }
    ((state && state.sales) || []).forEach(function (s) {
      salePayments(s, last).forEach(function (p) {
        var m = map[p.ym]; if (!m) return;
        m.total += p.amount; if (p.assumed) m.assumed += p.amount; else m.sure += p.amount;
        m.items.push({ name: s.client || s.label || '', amount: p.amount, assumed: !!p.assumed });
      });
    });
    return { months: months, total: sum(months, function (m) { return m.total; }), assumed: sum(months, function (m) { return m.assumed; }) };
  }
  /* How many of each product were sold in each month of a year. A group sold is one whole event. */
  function salesCounts(state, year) {
    var rows = {}, y = String(year);
    ((state && state.sales) || []).forEach(function (s) {
      if (!s.month || s.month.slice(0, 4) !== y || s.cancelled === s.month) return;
      var key = s.product || '_other';
      rows[key] = rows[key] || { key: key, m: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 0 };
      rows[key].m[+s.month.slice(5, 7) - 1]++; rows[key].total++;
    });
    return rows;
  }

  /* ---------- whole model ---------- */
  function compute(state) {
    var s = state || {}, biz = s.biz || {}, t = (s.tax && s.tax.tables) || TABLES_2026;
    var patur = biz.type === 'patur';
    var vatPct = patur ? 0 : (biz.vatPct == null ? 18 : pos(biz.vatPct));
    var feePct = biz.feePct == null ? 1.35 : pos(biz.feePct);
    var wastePct = biz.wastePct == null ? 10 : pos(biz.wastePct);
    var contingencyPct = biz.contingencyPct == null ? 15 : pos(biz.contingencyPct);

    var lab = labor(s.labor);
    var oh = overhead(s.overhead, lab.totalHours);

    var points = (s.tax && s.tax.points), saving = pos(s.tax && s.tax.saving);
    var targetNet = lab.net + saving;
    var preTax = solvePreTax(targetNet, points, t);
    var taxRes = tax(preTax, points, t);

    var products = (s.products || []).map(expandProduct).map(function (p) {
      var direct = productDirect(p, s.materials, wastePct);
      var pr = priceProduct({
        direct: direct, hours: p.hours, specific: p.specific, marginPct: p.marginPct,
        overheadPerHour: oh.perHour, laborPerHour: lab.costPerHour, netPerHour: lab.netPerHour,
        contingencyPct: contingencyPct, socialRate: taxRes.socialRate, incomeRate: taxRes.incomeRate, vatPct: vatPct, feePct: feePct
      });
      var hasChosen = pos(p.chosen) > 0;
      var net = hasChosen ? chosenNet(p.chosen, vatPct, feePct) : pr.preVat;
      var customer = hasChosen ? pos(p.chosen) : pr.recommended;
      var gross = net - direct;
      var status = !(net > 0) ? 'empty' : (net < pr.minPrice - 0.005 ? 'below-min' : (net < pr.preVat - 0.005 ? 'below-rec' : 'ok'));
      return {
        id: p.id, name: p.name || '', calc: pr, hasChosen: hasChosen, net: net, customer: customer, status: status,
        direct: direct, grossProfit: gross, grossPct: net > 0 ? gross / net : 0, gapFromRec: net - pr.preVat,
        market: pos(p.market), mixPct: pos(p.mix), hours: pos(p.hours)
      };
    });

    /* step 7: gross margin, weighted by the planned sales mix; a simple average until a mix exists */
    var priced = products.filter(function (p) { return p.net > 0; });
    var mixSum = sum(priced, function (p) { return p.mixPct; });
    var usingMix = mixSum > 0;
    var grossMargin = usingMix
      ? sum(priced, function (p) { return p.mixPct * p.grossPct; }) / mixSum
      : safeDiv(sum(priced, function (p) { return p.grossPct; }), priced.length);
    var allMixSum = sum(products, function (p) { return p.mixPct; });

    /* step 8: reverse engineering, annual */
    var annual = {
      net: taxRes.net * 12, taxes: taxRes.total * 12, preTax: preTax * 12,
      fund: lab.fund * 12, pension: lab.pension * 12, employees: lab.employeesCost * 12,
      admin: oh.adminAnnual, marketing: oh.marketingAnnual
    };
    annual.grossProfit = annual.preTax + annual.fund + annual.pension + annual.employees + annual.admin + annual.marketing;
    annual.revenue = grossMargin > 0 ? annual.grossProfit / grossMargin : null;
    annual.cogs = annual.revenue == null ? null : annual.revenue * (1 - grossMargin);
    var fixedAnnual = annual.fund + annual.pension + annual.employees + annual.admin + annual.marketing + lab.net * 12;
    var breakEven = grossMargin > 0 ? fixedAnnual / grossMargin : null;

    /* step 9: goals and plan */
    var goals = products.map(function (p) {
      var share = allMixSum > 0 ? p.mixPct / allMixSum : (products.length === 1 ? 1 : 0);
      var turnover = annual.revenue == null ? 0 : annual.revenue * share;
      var unitsYear = p.net > 0 ? turnover / p.net : 0;
      var src = (s.products || []).filter(function (x) { return x.id === p.id; })[0] || {};
      var plan = (src.plan || []).map(pos);
      while (plan.length < 12) plan.push(0);
      var planned = sum(plan);
      return {
        id: p.id, name: p.name, sharePct: share * 100, turnover: turnover, price: p.net,
        unitsYear: unitsYear, unitsMonth: unitsYear / 12, plan: plan, planned: planned, gap: planned - unitsYear,
        hours: p.hours
      };
    });
    var hoursNeededMonth = sum(goals, function (g) { return g.unitsMonth * g.hours; });
    var plannedByMonth = [];
    for (var mi = 0; mi < 12; mi++) {
      (function (i) {
        plannedByMonth.push({
          units: sum(goals, function (g) { return g.plan[i]; }),
          revenue: sum(goals, function (g) { return g.plan[i] * g.price; }),
          hours: sum(goals, function (g) { return g.plan[i] * g.hours; })
        });
      })(mi);
    }
    var plannedRevenue = sum(plannedByMonth, function (m) { return m.revenue; });

    return {
      settings: { patur: patur, vatPct: vatPct, feePct: feePct, wastePct: wastePct, contingencyPct: contingencyPct, tables: t },
      labor: lab, overhead: oh, targetNet: targetNet, saving: saving, preTax: preTax, tax: taxRes,
      products: products, grossMargin: grossMargin, usingMix: usingMix, mixSum: allMixSum,
      annual: annual, fixedAnnual: fixedAnnual, breakEven: breakEven,
      goals: goals, hoursNeededMonth: hoursNeededMonth, hoursAvailableMonth: lab.totalHours,
      plannedByMonth: plannedByMonth, plannedRevenue: plannedRevenue,
      paturOver: patur && annual.revenue != null && annual.revenue > PATUR_CEILING_2026
    };
  }

  /* ---------- ongoing management: P&L, cash and the tax estimate ---------- */
  /* 2026. Booklet: phone, gifts, pension income ceiling. More Gemel 2026: study fund. TheMarker 2026: compulsory pension. Update yearly with TABLES_2026. */
  var OPS_2026 = {
    phoneCap: 115, giftCap: 240, penIncomeMonth: 19400, penDedPct: 11, penCreditPct: 5.5, creditRate: 35,
    fundPct: 4.5, fundCapYear: 13203, avgWage: 13769, mandLowPct: 4.45, mandHighPct: 12.55, donationRate: 35
  };

  function mandatoryPension(incomeMonth) {
    var o = OPS_2026, z = pos(incomeMonth), half = o.avgWage / 2;
    return (Math.min(z, half) * o.mandLowPct + Math.max(0, Math.min(z, o.avgWage) - half) * o.mandHighPct) / 100;
  }

  /* Monthly. The deductible deposits come off the income before national insurance and income tax; a third of the pension earns a credit instead. */
  function depositTax(income, pension, fund, points, tables, extraCredit, otherIncome) {
    var o = OPS_2026, t = tables || TABLES_2026, z = Math.max(0, num(income)), pen = pos(pension), fnd = pos(fund);
    var penBase = Math.min(z, o.penIncomeMonth);
    var fundDed = Math.min(fnd, z * o.fundPct / 100, o.fundCapYear / 12);
    var penDed = Math.min(pen * 2 / 3, penBase * o.penDedPct / 100);
    var penCredit = Math.min(pen / 3, penBase * o.penCreditPct / 100) * o.creditRate / 100;
    var base = niBase(z - fundDed - penDed, t);
    /* Maternity pay and the like are taxed with the business income, but national insurance on them is withheld by the payer. */
    var ni = niOn(base, t), health = healthOn(base, t), before = incomeTaxBeforeCredits(base + pos(otherIncome), t);
    var pointsCredit = pos(points) * t.pointValue;
    var incomeTax = Math.max(0, before - pointsCredit - penCredit - pos(extraCredit));
    return {
      income: z, fundDed: fundDed, penDed: penDed, penCredit: penCredit, base: base, ni: ni, health: health, social: ni + health,
      incomeBefore: before, pointsCredit: pointsCredit, incomeTax: incomeTax, total: ni + health + incomeTax
    };
  }

  /* Credit points for one tax year. Kol Zchut 2026 for children and reserve duty; taxes-refund.co.il for the rest, marked in the module doc. */
  function creditPoints(p) {
    p = p || {};
    var man = p.gender === 'man', k = function (key) { return pos(p[key]); };
    var points = (man ? 2.25 : 2.75) + k('k0') * 2.5 + k('k1') * 4.5 + k('k2') * 4.5 + k('k3') * 3.5 + k('k45') * 2.5 + (k('k612') + k('k1317')) * (man ? 1 : 2) + k('k18') * (man ? 0 : 0.5);
    if (!man && p.defer && k('k0') > 0) points -= 1;
    if (!man && p.deferredLast && k('k1') > 0) points += 1;
    return points + k('miluim') + k('soldier') + k('degree') + (p.single ? 1 : 0) + k('disabled') * 2 + k('immigrant') + k('extra');
  }

  function exVat(v, row, vatRate) { return pos(v) / (1 + (row.vat === false ? 0 : vatRate)); }
  /* What the tax authority recognises of one month's amount, before the yearly gift cap. */
  function recognisedMonth(row, ex) {
    if (row.rule === 'phone') return Math.max(ex * 0.5, ex - OPS_2026.phoneCap);
    return ex * (row.rec == null || row.rec === '' ? 100 : pos(row.rec)) / 100;
  }
  function lastFilled(o) {
    var last = 0, scan = function (rows) { (rows || []).forEach(function (r) { (r.m || []).forEach(function (v, i) { if (pos(v) > 0 && i + 1 > last) last = i + 1; }); }); };
    ['income', 'direct', 'marketing', 'admin', 'finance'].forEach(function (k) { scan(o.rows && o.rows[k]); });
    return last;
  }

  function ops(state, computed) {
    var s = state || {}, o = s.ops || {}, t = (s.tax && s.tax.tables) || tablesFor(o.year || 2026), biz = s.biz || {};
    var patur = biz.type === 'patur', vatRate = patur ? 0 : (biz.vatPct == null ? 18 : pos(biz.vatPct)) / 100;
    var rows = o.rows || {}, draw = o.draw || {}, paid = o.paid || {}, bank = o.bank || {};
    var auto = lastFilled(o), k = pos(o.upto) >= 1 ? Math.min(12, Math.floor(pos(o.upto))) : auto;
    var factor = k ? 12 / k : 0;
    var visible = (o.private || []).filter(function (r) { return r.group === 'home' ? o.home : (r.group === 'car' ? o.car : true); });

    function monthly(list, i, fn) { return sum(list, function (r) { return fn(r, (r.m || [])[i]); }); }
    var ex = function (r, v) { return exVat(v, r, vatRate); }, rawV = function (r, v) { return pos(v); };
    var vatOf = function (r, v) { return pos(v) - exVat(v, r, vatRate); };
    /* A refund to a client is less income, not an expense. */
    var sign = function (fn) { return function (r, v) { return (r.refund ? -1 : 1) * fn(r, v); }; };
    var val = function (a, i) { return pos((a || [])[i]); };

    var months = [];
    for (var i = 0; i < 12; i++) {
      var m = { i: i, revenue: monthly(rows.income, i, sign(ex)), direct: monthly(rows.direct, i, ex), marketing: monthly(rows.marketing, i, ex), admin: monthly(rows.admin, i, ex), finance: monthly(rows.finance, i, ex) };
      m.gross = m.revenue - m.direct;
      m.operating = m.gross - m.marketing - m.admin;
      m.preTax = m.operating - m.finance;
      m.salary = val(draw.salary, i); m.pension = val(draw.pension, i); m.fund = val(draw.fund, i); m.savings = val(draw.savings, i); m.loan = val(draw.loan, i);
      /* Instalments on an invoice from an earlier year: cash leaves now, but the expense and its VAT belong to that year. */
      m.prior = val(draw.prior, i);
      m.drawn = m.salary + m.pension + m.fund + m.savings + m.loan + m.prior;
      m.vatOut = monthly(rows.income, i, sign(vatOf));
      m.vatIn = monthly(rows.direct, i, vatOf) + monthly(rows.marketing, i, vatOf) + monthly(rows.admin, i, vatOf) + monthly(rows.finance, i, vatOf);
      m.paidIncome = val(paid.income, i); m.paidNi = val(paid.ni, i); m.paidVat = val(paid.vat, i);
      m.cashIn = monthly(rows.income, i, sign(rawV));
      m.cashOut = monthly(rows.direct, i, rawV) + monthly(rows.marketing, i, rawV) + monthly(rows.admin, i, rawV) + monthly(rows.finance, i, rawV) + m.drawn + m.paidIncome + m.paidNi + m.paidVat;
      months.push(m);
    }

    /* The year so far, projected to twelve months. A row marked one-off is counted once. */
    function project(list) {
      return sum(list, function (r) {
        var total = 0; for (var j = 0; j < k; j++) total += ex(r, (r.m || [])[j]);
        return (r.refund ? -1 : 1) * (r.oneOff || r.rule === 'gift' ? total : total * factor);
      });
    }
    function projectRec(list) {
      return sum(list, function (r) {
        var total = 0; for (var j = 0; j < k; j++) total += recognisedMonth(r, ex(r, (r.m || [])[j]));
        var year = r.oneOff || r.rule === 'gift' ? total : total * factor;
        if (r.rule === 'gift' && pos(r.people) > 0) year = Math.min(year, pos(r.people) * OPS_2026.giftCap);
        return year;
      });
    }
    var costLists = [rows.direct, rows.marketing, rows.admin, rows.finance];
    var income = project(rows.income);
    var pnlCosts = sum(costLists, project);
    var bizRecognised = sum(costLists, projectRec);
    var privateRecognised = projectRec(visible);
    var depreciation = pos(o.depreciation);
    var taxable = income - bizRecognised - privateRecognised - depreciation;
    var sumTo = function (key) { var a = 0; for (var j = 0; j < k; j++) a += months[j][key]; return a; };
    var pensionMonth = k ? sumTo('pension') / k : 0, fundMonth = k ? sumTo('fund') / k : 0;
    var donations = pos(o.donations) * OPS_2026.donationRate / 100 / 12;
    var points = s.tax && s.tax.points;
    var otherIncome = pos(o.otherIncome), otherWithheld = pos(o.otherWithheld);
    var est = depositTax(taxable / 12, pensionMonth, fundMonth, points, t, donations, otherIncome / 12);
    var estLess = depositTax((taxable - 1000) / 12, pensionMonth, fundMonth, points, t, donations, otherIncome / 12);
    /* The profit and loss carries only the business's own tax, without what the maternity pay adds. */
    var estBiz = depositTax(taxable / 12, pensionMonth, fundMonth, points, t, donations);
    var annual = {
      income: income, pnlCosts: pnlCosts, profit: income - pnlCosts, bizRecognised: bizRecognised, privateRecognised: privateRecognised, depreciation: depreciation,
      taxable: taxable, pension: pensionMonth * 12, fund: fundMonth * 12, fundDed: est.fundDed * 12, penDed: est.penDed * 12, penCredit: est.penCredit * 12,
      base: est.base * 12, ni: est.ni * 12, health: est.health * 12, social: est.social * 12, incomeBefore: est.incomeBefore * 12, pointsCredit: est.pointsCredit * 12, donations: donations * 12,
      otherIncome: otherIncome, otherWithheld: otherWithheld, incomeTaxLeft: Math.max(0, est.incomeTax * 12 - otherWithheld), overWithheld: Math.max(0, otherWithheld - est.incomeTax * 12),
      unusedCredits: Math.max(0, (est.pointsCredit + est.penCredit + donations - est.incomeBefore) * 12),
      incomeTax: est.incomeTax * 12, total: est.total * 12, perMonth: est.total,
      advancePct: income > 0 ? Math.max(0, est.incomeTax * 12 - otherWithheld) / income : 0,
      savedPer1000: k && taxable > 1000 ? (est.total - estLess.total) * 12 : 0
    };
    var taxRate = annual.profit > 0 ? Math.min(estBiz.total * 12 / annual.profit, 0.95) : 0;

    /* The estimate is the tax line: low advances must not inflate the profit. */
    months.forEach(function (x) {
      x.tax = x.preTax * taxRate;
      x.net = x.preTax - x.tax;
      x.left = x.net - x.drawn;
      x.cashNet = x.cashIn - x.cashOut;
      x.filled = x.i < k;
    });
    var keys = ['revenue', 'direct', 'gross', 'marketing', 'admin', 'operating', 'finance', 'preTax', 'tax', 'net', 'salary', 'pension', 'fund', 'savings', 'loan', 'prior', 'drawn', 'left', 'vatOut', 'vatIn', 'paidIncome', 'paidNi', 'paidVat', 'cashIn', 'cashOut', 'cashNet'];
    var total = {}; keys.forEach(function (key) { total[key] = sumTo(key); });

    var shareOfYear = k / 12;
    var due = { income: annual.incomeTaxLeft * shareOfYear, social: annual.social * shareOfYear };
    var gapIncome = due.income - total.paidIncome, gapSocial = due.social - total.paidNi;
    var vatOwed = patur ? 0 : total.vatOut - total.vatIn - total.paidVat;

    var opening = num(bank.opening), enteredClose = k ? (bank.end || [])[k - 1] : '';
    var expected = opening + total.cashIn - total.cashOut;
    var hasBank = enteredClose !== '' && enteredClose != null;
    var actual = hasBank ? num(enteredClose) : null;
    var reserved = Math.max(0, vatOwed) + Math.max(0, gapIncome) + Math.max(0, gapSocial);

    var mandatory = mandatoryPension(taxable / 12) * 12;
    return {
      year: o.year || 2026, notes: o.notes || [], k: k, auto: auto, patur: patur, months: months, total: total, annual: annual, taxRate: taxRate,
      due: due, gapIncome: gapIncome, gapSocial: gapSocial, vatOwed: vatOwed,
      bank: { opening: opening, expected: expected, actual: actual, gap: hasBank ? actual - expected : null, reserved: reserved, free: hasBank ? actual - reserved : null },
      mandatory: mandatory, pensionShort: Math.max(0, mandatory - annual.pension),
      planRevenueMonth: computed && computed.annual && computed.annual.revenue != null ? computed.annual.revenue / 12 : null
    };
  }

  /* ---------- several years: state.ops is always the year in use, the others wait in state.years ---------- */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function emptyMonths() { var a = []; for (var i = 0; i < 12; i++) a.push(''); return a; }
  function yearList(state) {
    var ys = Object.keys((state && state.years) || {}).map(Number);
    ys.push((state.ops && state.ops.year) || 2026);
    return ys.sort(function (a, b) { return a - b; });
  }
  /* The year in use, with the credit points kept for that year. */
  function yearOps(state, year) {
    var cur = (state.ops && state.ops.year) || 2026, o = year === cur ? state.ops : state.years[year];
    var taxOf = year === cur ? state.tax : (o._tax || {});
    var copy = clone(o); copy.upto = '';
    return ops({ biz: state.biz, tax: { points: taxOf.points, tables: year === cur ? state.tax.tables : null }, ops: copy });
  }
  function switchYear(state, year) {
    var cur = (state.ops && state.ops.year) || 2026;
    if (year === cur || !state.years || !state.years[year]) return state;
    state.ops._tax = { points: state.tax.points, pick: state.tax.pick || null, tables: state.tax.tables || null };
    state.ops.year = cur;
    state.years[cur] = state.ops;
    state.ops = state.years[year];
    delete state.years[year];
    var t = state.ops._tax || {};
    state.tax.points = t.points == null ? '' : t.points; state.tax.pick = t.pick || null; state.tax.tables = t.tables || null;
    delete state.ops._tax;
    return state;
  }
  /* Children grow a year; reserve duty is counted again; a deferred point arrives. Nothing is deleted. */
  function agePick(p) {
    if (!p) return null;
    var q = clone(p), n = function (k) { return pos(q[k]); };
    var k3 = n('k3'), k2 = n('k2'), k1 = n('k1'), k0 = n('k0');
    q.deferredLast = !!q.defer; q.defer = false; q.miluim = '';
    q.k45 = (n('k45') + k3) || ''; q.k3 = k2 || ''; q.k2 = k1 || ''; q.k1 = k0 || ''; q.k0 = '';
    return q;
  }
  function closeYear(state) {
    var s = clone(state), o = s.ops, year = o.year || 2026, res = yearOps(s, year);
    var last = (o.bank && o.bank.end || [])[11];
    var opening = last !== '' && last != null ? num(last) : res.bank.expected;
    var fresh = clone(o), wipe = function (r) { r.m = emptyMonths(); };
    Object.keys(fresh.rows || {}).forEach(function (k) { fresh.rows[k].forEach(wipe); });
    (fresh.private || []).forEach(wipe);
    Object.keys(fresh.draw || {}).forEach(function (k) { fresh.draw[k] = emptyMonths(); });
    Object.keys(fresh.paid || {}).forEach(function (k) { fresh.paid[k] = emptyMonths(); });
    fresh.bank = { opening: opening, end: emptyMonths() };
    fresh.notes = emptyMonths();
    fresh.year = year + 1; fresh.edit = 0; fresh.view = 'year'; fresh.upto = ''; fresh.seeded = false;
    fresh.depreciation = ''; fresh.donations = ''; fresh.otherIncome = ''; fresh.otherWithheld = '';
    delete fresh._tax;
    o._tax = { points: s.tax.points, pick: s.tax.pick || null, tables: s.tax.tables || null };
    o.year = year;
    s.years = s.years || {}; s.years[year] = o;
    s.ops = fresh;
    if (s.tax.pick) { s.tax.pick = agePick(s.tax.pick); s.tax.points = creditPoints(s.tax.pick); }
    s.tax.tables = null;
    return s;
  }
  /* The same months in both years, so a half-filled year never looks like a drop. */
  function compareYears(cur, prev) {
    var n = Math.min(cur.k, prev.k), pct = function (a, b) { return b > 0 ? (a - b) / b * 100 : null; };
    var sum = function (o, key) { var t = 0; for (var i = 0; i < n; i++) t += o.months[i][key]; return t; };
    var line = function (key) { var a = sum(cur, key), b = sum(prev, key); return [a, b, pct(a, b)]; };
    return { n: n, revenue: line('revenue'), preTax: line('preTax'), net: line('net') };
  }

  /* ---------- decision helpers on the price list ---------- */
  function productRank(R) {
    var list = R.products.map(function (p, i) {
      var left = p.net - p.direct - p.calc.specific, goal = R.goals[i];
      return { i: i, name: p.name, left: left, hours: p.hours, perHour: p.hours > 0 ? left / p.hours : null, unitsYear: goal ? goal.unitsYear : 0, status: p.status, net: p.net };
    }).filter(function (x) { return x.net > 0; });
    list.sort(function (a, b) { return (b.perHour == null ? -Infinity : b.perHour) - (a.perHour == null ? -Infinity : a.perHour); });
    var withHours = list.filter(function (x) { return x.perHour != null; });
    var best = withHours.length ? withHours[0].perHour : null, worst = withHours.length > 1 ? withHours[withHours.length - 1] : null;
    return { list: list, best: best, worst: worst, weak: !!(worst && (worst.status === 'below-min' || worst.perHour < best * 0.6)) };
  }

  /* A negative percent is a discount, a positive one a price rise. */
  function whatIf(R, index, pctChange) {
    var p = R.products[index]; if (!p || !(p.net > 0)) return null;
    var set = R.settings, change = num(pctChange), customer = p.customer * (1 + change / 100);
    var net = chosenNet(customer, set.vatPct, set.feePct), oldNet = chosenNet(p.customer, set.vatPct, set.feePct);
    var cost = p.direct + p.calc.specific, oldLeft = oldNet - cost, newLeft = net - cost;
    var goal = R.goals[index], units = goal ? goal.unitsYear : 0;
    return {
      change: change, customer: customer, oldCustomer: p.customer, net: net, oldNet: oldNet, oldLeft: oldLeft, newLeft: newLeft,
      perSale: newLeft - oldLeft, losing: newLeft <= 0, belowMin: net < p.calc.minPrice - 0.005,
      unitsNow: units, unitsNeeded: newLeft > 0 && oldLeft > 0 ? units * oldLeft / newLeft : null,
      yearEffect: units * (newLeft - oldLeft)
    };
  }

  return {
    TABLES_2026: TABLES_2026, PATUR_CEILING_2026: PATUR_CEILING_2026, MAX_MARGIN: MAX_MARGIN, OPS_2026: OPS_2026,
    num: num, materialUnitPrice: materialUnitPrice, lineCost: lineCost, productDirect: productDirect,
    labor: labor, overhead: overhead, tax: tax, solvePreTax: solvePreTax, priceProduct: priceProduct, chosenNet: chosenNet, compute: compute,
    expandProduct: expandProduct, expandState: expandState, groupView: groupView, eventCost: eventCost,
    ymAdd: ymAdd, salePayments: salePayments, saleTotal: saleTotal, salesForecast: salesForecast, salesCounts: salesCounts,
    mandatoryPension: mandatoryPension, depositTax: depositTax, creditPoints: creditPoints, ops: ops, hasTables: hasTables, tablesFor: tablesFor,
    yearList: yearList, yearOps: yearOps, switchYear: switchYear, closeYear: closeYear, agePick: agePick, compareYears: compareYears, productRank: productRank, whatIf: whatIf
  };
});
