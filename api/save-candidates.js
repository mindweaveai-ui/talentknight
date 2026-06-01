// api/save-candidates.js — Auto-save LinkedIn profiles from Apify into the Vesper talent pool
// Checks for duplicates by name, skips existing records, batch-creates new ones.
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

  const atHeaders = {
    Authorization: `Bearer ${AT_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const { candidates = [] } = req.body || {};
  if (!candidates.length) return res.status(200).json({ saved: 0, skipped: 0 });

  // Only process candidates with a name
  const valid = candidates.filter(c => c.name && c.name.trim());
  if (!valid.length) return res.status(200).json({ saved: 0, skipped: 0 });

  // Check which names already exist in Airtable to avoid duplicates
  // Build OR filter for all candidate names
  const nameFilters = valid.map(c => {
    const safe = c.name.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `{${F.name}} = '${safe}'`;
  });
  const formula = `OR(${nameFilters.join(',')})`;

  let existingNames = new Set();
  try {
    const checkUrl = `https://api.airtable.com/v0/${MASTER_BASE}/${MASTER_TABLE}`
      + `?filterByFormula=${encodeURIComponent(formula)}&fields[]=${F.name}&returnFieldsByFieldId=true`;
    const r = await fetch(checkUrl, { headers: atHeaders });
    const d = await r.json();
    if (r.ok && d.records) {
      d.records.forEach(rec => {
        const n = rec.fields[F.name];
        if (n) existingNames.add(n.trim().toLowerCase());
      });
    }
  } catch (e) {
    // If duplicate check fails, proceed anyway — Airtable won't crash on dupes
  }

  // Filter to only new candidates
  const toSave = valid.filter(c => !existingNames.has(c.name.trim().toLowerCase()));
  if (!toSave.length) return res.status(200).json({ saved: 0, skipped: valid.length });

  // Airtable batch create — max 10 per request
  const batches = [];
  for (let i = 0; i < toSave.length; i += 10) {
    batches.push(toSave.slice(i, i + 10));
  }

  let saved = 0;
  for (const batch of batches) {
    const records = batch.map(c => ({
      fields: {
        [F.name]:     c.name.trim(),
        [F.location]: c.location || '',
        [F.role]:     c.role || '',
        [F.company]:  c.company || '',
        [F.bio]:      (c.bio || '').slice(0, 400),
        [F.skills]:   Array.isArray(c.skills) ? c.skills.join(', ') : (c.skills || ''),
        [F.sector]:   c.sector || '',
        [F.type]:     'live',
      }
    }));

    try {
      const r = await fetch(`https://api.airtable.com/v0/${MASTER_BASE}/${MASTER_TABLE}`, {
        method: 'POST',
        headers: atHeaders,
        body: JSON.stringify({ records }),
      });
      const d = await r.json();
      if (r.ok) saved += (d.records || []).length;
    } catch (e) {
      // Continue with next batch even if one fails
    }
  }

  return res.status(200).json({ saved, skipped: valid.length - saved });
}
