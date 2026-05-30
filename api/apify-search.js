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
  const actorId = 'harvestapi~linkedin-profile-search';
  const apifyEndpoint = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=25&memory=256`;

  // Build input using the actor's native filters
  const actorInput = {
    profileScraperMode: 'Short',
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

  // HarvestAPI returns: firstName, lastName, headline, location, profileUrl, summary, skills, industry
  const candidates = (Array.isArray(raw) ? raw : [])
    .map(p => ({
      name:        ([p.firstName, p.lastName].filter(Boolean).join(' ') || p.fullName || '').trim(),
      role:        (p.headline || p.title || '').trim(),
      company:     (p.companyName || p.currentCompany || (p.positions && p.positions[0] && p.positions[0].companyName) || '').trim(),
      location:    (p.location || p.addressWithCountry || '').trim(),
      bio:         (p.summary || p.about || '').slice(0, 400).trim(),
      skills:      Array.isArray(p.skills) ? p.skills.slice(0, 10).join(', ') : (p.skills || ''),
      sector:      (p.industry || '').trim(),
      type:        'live',
      linkedinUrl: p.profileUrl || p.url || '',
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
