// Feishu (Lark) Open Platform client — no external dependencies (Node >= 18).
// Used by build.mjs; all config comes from environment variables / args.

const BASE = 'https://open.feishu.cn/open-apis';

async function jfetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Feishu API ${res.status} for ${url}: ${text.slice(0, 400)}`);
  }
  return body;
}

export async function getTenantToken(appId, appSecret) {
  const body = await jfetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  if (body.code !== 0) throw new Error(`tenant_access_token failed: ${JSON.stringify(body)}`);
  return body.tenant_access_token;
}

// Resolve a wiki node token to the real object (spreadsheet / bitable) token.
export async function resolveWikiNode(token, tenantToken) {
  const body = await jfetch(`${BASE}/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`, {
    headers: { Authorization: `Bearer ${tenantToken}` }
  });
  if (body.code !== 0) throw new Error(`wiki get_node failed: ${JSON.stringify(body)}`);
  const node = body.data.node;
  if (!node) throw new Error(`wiki node not found: ${token}`);
  return { objToken: node.obj_token, objType: node.obj_type };
}

// Sheet metadata: find the tab's row/column counts.
export async function getSheetMeta(spreadsheetToken, sheetId, tenantToken) {
  const body = await jfetch(`${BASE}/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/metainfo`, {
    headers: { Authorization: `Bearer ${tenantToken}` }
  });
  if (body.code !== 0) throw new Error(`sheets metainfo failed: ${JSON.stringify(body)}`);
  const sheet = (body.data.sheets || []).find(s => s.sheetId === sheetId);
  if (!sheet) throw new Error(`sheetId ${sheetId} not found in spreadsheet`);
  return { rowCount: sheet.rowCount, columnCount: sheet.columnCount, title: sheet.title };
}

// Read all values of a sheet tab with adaptive row batching (a single
// response is capped at ~10MB -> error 90221, so shrink the chunk on failure).
export async function getSheetValues(spreadsheetToken, sheetId, tenantToken, rowCount) {
  const all = [];
  let chunk = 1000;
  let start = 1;
  const total = rowCount || 500000;
  while (start <= total) {
    const end = Math.min(start + chunk - 1, total);
    const range = `${sheetId}!A${start}:ZZ${end}`;
    const url = `${BASE}/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(range)}?valueRenderOption=ToString&dateTimeRenderOption=FormattedString`;
    let body;
    try {
      body = await jfetch(url, { headers: { Authorization: `Bearer ${tenantToken}` } });
    } catch (e) {
      if (e.message.includes('90221') && chunk > 50) { chunk = Math.floor(chunk / 2); continue; }
      throw e;
    }
    if (body.code !== 0) throw new Error(`sheets read failed (${range}): ${JSON.stringify(body)}`);
    const vr = body.data && body.data.valueRange;
    const values = (vr && vr.values) || [];
    if (values.length === 0) break;
    all.push(...values);
    if (end >= total || values.length < chunk) break;
    start = end + 1;
  }
  if (!all.length) throw new Error('sheet returned no values');
  return all;
}

// Full pipeline: env -> rows.
// env: FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_WIKI_TOKEN (or FEISHU_SPREADSHEET_TOKEN), FEISHU_SHEET_ID
export async function fetchRowsFromFeishu(env) {
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET are required');
  const tenantToken = await getTenantToken(appId, appSecret);
  let spreadsheetToken = env.FEISHU_SPREADSHEET_TOKEN;
  if (!spreadsheetToken) {
    const wikiToken = env.FEISHU_WIKI_TOKEN;
    if (!wikiToken) throw new Error('FEISHU_WIKI_TOKEN or FEISHU_SPREADSHEET_TOKEN is required');
    const { objToken, objType } = await resolveWikiNode(wikiToken, tenantToken);
    spreadsheetToken = objToken;
    console.log(`Resolved wiki node -> obj_type=${objType} obj_token=${objToken}`);
  }
  const sheetId = env.FEISHU_SHEET_ID || 'zXC4uk';
  const meta = await getSheetMeta(spreadsheetToken, sheetId, tenantToken);
  console.log(`Sheet meta: title="${meta.title}" rows=${meta.rowCount} cols=${meta.columnCount}`);
  const values = await getSheetValues(spreadsheetToken, sheetId, tenantToken, meta.rowCount);
  const headers = values[0].map(h => String(h ?? '').trim());
  return { headers, values: values.slice(1) };
}