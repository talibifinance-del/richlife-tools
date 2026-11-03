/* Builds the filled Excel workbook: 9 sheets, live formulas, cached values from the engine so previews show numbers too. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PricingExport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var SH = { direct: 'עלויות ישירות', cogs: 'עלות מכר', labor: 'שכר עבודה', overhead: 'עלויות עקיפות', tax: 'תחשיבי מס', pricing: 'תמחור מוצרים', list: 'מחירון', profit: 'רווח רצוי', goals: 'יעדים ותוכנית' };
  var PINE = 'FF3E5448', SAGE = 'FFDCE9DD', TINT = 'FFEEF4EF';
  var NUM2 = '#,##0.00', NUM0 = '#,##0', PCT = '0.0%';
  function q(name) { return "'" + name + "'!"; }
  function col(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

  function sheet(wb, name, title, widths) {
    var ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, showGridLines: false }] });
    ws.columns = widths.map(function (w) { return { width: w }; });
    ws.getCell('A1').value = title;
    ws.getCell('A1').font = { name: 'Arial', bold: true, size: 15, color: { argb: PINE } };
    ws.getRow(1).height = 26;
    return ws;
  }
  function style(c, o) {
    o = o || {};
    c.font = { name: 'Arial', size: 11, bold: !!o.bold, color: { argb: o.head ? 'FFFFFFFF' : 'FF1E2B25' } };
    if (o.head) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINE } };
    else if (o.input) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SAGE } };
    else if (o.sum) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT } };
    if (o.fmt) c.numFmt = o.fmt;
    if (o.head) c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFC8D6CC' } } };
  }
  function put(ws, ref, v, o) { var c = ws.getCell(ref); c.value = v === '' || v == null ? null : v; style(c, o); return c; }
  function fx(ws, ref, formula, result, o) { var c = ws.getCell(ref); c.value = { formula: formula, result: result == null ? 0 : result }; style(c, o); return c; }
  function head(ws, row, labels) { labels.forEach(function (l, i) { put(ws, col(i) + row, l, { head: true }); }); ws.getRow(row).height = 32; }
  function numOrNull(E, v) { return v === '' || v == null ? null : E.num(v); }

  function build(state, E, ExcelJS) {
    state = E.expandState(state);
    var R = E.compute(state), wb = new ExcelJS.Workbook();
    wb.creator = 'RichLife'; wb.calcProperties.fullCalcOnLoad = true;
    var S = state, L = R.labor, set = R.settings;

    /* 1 direct costs */
    var d = sheet(wb, SH.direct, 'עלויות ישירות' + (S.biz.name ? ' · ' + S.biz.name : ''), [30, 14, 14, 14, 12, 16]);
    put(d, 'A2', 'תאים ירוקים הם נתונים שאפשר לשנות. כל השאר מחושב לבד.', {});
    put(d, 'A3', 'בלאי', { bold: true }); put(d, 'B3', set.wastePct / 100, { input: true, fmt: PCT });
    head(d, 5, ['סוג', 'יחידה', 'כמה בחבילה', set.patur ? 'עלות, כולל מע"מ' : 'עלות, בלי מע"מ', 'בלאי', 'מחיר כולל בלאי']);
    var matRow = {}, r = 6;
    (S.materials || []).forEach(function (m) {
      matRow[m.id] = r;
      put(d, 'A' + r, m.name || '', { input: true }); put(d, 'B' + r, m.unit || '', { input: true });
      put(d, 'C' + r, numOrNull(E, m.pack), { input: true, fmt: NUM2 }); put(d, 'D' + r, numOrNull(E, m.cost), { input: true, fmt: NUM2 });
      fx(d, 'E' + r, 'D' + r + '*$B$3', E.num(m.cost) * set.wastePct / 100, { fmt: NUM2 });
      fx(d, 'F' + r, 'D' + r + '+E' + r, E.materialUnitPrice(m, set.wastePct), { fmt: NUM2 });
      r++;
    });

    /* 2 cost of sale */
    var c = sheet(wb, SH.cogs, 'עלות מכר למוצר אחד', [30, 14, 16, 14, 14]);
    r = 3;
    var prodTotal = [];
    (S.products || []).forEach(function (p, i) {
      put(c, 'A' + r, p.name || 'מוצר ' + (i + 1), { bold: true, sum: true }); r++;
      head(c, r, ['חומר', 'כמות למוצר', 'מחיר כולל בלאי', 'כמה בחבילה', 'עלות']); r++;
      var first = r;
      p.lines.forEach(function (l) {
        var mr = matRow[l.mat], m = (S.materials || []).filter(function (x) { return x.id === l.mat; })[0];
        if (mr) {
          fx(c, 'A' + r, q(SH.direct) + 'A' + mr, m.name || '', {});
          fx(c, 'C' + r, q(SH.direct) + 'F' + mr, E.materialUnitPrice(m, set.wastePct), { fmt: NUM2 });
          fx(c, 'D' + r, q(SH.direct) + 'C' + mr, E.num(m.pack), { fmt: NUM2 });
        } else { put(c, 'A' + r, '', {}); put(c, 'C' + r, 0, { fmt: NUM2 }); put(c, 'D' + r, 0, { fmt: NUM2 }); }
        put(c, 'B' + r, numOrNull(E, l.qty), { input: true, fmt: NUM2 });
        fx(c, 'E' + r, 'IFERROR(B' + r + '/D' + r + '*C' + r + ',0)', E.lineCost(l, S.materials, set.wastePct), { fmt: NUM2 });
        r++;
      });
      put(c, 'A' + r, 'סך הכל', { bold: true, sum: true });
      if (p.lines.length) fx(c, 'E' + r, 'SUM(E' + first + ':E' + (r - 1) + ')', R.products[i].direct, { bold: true, sum: true, fmt: NUM2 });
      else put(c, 'E' + r, 0, { bold: true, sum: true, fmt: NUM2 });
      prodTotal[i] = q(SH.cogs) + 'E' + r;
      r += 2;
    });

    /* 3 labor */
    var l = sheet(wb, SH.labor, 'שכר ושעות עבודה', [30, 18, 14, 14, 14, 14, 14]);
    put(l, 'A3', 'נטו לבנק', {}); put(l, 'B3', numOrNull(E, S.labor.net), { input: true, fmt: NUM2 });
    put(l, 'A4', 'פנסיה', {}); put(l, 'B4', numOrNull(E, S.labor.pension), { input: true, fmt: NUM2 });
    put(l, 'A5', 'קרן השתלמות', {}); put(l, 'B5', numOrNull(E, S.labor.fund), { input: true, fmt: NUM2 });
    put(l, 'A6', 'סך עלות השכר שלך', { bold: true, sum: true }); fx(l, 'B6', 'SUM(B3:B5)', L.ownerCost, { bold: true, sum: true, fmt: NUM2 });
    put(l, 'A7', 'שעות עבודה בחודש', {}); put(l, 'B7', numOrNull(E, S.labor.hours), { input: true, fmt: NUM2 });
    put(l, 'A8', 'נטו לשעה', {}); fx(l, 'B8', 'IFERROR(B3/B7,0)', L.netPerHour, { fmt: NUM2 });
    head(l, 10, ['עובדים בשכר חודשי', 'תפקיד', 'ברוטו', 'מקדם', 'עלות מעסיק', 'שעות בחודש']);
    var monthly = (S.labor.monthly || []).slice(); while (monthly.length < 3) monthly.push({});
    r = 11; var mFirst = r;
    monthly.forEach(function (e, i) {
      var calc = L.monthly[i];
      put(l, 'A' + r, e.name || '', { input: true }); put(l, 'B' + r, e.role || '', { input: true });
      put(l, 'C' + r, numOrNull(E, e.gross), { input: true, fmt: NUM2 }); put(l, 'D' + r, e.factor === '' || e.factor == null ? 1.35 : E.num(e.factor), { input: true, fmt: NUM2 });
      fx(l, 'E' + r, 'C' + r + '*D' + r, calc ? calc.cost : 0, { fmt: NUM2 });
      put(l, 'F' + r, numOrNull(E, e.hours), { input: true, fmt: NUM2 }); r++;
    });
    var mTotal = r;
    put(l, 'A' + r, 'סך הכל', { bold: true, sum: true });
    fx(l, 'E' + r, 'SUM(E' + mFirst + ':E' + (r - 1) + ')', L.monthlyCost, { bold: true, sum: true, fmt: NUM2 });
    fx(l, 'F' + r, 'SUM(F' + mFirst + ':F' + (r - 1) + ')', L.monthlyHours, { bold: true, sum: true, fmt: NUM2 });
    r += 2;
    head(l, r, ['עובדים בשכר שעתי', 'תפקיד', 'שכר לשעה', 'שעות בחודש', 'ברוטו', 'מקדם', 'עלות מעסיק']); r++;
    var hourly = (S.labor.hourly || []).slice(); while (hourly.length < 3) hourly.push({});
    var hFirst = r;
    hourly.forEach(function (e, i) {
      var calc = L.hourly[i];
      put(l, 'A' + r, e.name || '', { input: true }); put(l, 'B' + r, e.role || '', { input: true });
      put(l, 'C' + r, numOrNull(E, e.rate), { input: true, fmt: NUM2 }); put(l, 'D' + r, numOrNull(E, e.hours), { input: true, fmt: NUM2 });
      fx(l, 'E' + r, 'C' + r + '*D' + r, calc ? calc.gross : 0, { fmt: NUM2 });
      put(l, 'F' + r, e.factor === '' || e.factor == null ? 1.35 : E.num(e.factor), { input: true, fmt: NUM2 });
      fx(l, 'G' + r, 'E' + r + '*F' + r, calc ? calc.cost : 0, { fmt: NUM2 }); r++;
    });
    var hTotal = r;
    put(l, 'A' + r, 'סך הכל', { bold: true, sum: true });
    fx(l, 'D' + r, 'SUM(D' + hFirst + ':D' + (r - 1) + ')', L.hourlyHours, { bold: true, sum: true, fmt: NUM2 });
    fx(l, 'G' + r, 'SUM(G' + hFirst + ':G' + (r - 1) + ')', L.hourlyCost, { bold: true, sum: true, fmt: NUM2 });
    r += 2;
    var lCost = r, lHours = r + 1, lRate = r + 2;
    put(l, 'A' + lCost, 'סך עלות שכר בעסק', { bold: true, sum: true }); fx(l, 'B' + lCost, 'B6+E' + mTotal + '+G' + hTotal, L.totalCost, { bold: true, sum: true, fmt: NUM2 });
    put(l, 'A' + lHours, 'סך שעות בעסק', { bold: true, sum: true }); fx(l, 'B' + lHours, 'B7+F' + mTotal + '+D' + hTotal, L.totalHours, { bold: true, sum: true, fmt: NUM2 });
    put(l, 'A' + lRate, 'עלות שכר לשעת עבודה', { bold: true, sum: true }); fx(l, 'B' + lRate, 'IFERROR(B' + lCost + '/B' + lHours + ',0)', L.costPerHour, { bold: true, sum: true, fmt: NUM2 });

    /* 4 overhead */
    var o = sheet(wb, SH.overhead, 'עלויות עקיפות', [32].concat(MONTHS.map(function () { return 10; })).concat([13]));
    r = 3;
    function ohGroup(title, rows, annual) {
      head(o, r, [title].concat(MONTHS).concat(['בשנה'])); r++;
      var list = (rows || []).slice(), first = r; list.push({ name: '', m: [] });
      list.forEach(function (row) {
        put(o, 'A' + r, row.name || '', { input: true });
        for (var k = 0; k < 12; k++) put(o, col(k + 1) + r, numOrNull(E, row.m[k]), { input: true, fmt: NUM0 });
        fx(o, 'N' + r, 'SUM(B' + r + ':M' + r + ')', (row.m || []).reduce(function (a, x) { return a + E.num(x); }, 0), { fmt: NUM0 });
        r++;
      });
      put(o, 'A' + r, 'סך הכל', { bold: true, sum: true });
      fx(o, 'N' + r, 'SUM(N' + first + ':N' + (r - 1) + ')', annual, { bold: true, sum: true, fmt: NUM0 });
      var total = r; r += 2; return total;
    }
    var mkT = ohGroup('שיווק ומכירות', S.overhead.marketing, R.overhead.marketingAnnual);
    var adT = ohGroup('הנהלה וכלליות', S.overhead.admin, R.overhead.adminAnnual);
    put(o, 'A' + r, 'סך עלויות עקיפות בשנה', { bold: true, sum: true }); fx(o, 'B' + r, 'N' + mkT + '+N' + adT, R.overhead.annual, { bold: true, sum: true, fmt: NUM0 }); var oA = r; r++;
    put(o, 'A' + r, 'ממוצע בחודש', { bold: true, sum: true }); fx(o, 'B' + r, 'B' + oA + '/12', R.overhead.monthly, { bold: true, sum: true, fmt: NUM0 }); var oM = r; r++;
    put(o, 'A' + r, 'העמסה לשעת עבודה', { bold: true, sum: true }); fx(o, 'B' + r, 'IFERROR(B' + oM + '/' + q(SH.labor) + 'B' + lHours + ',0)', R.overhead.perHour, { bold: true, sum: true, fmt: NUM2 }); var oRate = r;

    /* 5 tax */
    var t = sheet(wb, SH.tax, 'תחשיבי מס (הערכה בלבד, לא ייעוץ מס)', [38, 16, 14, 14]), tb = set.tables, tr = R.tax;
    put(t, 'A3', 'רווח לפני מס בחודש', { bold: true }); put(t, 'B3', R.preTax, { input: true, fmt: NUM2 });
    put(t, 'C3', 'אם משנים נתונים, לשנות את התא הזה עד שהפער למטה מתקרב ל-0', {});
    put(t, 'A4', 'נקודות זיכוי', {}); put(t, 'B4', numOrNull(E, S.tax.points), { input: true, fmt: NUM2 });
    put(t, 'A5', 'חיסכון רצוי בחודש', {}); put(t, 'B5', numOrNull(E, S.tax.saving), { input: true, fmt: NUM2 });
    put(t, 'A6', 'נטו רצוי בחודש', {}); fx(t, 'B6', q(SH.labor) + 'B3', L.net, { fmt: NUM2 });
    var params = [['ביטוח לאומי מופחת', tb.niReduced / 100, PCT], ['ביטוח לאומי רגיל', tb.niFull / 100, PCT], ['בריאות מופחת', tb.healthReduced / 100, PCT], ['בריאות רגיל', tb.healthFull / 100, PCT], ['סף שיעור מופחת', tb.reducedThreshold, NUM0], ['תקרת הכנסה', tb.ceiling, NUM0], ['חלק מוכר מהביטוח הלאומי', tb.niDeductible / 100, PCT], ['ערך נקודת זיכוי בחודש', tb.pointValue, NUM0]];
    params.forEach(function (p, i) { put(t, 'A' + (8 + i), p[0], {}); put(t, 'B' + (8 + i), p[1], { input: true, fmt: p[2] === PCT ? '0.00%' : p[2] }); });
    var NR = '$B$8', NF = '$B$9', HR = '$B$10', HF = '$B$11', TH = '$B$12', CE = '$B$13', DE = '$B$14', PV = '$B$15';
    var NIC = '(' + TH + '*' + NR + '+(' + CE + '-' + TH + ')*' + NF + ')';
    put(t, 'A17', 'הכנסה לחישוב ביטוח לאומי ומס', {});
    fx(t, 'B17', 'IF(B3<=0,0,IF(B3<=' + TH + '*(1+' + DE + '*' + NR + '),B3/(1+' + DE + '*' + NR + '),IF(B3<=' + CE + '+' + DE + '*' + NIC + ',(B3+' + DE + '*' + TH + '*(' + NF + '-' + NR + '))/(1+' + DE + '*' + NF + '),B3-' + DE + '*' + NIC + ')))', tr.base, { fmt: NUM2 });
    put(t, 'A18', 'ביטוח לאומי', {}); fx(t, 'B18', 'MIN(B17,' + TH + ')*' + NR + '+MAX(0,MIN(B17,' + CE + ')-' + TH + ')*' + NF, tr.ni, { fmt: NUM2 });
    put(t, 'A19', 'בריאות', {}); fx(t, 'B19', 'MIN(B17,' + TH + ')*' + HR + '+MAX(0,MIN(B17,' + CE + ')-' + TH + ')*' + HF, tr.health, { fmt: NUM2 });
    head(t, 21, ['מדרגה: עד', 'שיעור', 'מס במדרגה']);
    var prevTop = 0; r = 22; var bFirst = r;
    tb.brackets.forEach(function (b, i) {
      if (b.to == null) { put(t, 'A' + r, 'מעל', {}); fx(t, 'C' + r, 'MAX(0,$B$17-A' + (r - 1) + ')*B' + r, Math.max(0, tr.base - prevTop) * b.rate / 100, { fmt: NUM2 }); }
      else {
        put(t, 'A' + r, b.to, { input: true, fmt: NUM0 });
        var prevRef = i === 0 ? '0' : 'A' + (r - 1);
        fx(t, 'C' + r, 'MAX(0,MIN($B$17,A' + r + ')-' + prevRef + ')*B' + r, Math.max(0, Math.min(tr.base, b.to) - prevTop) * b.rate / 100, { fmt: NUM2 });
        prevTop = b.to;
      }
      put(t, 'B' + r, b.rate / 100, { input: true, fmt: '0%' });
      r++;
    });
    var bLast = r - 1; r++;
    var tIncome = r;
    put(t, 'A' + r, 'מס הכנסה לתשלום', { bold: true, sum: true }); fx(t, 'B' + r, 'MAX(0,SUM(C' + bFirst + ':C' + bLast + ')-B4*' + PV + ')', tr.income, { bold: true, sum: true, fmt: NUM2 }); r++;
    var tTotal = r;
    put(t, 'A' + r, 'סך מיסים בחודש', { bold: true, sum: true }); fx(t, 'B' + r, 'B18+B19+B' + tIncome, tr.total, { bold: true, sum: true, fmt: NUM2 }); r++;
    var tNet = r;
    put(t, 'A' + r, 'נשאר ביד בחודש', { bold: true, sum: true }); fx(t, 'B' + r, 'B3-B' + tTotal, tr.net, { bold: true, sum: true, fmt: NUM2 }); r++;
    put(t, 'A' + r, 'פער מהנטו הרצוי (לשאוף ל-0)', {}); fx(t, 'B' + r, 'B' + tNet + '-B6-B5', tr.net - R.targetNet, { fmt: NUM2 }); r++;
    var tS = r;
    put(t, 'A' + r, 'שיעור ביטוח לאומי ובריאות', {}); fx(t, 'B' + r, 'IFERROR((B18+B19)/B3,0)', tr.socialRate, { fmt: '0.00%' }); r++;
    var tI = r;
    put(t, 'A' + r, 'שיעור מס הכנסה', {}); fx(t, 'B' + r, 'IFERROR(B' + tIncome + '/B3,0)', tr.incomeRate, { fmt: '0.00%' });

    /* 6 pricing */
    var p = sheet(wb, SH.pricing, 'תמחור מוצרים', [24].concat(Array(20).fill(12)));
    put(p, 'A3', 'בלת"מ', {}); put(p, 'B3', set.contingencyPct / 100, { input: true, fmt: PCT });
    put(p, 'A4', 'מע"מ', {}); put(p, 'B4', set.vatPct / 100, { input: true, fmt: PCT });
    put(p, 'A5', 'עמלת סליקה', {}); put(p, 'B5', set.feePct / 100, { input: true, fmt: '0.00%' });
    put(p, 'A6', 'עקיפות לשעה', {}); fx(p, 'B6', q(SH.overhead) + 'B' + oRate, R.overhead.perHour, { fmt: NUM2 });
    put(p, 'A7', 'שכר לשעה', {}); fx(p, 'B7', q(SH.labor) + 'B' + lRate, L.costPerHour, { fmt: NUM2 });
    put(p, 'A8', 'נטו לשעה', {}); fx(p, 'B8', q(SH.labor) + 'B8', L.netPerHour, { fmt: NUM2 });
    put(p, 'A9', 'שיעור ב"ל ובריאות', {}); fx(p, 'B9', q(SH.tax) + 'B' + tS, tr.socialRate, { fmt: '0.00%' });
    put(p, 'A10', 'שיעור מס הכנסה', {}); fx(p, 'B10', q(SH.tax) + 'B' + tI, tr.incomeRate, { fmt: '0.00%' });
    head(p, 12, ['מוצר', 'עלות חומרים', 'זמן עבודה (שעות)', 'עקיפות', 'שכר', 'עלות ספציפית', 'בלת"מ', 'מחיר מינימום', 'מחיר בשוק', '% רווח רצוי', 'חלק ההוצאה', 'תוספת רווח', 'לפני מיסים', 'ביטוח לאומי ובריאות', 'מס הכנסה', 'לפני מע"מ', 'כולל מע"מ', 'מומלץ ללקוח', 'מחיר שנבחר', 'פער', 'מחיר נטו']);
    var pFirst = 13;
    R.products.forEach(function (x, i) {
      var rr = pFirst + i, src = S.products[i], cc = x.calc, X = '(L' + rr + '+C' + rr + '*$B$8)', RT = '($B$9+$B$10)';
      put(p, 'A' + rr, x.name || 'מוצר ' + (i + 1), { bold: true });
      fx(p, 'B' + rr, prodTotal[i].replace(/^/, ''), cc.direct, { fmt: NUM2 });
      put(p, 'C' + rr, numOrNull(E, src.hours), { input: true, fmt: NUM2 });
      fx(p, 'D' + rr, '$B$6*C' + rr, cc.overheadCost, { fmt: NUM2 }); fx(p, 'E' + rr, '$B$7*C' + rr, cc.laborCost, { fmt: NUM2 });
      put(p, 'F' + rr, numOrNull(E, src.specific), { input: true, fmt: NUM2 });
      fx(p, 'G' + rr, '$B$3*(B' + rr + '+D' + rr + '+E' + rr + '+F' + rr + ')', cc.contingency, { fmt: NUM2 });
      fx(p, 'H' + rr, 'B' + rr + '+D' + rr + '+E' + rr + '+F' + rr + '+G' + rr, cc.minPrice, { fmt: NUM2, bold: true });
      put(p, 'I' + rr, numOrNull(E, src.market), { input: true, fmt: NUM2 });
      put(p, 'J' + rr, cc.marginPct / 100, { input: true, fmt: PCT });
      fx(p, 'K' + rr, 'IF(J' + rr + '<1,1-J' + rr + ',NA())', 1 - cc.marginPct / 100, { fmt: PCT });
      fx(p, 'L' + rr, 'H' + rr + '/K' + rr + '-H' + rr, cc.profit, { fmt: NUM2 });
      fx(p, 'M' + rr, 'H' + rr + '+L' + rr, cc.beforeTax, { fmt: NUM2 });
      fx(p, 'N' + rr, 'IFERROR((' + X + '/(1-' + RT + ')-' + X + ')*$B$9/' + RT + ',0)', cc.ni, { fmt: NUM2 });
      fx(p, 'O' + rr, 'IFERROR((' + X + '/(1-' + RT + ')-' + X + ')*$B$10/' + RT + ',0)', cc.income, { fmt: NUM2 });
      fx(p, 'P' + rr, 'M' + rr + '+N' + rr + '+O' + rr, cc.preVat, { fmt: NUM2, bold: true });
      fx(p, 'Q' + rr, 'P' + rr + '*(1+$B$4)', cc.withVat, { fmt: NUM2 });
      fx(p, 'R' + rr, 'Q' + rr + '*(1+$B$5)', cc.recommended, { fmt: NUM2, bold: true });
      put(p, 'S' + rr, x.hasChosen ? x.customer : null, { input: true, fmt: NUM2 });
      fx(p, 'T' + rr, 'IF(S' + rr + '>0,S' + rr + '-R' + rr + ',0)', x.hasChosen ? x.customer - cc.recommended : 0, { fmt: NUM2 });
      fx(p, 'U' + rr, 'IF(S' + rr + '>0,S' + rr + '/(1+$B$5)/(1+$B$4),P' + rr + ')', x.net, { fmt: NUM2, bold: true });
    });

    /* 7 price list. The mix inputs live on the goals sheet, so one number drives both. */
    var n = R.products.length, gl = sheet(wb, SH.list, 'מחירון ורווח גולמי', [26, 14, 14, 14, 12, 14]);
    var lFirst = 4, lLast = lFirst + Math.max(n, 1) - 1, gFirst = 6, gLast = gFirst + Math.max(n, 1) - 1;
    head(gl, 3, ['מוצר', 'מחיר נטו', 'עלות חומרים', 'רווח גולמי', '% גולמי', 'חלק מהמחזור']);
    R.products.forEach(function (x, i) {
      var rr = lFirst + i, pr = pFirst + i;
      fx(gl, 'A' + rr, q(SH.pricing) + 'A' + pr, x.name || 'מוצר ' + (i + 1), { bold: true });
      fx(gl, 'B' + rr, q(SH.pricing) + 'U' + pr, x.net, { fmt: NUM2 });
      fx(gl, 'C' + rr, q(SH.pricing) + 'B' + pr, x.direct, { fmt: NUM2 });
      fx(gl, 'D' + rr, 'B' + rr + '-C' + rr, x.grossProfit, { fmt: NUM2 });
      fx(gl, 'E' + rr, 'IFERROR(D' + rr + '/B' + rr + ',0)', x.grossPct, { fmt: PCT });
      fx(gl, 'F' + rr, q(SH.goals) + 'B' + (gFirst + i), x.mixPct / 100, { fmt: PCT });
    });
    var avg = lLast + 2, B_ = 'B' + lFirst + ':B' + lLast, E_ = 'E' + lFirst + ':E' + lLast, F_ = 'F' + lFirst + ':F' + lLast;
    put(gl, 'A' + avg, 'רווח גולמי ממוצע, לפי התמהיל', { bold: true, sum: true });
    fx(gl, 'B' + avg, 'IFERROR(IF(SUMIF(' + B_ + ',">0",' + F_ + ')>0,SUMPRODUCT(' + F_ + ',' + E_ + ')/SUMIF(' + B_ + ',">0",' + F_ + '),AVERAGEIF(' + B_ + ',">0",' + E_ + ')),0)', R.grossMargin, { bold: true, sum: true, fmt: PCT });

    /* 8 desired profit */
    var pf = sheet(wb, SH.profit, 'רווח רצוי: מהרווח למחזור, בשנה', [32, 16, 14]), A = R.annual, T = q(SH.tax), LB = q(SH.labor);
    var row = function (i, label, f, res, o) { o = o || {}; put(pf, 'A' + i, label, { bold: o.bold, sum: o.bold }); fx(pf, 'B' + i, f, res, { bold: o.bold, sum: o.bold, fmt: NUM0 }); };
    row(3, 'רווח נקי ביד', T + 'B' + tNet + '*12', A.net, { bold: true });
    row(4, 'מיסים', T + 'B' + tTotal + '*12', A.taxes);
    row(5, 'רווח לפני מס', 'B3+B4', A.preTax, { bold: true });
    row(7, 'קרן השתלמות', LB + 'B5*12', A.fund);
    row(8, 'פנסיה', LB + 'B4*12', A.pension);
    row(9, 'שכר עובדים', '(' + LB + 'E' + mTotal + '+' + LB + 'G' + hTotal + ')*12', A.employees);
    row(10, 'הנהלה וכלליות', q(SH.overhead) + 'N' + adT, A.admin);
    row(11, 'שיווק ומכירות', q(SH.overhead) + 'N' + mkT, A.marketing);
    row(13, 'רווח גולמי דרוש', 'B5+SUM(B7:B11)', A.grossProfit, { bold: true });
    put(pf, 'A14', 'רווח גולמי ממוצע', {}); fx(pf, 'B14', q(SH.list) + 'B' + avg, R.grossMargin, { fmt: PCT });
    row(15, 'עלות מכר', 'B16*(1-B14)', A.cogs || 0);
    row(16, 'המחזור הדרוש בשנה', 'IFERROR(B13/B14,0)', A.revenue || 0, { bold: true });
    row(18, 'הוצאות קבועות בשנה', 'SUM(B7:B11)+' + LB + 'B3*12', R.fixedAnnual);
    row(19, 'נקודת איזון בשנה', 'IFERROR(B18/B14,0)', R.breakEven || 0, { bold: true });

    /* 9 goals and plan */
    var g = sheet(wb, SH.goals, 'יעדים ותוכנית שנתית', [26, 12].concat(Array(12).fill(11)).concat([12]));
    put(g, 'A3', 'המחזור הדרוש בשנה', { bold: true, sum: true }); fx(g, 'B3', q(SH.profit) + 'B16', A.revenue || 0, { bold: true, sum: true, fmt: NUM0 });
    head(g, 5, ['מוצר', 'חלק מהמחזור', 'מחזור', 'מחיר נטו', 'מכירות בשנה', 'מכירות בחודש']);
    var BB = '$B$' + gFirst + ':$B$' + gLast;
    R.goals.forEach(function (x, i) {
      var rr = gFirst + i, src = S.products[i];
      fx(g, 'A' + rr, q(SH.list) + 'A' + (lFirst + i), x.name || 'מוצר ' + (i + 1), { bold: true });
      put(g, 'B' + rr, src.mix === '' || src.mix == null ? null : E.num(src.mix) / 100, { input: true, fmt: PCT });
      fx(g, 'C' + rr, 'IF(SUM(' + BB + ')>0,B' + rr + '/SUM(' + BB + '),' + (n === 1 ? '1' : '0') + ')*$B$3', x.turnover, { fmt: NUM0 });
      fx(g, 'D' + rr, q(SH.list) + 'B' + (lFirst + i), x.price, { fmt: NUM2 });
      fx(g, 'E' + rr, 'IFERROR(C' + rr + '/D' + rr + ',0)', x.unitsYear, { fmt: '#,##0.0' });
      fx(g, 'F' + rr, 'E' + rr + '/12', x.unitsMonth, { fmt: '#,##0.0' });
    });
    var calHead = gLast + 3;
    head(g, calHead, ['התוכנית השנתית', ''].concat(MONTHS).concat(['בשנה']));
    r = calHead + 1;
    [['מועדים מיוחדים', 'dates'], ['השקות', 'launches'], ['מבצעים', 'promos'], ['פוקוס חודשי', 'focus']].forEach(function (x) {
      put(g, 'A' + r, x[0], { bold: true });
      for (var k = 0; k < 12; k++) { var ce = put(g, col(k + 2) + r, S.plan[x[1]][k] || '', { input: true }); ce.alignment = { wrapText: true, vertical: 'top' }; }
      r++;
    });
    var uFirst = r;
    R.goals.forEach(function (x, i) {
      fx(g, 'A' + r, 'A' + (gFirst + i), x.name || 'מוצר ' + (i + 1), { bold: true });
      for (var k = 0; k < 12; k++) put(g, col(k + 2) + r, x.plan[k] || null, { input: true, fmt: NUM0 });
      fx(g, 'O' + r, 'SUM(C' + r + ':N' + r + ')', x.planned, { bold: true, fmt: NUM0 });
      r++;
    });
    var uLast = r - 1;
    if (n) {
      put(g, 'A' + r, 'מחזור נטו', { bold: true, sum: true });
      for (var k = 0; k < 12; k++) { var cl = col(k + 2); fx(g, cl + r, 'SUMPRODUCT(' + cl + uFirst + ':' + cl + uLast + ',$D$' + gFirst + ':$D$' + gLast + ')', R.plannedByMonth[k].revenue, { bold: true, sum: true, fmt: NUM0 }); }
      fx(g, 'O' + r, 'SUM(C' + r + ':N' + r + ')', R.plannedRevenue, { bold: true, sum: true, fmt: NUM0 });
    }
    return wb.xlsx.writeBuffer();
  }
  return { build: build };
});
