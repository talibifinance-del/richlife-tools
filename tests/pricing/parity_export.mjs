// Builds the client Excel from a sample state, then checks that every formula recalculated in an independent
// engine (HyperFormula) equals the value the file carries, and that key cells equal engine.js.
// Usage: NODE_MODULES=<dir> PY=python3 node tests/pricing/parity_export.mjs <workdir> <dump_xlsx.py>
import { createRequire } from 'module';
import fs from 'fs';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const NM = process.env.NODE_MODULES;
const ExcelJS = require(NM + '/exceljs');
const { HyperFormula } = require(NM + '/hyperformula');
const Engine = require('../../pricing/engine.js');
const Export = require('../../pricing/export-xlsx.js');
const [work, dumpPy] = process.argv.slice(2);
const months = v => Array(12).fill(v);
const base = (over = {}) => Object.assign({
  biz: { name: 'בדיקה', type: 'murshe', wastePct: 10, contingencyPct: 15, vatPct: 18, feePct: 1.35 },
  materials: [{ id: 'm1', name: 'בד', unit: 'מטר', pack: 12, cost: 240 }, { id: 'm2', name: 'בד', unit: 'חבילה', pack: 1, cost: 18 }],
  products: [
    { id: 'p1', name: 'שמלה', lines: [{ mat: 'm1', qty: 3 }, { mat: 'm2', qty: 1 }, { mat: '', qty: 2 }], hours: 2, specific: 10, marginPct: 30, market: 800, chosen: '', mix: 60, plan: months(4) },
    { id: 'p2', name: 'ייעוץ', lines: [], hours: 1.5, specific: '', marginPct: 45, market: '', chosen: 900, mix: 40, plan: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }
  ],
  labor: { net: 15000, pension: 1000, fund: 700, hours: 160, monthly: [{ name: 'א', role: 'ב', gross: 8000, factor: 1.35, hours: 120 }], hourly: [{ name: 'ג', role: '', rate: 55, hours: 40, factor: '' }] },
  overhead: { marketing: [{ name: 'פרסום', m: months(1000) }], admin: [{ name: 'שכ"ד', m: months(2500) }, { name: 'ביטוח', m: [1200, '', '', '', '', '', '', '', '', '', '', ''] }] },
  tax: { points: 2.75, saving: 2000, tables: null },
  plan: { dates: months('מועד'), launches: months(''), promos: months(''), focus: months('') }
}, over);
const cases = {
  full: base(),
  patur: (() => { const s = base(); s.biz.type = 'patur'; return s; })(),
  service: base({ materials: [], products: [{ id: 'p', name: 'שירות', lines: [], hours: 3, marginPct: 25, mix: '', plan: months('') }], labor: { net: 9000, pension: '', fund: '', hours: 120, monthly: [], hourly: [] }, overhead: { marketing: [], admin: [{ name: 'כללי', m: months(800) }] }, tax: { points: 2.75, saving: '' } }),
  high: (() => { const s = base(); s.labor.net = 90000; s.tax.points = 0; return s; })(),
  empty: base({ materials: [], products: [], labor: { net: '', pension: '', fund: '', hours: '', monthly: [], hourly: [] }, overhead: { marketing: [], admin: [] }, tax: { points: '', saving: '' } })
};
function colNum(c) { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
let pass = 0, fail = 0;
for (const [name, state] of Object.entries(cases)) {
  const file = `${work}/export-${name}.xlsx`, json = file + '.json';
  fs.writeFileSync(file, Buffer.from(await Export.build(state, Engine, ExcelJS)));
  execFileSync(process.env.PY || 'python3', ['-I', dumpPy, file, json, '--cached']);
  const { formulas: wb, cached } = JSON.parse(fs.readFileSync(json, 'utf8'));
  const sheets = {};
  for (const [sn, cells] of Object.entries(wb)) {
    const arr = [];
    for (const [ref, v] of Object.entries(cells)) { const m = ref.match(/^([A-Z]+)(\d+)$/); const r = +m[2] - 1, c = colNum(m[1]); while (arr.length <= r) arr.push([]); arr[r][c] = v; }
    for (const row of arr) for (let c = 0; c < row.length; c++) if (row[c] === undefined) row[c] = null;
    sheets[sn] = arr;
  }
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const val = (sn, ref) => { const m = ref.match(/^([A-Z]+)(\d+)$/); return hf.getCellValue({ sheet: hf.getSheetId(sn), row: +m[2] - 1, col: colNum(m[1]) }); };
  let formulas = 0, bad = 0;
  for (const [sn, cells] of Object.entries(wb)) for (const [ref, v] of Object.entries(cells)) {
    if (typeof v !== 'string' || !v.startsWith('=')) continue;
    formulas++;
    const got = val(sn, ref), want = cached[sn][ref];
    const same = typeof got === 'number' ? Math.abs(got - (want || 0)) < 0.01 : (got == null ? (want == null || want === 0 || want === '') : (typeof got === 'object' ? false : String(got) === String(want == null ? '' : want)));
    if (!same) { bad++; if (bad < 12) console.log(`DIFF ${name} ${sn}!${ref} recalculated=${JSON.stringify(got)} carried=${JSON.stringify(want)} ${v.slice(0, 70)}`); }
  }
  const R = Engine.compute(state);
  const key = (label, got, want) => { if (typeof got === 'number' && Math.abs(got - want) < 0.02) pass++; else { fail++; console.log('KEY', name, label, got, want); } };
  key('revenue', val('רווח רצוי', 'B16'), R.annual.revenue || 0);
  key('break-even', val('רווח רצוי', 'B19'), R.breakEven || 0);
  key('net', val('רווח רצוי', 'B3'), R.annual.net);
  console.log(`${name}: ${formulas} formulas, ${bad} differ`);
  if (bad) fail++; else pass++;
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
