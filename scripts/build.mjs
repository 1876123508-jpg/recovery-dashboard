// Build the recovery dashboard: fetch Feishu sheet -> aggregate -> render index.html.
// Usage:
//   node scripts/build.mjs                 (online: needs FEISHU_APP_ID/FEISHU_APP_SECRET env)
//   node scripts/build.mjs --csv file.csv  (offline test with a local CSV)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, rowsToObjects } from './csv.mjs';
import { detectColumns, aggregate } from './aggregate.mjs';
import { fetchRowsFromFeishu } from './feishu.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const csvIdx = argv.indexOf('--csv');

let headers, values, mapping;
if (csvIdx >= 0) {
  const csvPath = path.resolve(argv[csvIdx + 1]);
  const text = fs.readFileSync(csvPath, 'utf8');
  ({ headers, values } = parseCSV(text));
  console.log(`[offline] loaded ${values.length} rows from ${csvPath}`);
} else {
  ({ headers, values } = await fetchRowsFromFeishu(process.env));
  values = values.filter(v => v.some(c => String(c ?? '').trim() !== ''));
  console.log(`[online] loaded ${values.length} rows from Feishu`);
}

console.log('Headers:', JSON.stringify(headers));
mapping = detectColumns(headers);
console.log('Column mapping:', JSON.stringify(mapping));
const objects = rowsToObjects(headers, values);
const distinct = (arr) => [...new Set(arr.filter(x => String(x ?? '').trim() !== ''))].sort();
console.log('Distinct status values:', JSON.stringify(distinct(objects.map(o => o[mapping.status]))));
if (mapping.orderType) console.log('Distinct orderType values:', JSON.stringify(distinct(objects.map(o => o[mapping.orderType]))));
const data = aggregate(objects, mapping);

// diagnostics
const diag = data.diagnostics;
const unkStatus = Object.keys(diag.unknownStatus);
const unkOrder = Object.keys(diag.unknownOrderType);
if (unkStatus.length) console.log('WARN unknown status values:', JSON.stringify(diag.unknownStatus));
if (unkOrder.length) console.log('WARN unknown order-type values:', JSON.stringify(diag.unknownOrderType));
const missing = ['status','orderType','sku','date'].filter(f => !mapping[f]);
if (missing.length) console.log(`WARN columns not detected: ${missing.join(', ')} — adjust CANDIDATES in aggregate.mjs`);

console.log(`TOTAL=${data.total} Pending=${data.pending} InTransit=${data.inTransit} Delivered=${data.delivered}`);
console.log(`Order types: ToB=${data.tob} ToC=${data.toc} KOL=${data.kol}`);
console.log(`Weeks: ${data.weeks.length} (${data.weeks[0]} .. ${data.weeks[data.weeks.length-1]})`);

// ---- render ----
const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const rep = {
  '@@DEPLOY_DATE@@': data.dataDate,
  '@@YEAR@@': String(new Date(data.dataDate).getFullYear()),
  '@@TOTAL_FMT@@': data.totalFmt,
  '@@DATA_DATE@@': data.dataDate,
  '@@DATA_WEEK@@': data.dataWeek,
  '@@KPI_PENDING@@': data.pendingFmt,
  '@@KPI_PENDING_PCT@@': data.pendingPct,
  '@@KPI_TRANSIT@@': data.transitFmt,
  '@@KPI_TRANSIT_PCT@@': data.transitPct,
  '@@KPI_DELIVERED@@': data.deliveredFmt,
  '@@KPI_DELIVERED_PCT@@': data.deliveredPct,
  '@@SKU_BY_STATUS@@': JSON.stringify(data.skuByStatus),
  '@@ORDER_TYPE_COUNT@@': JSON.stringify(data.orderTypeCount),
  '@@WEEKS@@': JSON.stringify(data.weeks),
  '@@PENDING_WEEKLY@@': JSON.stringify(data.pendingWeeklyBySku),
  '@@PENDING@@': String(data.pending),
  '@@TRANSIT@@': String(data.inTransit),
  '@@DELIVERED@@': String(data.delivered),
  '@@TOTAL_NUM@@': String(data.total),
  '@@ORDER_TOTAL@@': String(data.orderTotal),
  '@@TOC@@': String(data.toc),
  '@@TOB@@': String(data.tob),
  '@@KOL@@': String(data.kol),
};
let html = template;
for (const [k, v] of Object.entries(rep)) html = html.split(k).join(v);
const leftover = html.match(/@@[A-Z_]+@@/g) || [];
if (leftover.length) throw new Error(`Unreplaced markers: ${leftover.join(', ')}`);

const outPath = path.join(ROOT, 'index.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Wrote ${outPath} (${html.length} bytes)`);