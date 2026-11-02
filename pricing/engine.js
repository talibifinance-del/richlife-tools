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

    var products = (s.products || []).map(function (p) {
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

  return {
    TABLES_2026: TABLES_2026, PATUR_CEILING_2026: PATUR_CEILING_2026, MAX_MARGIN: MAX_MARGIN,
    num: num, materialUnitPrice: materialUnitPrice, lineCost: lineCost, productDirect: productDirect,
    labor: labor, overhead: overhead, tax: tax, solvePreTax: solvePreTax, priceProduct: priceProduct, chosenNet: chosenNet, compute: compute
  };
});
