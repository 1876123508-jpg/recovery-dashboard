// ---------------------------------------------------------------------------
// Column auto-detection + aggregation for the recovery dashboard.
// The real sheet header is still unknown; detection is fuzzy and the build
// log prints what it found so the mapping can be verified/adjusted.
// ---------------------------------------------------------------------------

const norm = s => String(s || '').trim().toLowerCase().replace(/[\s_\-（）()]/g, '');

// Candidate header names per logical field (Chinese first, then English).
const CANDIDATES = {
  status: ['状态', '物流状态', '回收状态', '订单状态', '当前状态', 'status', 'logisticsstatus', 'orderstatus'],
  orderType: ['订单类型', '渠道', '客户类型', '销售渠道', 'ordertype', 'order_type', 'channel', 'customertype'],
  sku: ['sku', '产品', '机型', '产品型号', '部件', '品名', 'model', 'product', 'part'],
  date: ['回收记录生成时间', '创建时间', '下单时间', '创建日期', '回收日期', '回收时间', '日期', '时间', '更新时间', '最近更新时间', 'date', 'createdat', 'createtime', 'createdate', 'updatedat']
};

export function detectColumns(headers) {
  const normHeaders = headers.map(h => norm(h));
  const found = {};
  for (const [field, cands] of Object.entries(CANDIDATES)) {
    for (const c of cands) {
      const idx = normHeaders.indexOf(norm(c));
      if (idx >= 0) { found[field] = headers[idx]; break; }
    }
  }
  return found;
}

export function normalizeStatus(v) {
  const s = norm(v);
  if (!s) return '';
  if (/pending|待回收|待|未回收|未完成/.test(s)) return 'Pending';
  if (/intransit|transit|在途|运输|配送中|派送/.test(s)) return 'InTransit';
  if (/delivered|已回收|已完成|完成|签收|妥投/.test(s)) return 'Delivered';
  return `UNKNOWN(${v})`;
}

export function normalizeOrderType(v) {
  const s = norm(v);
  if (!s) return 'toc';
  if (/tob|b2b|企业|公司|批发|机构/.test(s)) return 'tob';
  if (/kol|达人|博主/.test(s)) return 'kol';
  if (/toc|c2c|个人|零售|消费者|woo|shopline|amazon/.test(s)) return 'toc';
  return 'toc'; // default bucket; unknown values are logged by the caller
}

// Parse common date strings (and Excel serial numbers) to a Date.
export function parseDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})/); // 20260630
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  if (/^\d+(\.\d+)?$/.test(s)) { // Excel serial
    const n = parseFloat(s);
    if (n > 20000 && n < 60000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  }
  return null;
}

export function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Monday of the ISO week key "YYYY-Www".
function weekStart(key) {
  const [y, w] = key.split('-W').map(x => parseInt(x, 10));
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const day = (jan4.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + (w - 1) * 7);
  return monday;
}

// Contiguous ISO weeks from min to max (matches the original W02..W27 axis).
function contiguousWeeks(weekSet) {
  if (!weekSet.size) return [];
  const keys = [...weekSet].sort();
  const out = [];
  for (let d = weekStart(keys[0]); d <= weekStart(keys[keys.length - 1]); d.setUTCDate(d.getUTCDate() + 7)) {
    out.push(isoWeek(d));
  }
  return out;
}

const fmt = n => n.toLocaleString('en-US');
const fmt1 = n => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function aggregate(objects, mapping, runDate = new Date()) {
  let total = 0, pending = 0, inTransit = 0, delivered = 0;
  const skuByStatus = { Pending: {}, InTransit: {}, Delivered: {} };
  const orderCounts = { tob: 0, kol: 0, toc: 0 };
  const unknownStatus = {};
  const unknownOrderType = {};
  const pendingWeekly = {};   // week -> sku -> count
  const pendingRows = [];

  const get = (o, field) => (mapping[field] ? o[mapping[field]] : '');

  for (const o of objects) {
    total++;
    const st = normalizeStatus(get(o, 'status'));
    const ot = normalizeOrderType(get(o, 'orderType'));
    const sku = get(o, 'sku') || 'unknown';
    if (st === 'Pending') { pending++; skuByStatus.Pending[sku] = (skuByStatus.Pending[sku] || 0) + 1; }
    else if (st === 'InTransit') { inTransit++; skuByStatus.InTransit[sku] = (skuByStatus.InTransit[sku] || 0) + 1; }
    else if (st === 'Delivered') { delivered++; skuByStatus.Delivered[sku] = (skuByStatus.Delivered[sku] || 0) + 1; }
    else { unknownStatus[st] = (unknownStatus[st] || 0) + 1; continue; }

    if (st !== 'Delivered') {
      if (orderCounts[ot] !== undefined) orderCounts[ot]++;
      else unknownOrderType[get(o, 'orderType')] = (unknownOrderType[get(o, 'orderType')] || 0) + 1;
    }
    if (st === 'Pending') {
      const d = parseDate(get(o, 'date'));
      if (d && d.getFullYear() === runDate.getFullYear()) { // weekly trend is year-scoped
        const wk = isoWeek(d);
        pendingRows.push({ wk, sku });
        pendingWeekly[wk] = pendingWeekly[wk] || {};
        pendingWeekly[wk][sku] = (pendingWeekly[wk][sku] || 0) + 1;
      }
    }
  }

  // weeks: contiguous range over weeks present in pending data (incl. run week)
  const weekSet = new Set(Object.keys(pendingWeekly));
  weekSet.add(isoWeek(runDate));
  const weeks = contiguousWeeks(weekSet);

  // pendingWeeklyBySku: { sku: { week: count } }
  const pendingWeeklyBySku = {};
  for (const { wk, sku } of pendingRows) {
    pendingWeeklyBySku[sku] = pendingWeeklyBySku[sku] || {};
    pendingWeeklyBySku[sku][wk] = (pendingWeeklyBySku[sku][wk] || 0) + 1;
  }

  const y = runDate.getFullYear();
  const mm = String(runDate.getMonth() + 1).padStart(2, '0');
  const dd = String(runDate.getDate()).padStart(2, '0');
  const dataDate = `${y}-${mm}-${dd}`;
  const shortWeek = isoWeek(runDate).replace(`${y}-`, '');

  const pct = (n) => (total > 0 ? (n / total * 100).toFixed(1) : '0.0');

  return {
    total, pending, inTransit, delivered,
    pendingPct: pct(pending), transitPct: pct(inTransit), deliveredPct: pct(delivered),
    totalFmt: fmt(total), pendingFmt: fmt1(pending), transitFmt: fmt1(inTransit), deliveredFmt: fmt1(delivered),
    skuByStatus,
    orderTypeCount: { tob: orderCounts.tob, kol: orderCounts.kol, toc: orderCounts.toc },
    tob: orderCounts.tob, kol: orderCounts.kol, toc: orderCounts.toc,
    orderTotal: orderCounts.tob + orderCounts.kol + orderCounts.toc,
    weeks,
    pendingWeeklyBySku,
    dataDate, dataWeek: shortWeek,
    diagnostics: { unknownStatus, unknownOrderType, mapping }
  };
}