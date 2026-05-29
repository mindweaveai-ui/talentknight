// api/candidates.js — TalentKnight Vesper candidate search
// Strategy: broad keyword pass first (100 records), supplement with diversity
// pool if matches are thin, then send richest possible profiles to Claude.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const MASTER_BASE  = 'appnAnRSfB7bgIQVU';
  const MASTER_TABLE = 'tblRJLWMSOB9YEXUI';
  const F = {
    name:     'fld8k1UET3DWwJV3S',
    location: 'fldNx4IFaKgaOnNw3',
    role:     'fldwOPyq4vmWzEquB',
    company:  'fldJYcW9eWMMnFPDS',
    bio:      'fldtJGFbRDqFR9PPJ',
    skills:   'fldjzxELfOSU8M0dC',
    sector:   'fldQjqjDdx2oV4KqA',
    type:     'fldU5qaydUaqg8GxQ',
  };

  const { brief = '' } = req.body || {};
  const atHeaders = { Authorization: `Bearer ${AT_TOKEN}` };

  // --- Keyword extraction ---
  // Lean stopword list — keep domain terms like "crypto", "senior", "london"
  const stopwords = new Set([
    'with','that','this','have','from','they','will','been','were','their','there',
    'about','would','could','should','looking','seeking','need','want','hire','find',
    'recruit','ideal','good','great','level','years','year','experience','experienced',
    'someone','person','candidate','professional','team','work','based','must','also',
    'some','very','well','able','into','over','more','make','what','just','like',
  ]);

  // Keep up to 10 keywords, allow 3-char words (e.g. "DTC", "CFO", "ESG")
  const keywords = brief
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopwords.has(w))
    .slice(0, 10);

  let keywordRecords = [];
  let fallbackRecords = [];

  // --- Pass 1: keyword search across 6 fields, pull up to 100 ---
  if (keywords.length > 0) {
    const fieldChecks = keywords.map(kw => {
      const safe = kw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `OR(
        SEARCH("${safe}", LOWER(IF({${F.role}},     {${F.role}},     ""))),
        SEARCH("${safe}", LOWER(IF({${F.bio}},      {${F.bio}},      ""))),
        SEARCH("${safe}", LOWER(IF({${F.skills}},   {${F.skills}},   ""))),
        SEARCH("${safe}", LOWER(IF({${F.sector}},   {${F.sector}},   ""))),
        SEARCH("${safe}", LOWER(IF({${F.location}}, {${F.location}}, ""))),
        SEARCH("${safe}", LOWER(IF({${F.company}},  {${F.company}},  "")))
      )`;
    });
    const formula = `OR(${fieldChecks.join(',')})`;
    const url = `https://api.airtable.com/v0/${MASTER_BASE}/${MASTER_TABLE}`
      + `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&returnFieldsByFieldId=true`;
    try {
      const r = await fetch(url, { headers: atHeaders });
      const d = await r.json();
      if (r.ok && d.records) keywordRecords = d.records;
    } catch (_) {}
  }

  // --- Pass 2: if keyword matches are thin (<20), pull a diversity batch ---
  // We fetch a fresh unfiltered page and merge, deduplicating by record ID.
  // This ensures Claude always has at least 60 candidates to choose from.
  if (keywordRecords.length < 20) {
    const url = `https://api.airtable.com/v0/${MASTER_BASE}/${MASTER_TABLE}`
      + `?pageSize=100&returnFieldsByFieldId=true`;
    try {
      const r = await fetch(url, { headers: atHeaders });
      const d = await r.json();
      if (r.ok && d.records) fallbackRecords = d.records;
    } catch (err) {
      if (keywordRecords.length === 0) {
        return res.status(500).json({ error: 'Airtable fetch failed: ' + err.message });
      }
    }
  }

  // Merge and deduplicate — keyword matches stay first (they're more relevant)
  const seen = new Set(keywordRecords.map(r => r.id));
  const merged = [
    ...keywordRecords,
    ...fallbackRecords.filter(r => !seen.has(r.id)),
  ].slice(0, 100);

  // --- Shape records for Claude ---
  // Longer bio (400 chars) gives the AI more signal to work with
  const candidates = merged.map(r => {
    const f = r.fields;
    return {
      name:     String(f[F.name]     || 'Unknown').trim(),
      location: String(f[F.location] || '').trim(),
      role:     String(f[F.role]     || '').trim(),
      company:  String(f[F.company]  || '').trim(),
      bio:      String(f[F.bio]      || '').slice(0, 400).trim(),
      skills:   String(f[F.skills]   || '').trim(),
      sector:   String(f[F.sector]   || '').trim(),
      type:     String(f[F.type]     || '').trim(),
    };
  }).filter(c => c.name && c.name !== 'Unknown');

  return res.status(200).json({ candidates, count: candidates.length });
}
