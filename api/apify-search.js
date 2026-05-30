// api/apify-search.js — Vesper live LinkedIn candidate search via Apify
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN not configured' });

  const { brief = '' } = req.body || {};
  if (!brief.trim()) return res.status(200).json({ candidates: [], count: 0 });

  // Extract location from brief
  const locationMatch = brief.match(
    /\b(?:based in|located in|in|near|around)\s+([A-Z][a-zA-Z\s\-]+?)(?:\s*,|\s+and\b|\s+with\b|\s*\.|\s*$)/i
  );
  const location = locationMatch ? locationMatch[1].trim() : '';

  // Extract job title from brief
  const titleMatch = brief.match(
    /\b(CEO|CFO|CTO|COO|CMO|CPO|CHRO|CIO|CISO|CCO|VP\s+\w+|Vice President|Director(?:\s+of\s+\w+)?|Head of\s+\w+|General Manager|Managing Director|MD|Partner|Principal|Manager|Lead|Senior\s+\w+|Engineer|Developer|Designer|Analyst|Architect|Consultant|Advisor|Recruiter|Talent\s+\w+)\b/i
  );
  const title = titleMatch ? titleMatch[1].trim() : '';

  // harvestapi/linkedin-profile-search — no cookies required, 19K users, 4.5 stars
  // Full mode: ~$0.10/search page + $0.004/profile — gives headline, skills, industry
  const actorId = 'harvestapi~linkedin-profile-search';
  const apifyEndpoint = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=25&memory=256`;

  const actorInput = {
    profileScraperMode: 'Full',
    maxItems: 3,
  };
  if (title) actorInput.searchQuery = title;
  if (location) actorInput.locations = [location];
  if (title) actorInput.currentJobTitles = [title];

  let raw = [];
  let debugInfo = { actorInput };

  try {
    const r = await fetch(apifyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actorInput),
    });

    debugInfo.status = r.status;
    debugInfo.statusText = r.statusText;
    const responseText = await r.text();
    debugInfo.rawResponse = responseText.slice(0, 500);

    if (!r.ok) {
      return res.status(200).json({ candidates: [], count: 0, source: 'apify_error', debug: debugInfo });
    }

    try { raw = JSON.parse(responseText); } catch(e) { debugInfo.parseError = e.message; }
  } catch (err) {
    return res.status(200).json({ candidates: [], count: 0, source: 'apify_error', debug: { fetchError: err.message } });
  }

  // Helper: safely extract a string from a field that might be an object or string
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
      company:     str(p.companyName || p.currentCompany || (p.positions && p.positions[0] && p.positions[0].companyName) || ''),
      location:    str(p.location || p.addressWithCountry || ''),
      bio:         str(p.summary || p.about || '').slice(0, 400),
      skills:      Array.isArray(p.skills) ? p.skills.slice(0, 10).join(', ') : str(p.skills),
      sector:      str(p.industry || ''),
      type:        'live',
      linkedinUrl: str(p.profileUrl || p.url || ''),
    }))
    .filter(c => c.name);

  return res.status(200).json({
    candidates,
    count: candidates.length,
    source: candidates.length > 0 ? 'apify' : 'apify_empty',
    title,
    location,
    debug: debugInfo,
  });
}
