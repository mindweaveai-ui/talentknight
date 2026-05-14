// api/candidates.js — TalentKnight real candidate search
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

  const stopwords = new Set([
    'with','that','this','have','from','they','will','been','were','their','there',
    'about','would','could','should','looking','seeking','need','want','hire','find',
    'recruit','role','position','ideal','strong','good','great','senior','junior',
    'level','years','year','experience','experienced','background','someone','person',
    'candidate','professional','skilled','team','company','business','work','based',
    'must','also','some','very','well','able','into','over','more','make','what',
  ]);

  const keywords = brief
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w))
    .slice(0, 6);

  const atHeaders = { Authorization: `Bearer ${AT_TOKEN}` };
  let records = [];

  if (keywords.length > 0) {
    const fieldChecks = keywords.map(kw => {
      const safe = kw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `OR(
        SEARCH("${safe}", LOWER(IF({${F.role}},     {${F.role}},     ""))),
        SEARCH("${safe}", LOWER(IF({${F.bio}},      {${F.bio}},      ""))),
        SEARCH("${safe}", LOWER(IF({${F.skills}},   {${F.skills}},   ""))),
        SEARCH("${safe}", LOWER(IF({${F.sector}},   {${F.sector}},   ""))),
        SEARCH("${safe}", LOWER(IF({${F.location}}, {${F.location}}, "")))
      )`;
    });
    const formula = `OR(${fieldChecks.join(',')})`;
    const url = `https://api.airtable.com/v0/${MASTER_BASE}/${MASTER_TABLE}`
      + `?filterByFormula=${encodeURIComponent(formula)}&pageSize=50&returnFieldsByFieldId=true`;
    try {
      const r = await fetch(url, { headers: atHeaders });
      const d = await r.json();
      if (r.ok && d.records) records = d.records;
    } catch (_) {}
  }

  if (records.length < 5) {
    const url = `https://api.airtable.com/v0/${MASTER_BASE}/${MASTER_TABLE}?pageSize=50&returnFieldsByFieldId=true`;
    try {
      const r = await fetch(url, { headers: atHeaders });
      const d = await r.json();
      if (r.ok && d.records) records = d.records;
    } catch (err) {
      return res.status(500).json({ error: 'Airtable fetch failed: ' + err.message });
    }
  }

  const candidates = records.map(r => {
    const f = r.fields;
    return {
      name:     String(f[F.name]     || 'Unknown').trim(),
      location: String(f[F.location] || '').trim(),
      role:     String(f[F.role]     || '').trim(),
      company:  String(f[F.company]  || '').trim(),
      bio:      String(f[F.bio]      || '').slice(0, 250).trim(),
      skills:   String(f[F.skills]   || '').trim(),
      sector:   String(f[F.sector]   || '').trim(),
      type:     String(f[F.type]     || '').trim(),
    };
  }).filter(c => c.name && c.name !== 'Unknown');

  return res.status(200).json({ candidates, count: candidates.length });
}