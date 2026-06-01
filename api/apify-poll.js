// api/apify-poll.js — Poll an Apify run for completion, return normalised candidates, auto-save to Airtable
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;
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

  // Still running — tell frontend to keep polling
  if (status === 'RUNNING' || status === 'READY' || status === 'CREATED') {
    return res.status(200).json({ status: 'RUNNING' });
  }

  // Failed
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

  // Auto-save new profiles to Airtable in the background (fire and forget)
  if (candidates.length > 0) {
    const host = req.headers.host || 'talentknight.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    fetch(`${protocol}://${host}/api/save-candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates }),
    }).catch(() => {});
  }

  return res.status(200).json({ status: 'SUCCEEDED', candidates, count: candidates.length });
}
