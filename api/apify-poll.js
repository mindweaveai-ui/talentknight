// api/apify-poll.js — Poll Apify run, return candidates, save new ones directly to Airtable
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const AT_TOKEN    = process.env.AT_TOKEN;
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN not configured' });

  const { runId } = req.query;
  if (!runId) return res.status(400).json({ error: 'runId is required' });

  // Check run status
  const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`;
  let status;
  try {
    const r = await fetch(statusUrl);
    if (!r.ok) return res.status(200).json({ status: 'ERROR', reason: 'status_fetch_failed' });
    const data = await r.json();
    status = data?.data?.status;
  } catch (err) {
    return res.status(200).json({ status: 'ERROR', reason: err.message });
  }

  if (status === 'RUNNING' || status === 'READY' || status === 'CREATED') {
    return res.status(200).json({ status: 'RUNNING' });
  }
  if (status !== 'SUCCEEDED') {
    return res.status(200).json({ status: 'FAILED', reason: status });
  }

  // Fetch dataset results
  const datasetUrl = `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=25`;
  let raw = [];
  try {
    const r = await fetch(datasetUrl);
    if (!r.ok) return res.status(200).json({ status: 'FAILED', reason: 'dataset_fetch_failed' });
    raw = await r.json();
  } catch (err) {
    return res.status(200).json({ status: 'FAILED', reason: err.message });
  }

  function str(v) {
    if (!v) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object') {
      return (v.full || v.city || v.country || Object.values(v).filter(x => typeof x === 'string').join(', ')).trim();
    }
    return String(v).trim();
  }

  const candidates = (Array.isArray(raw) ? raw : [])
    .map(p => ({
      name:        str([p.firstName, p.lastName].filter(Boolean).join(' ') || p.fullName || ''),
      role:        str(p.headline || p.title || ''),
      company:     str(p.companyName || p.currentCompany || (p.currentPosition?.[0]?.companyName) || ''),
      location:    str(p.location || p.addressWithCountry || ''),
      bio:         str(p.summary || p.about || '').slice(0, 400),
      skills:      Array.isArray(p.skills) ? p.skills.slice(0, 10).join(', ') : str(p.skills),
      sector:      str(p.industry || ''),
      openToWork:  Boolean(p.openToWork),
      type:        'live',
      linkedinUrl: str(p.profileUrl || p.linkedinUrl || p.url || ''),
    }))
    .filter(c => c.name);

  // Save new profiles directly to Airtable (no internal HTTP call)
  if (candidates.length > 0 && AT_TOKEN) {
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

    // Check for existing names to avoid duplicates
    try {
      const nameFilters = candidates.map(c => {
        const safe = c.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `{${F.name}} = '${safe}'`;
      });
      const formula = `OR(${nameFilters.join(',')})`;
      const checkUrl = `https://api.airtable.com/v0/${MASTER_BASE}/${MASTER_TABLE}`
        + `?filterByFormula=${encodeURIComponent(formula)}&fields[]=${F.name}&returnFieldsByFieldId=true`;
      const checkR = await fetch(checkUrl, { headers: atHeaders });
      const checkD = await checkR.json();
      const existingNames = new Set(
        (checkD.records || []).map(r => (r.fields[F.name] || '').trim().toLowerCase())
      );

      const toSave = candidates.filter(c => !existingNames.has(c.name.trim().toLowerCase()));

      // Batch create in groups of 10
      for (let i = 0; i < toSave.length; i += 10) {
        const batch = toSave.slice(i, i + 10);
        const records = batch.map(c => ({
          fields: {
            [F.name]:     c.name.trim(),
            [F.location]: c.location || '',
            [F.role]:     c.role || '',
            [F.company]:  c.company || '',
            [F.bio]:      (c.bio || '').slice(0, 400),
            [F.skills]:   c.skills || '',
            [F.sector]:   c.sector || '',
            [F.type]:     'LinkedIn',
          }
        }));
        await fetch(`https://api.airtable.com/v0/${MASTER_BASE}/${MASTER_TABLE}`, {
          method: 'POST',
          headers: atHeaders,
          body: JSON.stringify({ records, typecast: true }),
        });
      }
    } catch (e) {
      // Save failure should never block the response
    }
  }

  return res.status(200).json({ status: 'SUCCEEDED', candidates, count: candidates.length });
}
