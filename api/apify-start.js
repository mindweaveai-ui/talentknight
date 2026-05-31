// api/apify-start.js — Start an Apify LinkedIn search run, return runId immediately
// Does NOT wait for results. Pair with /api/apify-poll to fetch results when ready.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN not configured' });

  const { brief = '' } = req.body || {};
  if (!brief.trim()) return res.status(200).json({ runId: null, reason: 'empty_brief' });

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

  const actorId = 'harvestapi~linkedin-profile-search';

  // Use Short mode — faster, cheaper, enough data for Vesper to rank
  // Short mode: name, headline, location, currentPosition, openToWork, profileUrl
  // Cost: $0.10/page only, no per-profile charge
  const actorInput = {
    profileScraperMode: 'Short',
    maxItems: 25,
  };
  if (title) actorInput.searchQuery = title;
  if (location) actorInput.locations = [location];
  if (title) actorInput.currentJobTitles = [title];

  // Start run async — returns immediately with runId, does NOT wait for completion
  const startUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_TOKEN}&memory=256`;

  try {
    const r = await fetch(startUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actorInput),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(200).json({ runId: null, reason: 'apify_start_failed', detail: errText.slice(0, 200) });
    }

    const data = await r.json();
    const runId = data?.data?.id;

    if (!runId) {
      return res.status(200).json({ runId: null, reason: 'no_run_id' });
    }

    return res.status(200).json({ runId, title, location });

  } catch (err) {
    return res.status(200).json({ runId: null, reason: 'fetch_error', detail: err.message });
  }
}
