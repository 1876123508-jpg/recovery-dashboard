// Minimal CSV parser: handles quoted fields, commas inside quotes, CRLF.
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.some(f => f.trim() !== '')) rows.push(row); }
  if (rows.length === 0) return { headers: [], values: [] };
  return { headers: rows[0].map(h => h.trim()), values: rows.slice(1) };
}

export function rowsToObjects(headers, values) {
  return values.map(v => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (v[i] ?? '').toString().trim(); });
    return o;
  });
}