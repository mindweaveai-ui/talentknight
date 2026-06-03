// api/apify-start.js — Start an Apify LinkedIn search run, return runId immediately
// Accepts pre-parsed brief params from /api/parse-brief, falls back to raw brief regex
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN not configured' });

  const { brief = '', parsed } = req.body || {};
  if (!brief.trim() && !parsed) return res.status(200).json({ runId: null, reason: 'empty_brief' });

  // Use Claude-parsed params if available, otherwise fall back to regex
  let title = '';
  let location = '';

  if (parsed?.title) {
    title = parsed.title;
    location = parsed.location || '';
  } else {
    const locationMatch = brief.match(
      /\b(?:based in|located in|in|near|around)\s+([A-Z][a-zA-Z\s\-]+?)(?:\s*,|\s+and\b|\s+with\b|\s*\.|\s*$)/i
    );
    location = locationMatch ? locationMatch[1].trim() : '';

    const titleMatch = brief.match(
      /\b(CEO|CFO|CTO|COO|CMO|CPO|CHRO|CIO|CISO|CCO|VP\s+\w+|Vice President|Director(?:\s+of\s+\w+)?|Head of\s+\w+|General Manager|Managing Director|MD|Partner|Principal|Manager|Lead|Senior\s+\w+|Engineer|Developer|Designer|Analyst|Architect|Consultant|Advisor|Recruiter|Talent\s+\w+)\b/i
    );
    title = titleMatch ? titleMatch[1].trim() : '';
  }

  // UK-specific locations — append "United Kingdom" to avoid Apify returning US results
  // e.g. "Essex" → "Essex, United Kingdom" (avoids Essex, Maryland USA)
  const ukLocations = new Set([
    'essex','london','manchester','birmingham','leeds','liverpool','sheffield',
    'bristol','cardiff','edinburgh','glasgow','belfast','nottingham','leicester',
    'coventry','hull','bradford','stoke','wolverhampton','derby','reading',
    'northampton','luton','portsmouth','southampton','oxford','cambridge',
    'norwich','swindon','exeter','brighton','milton keynes','york','bath',
    'worcester','cheltenham','gloucester','ipswich','swansea','dundee','aberdeen',
  ]);

  if (location && ukLocations.has(location.toLowerCase()) && !location.toLowerCase().includes('united kingdom')) {
    location = `${location}, United Kingdom`;
  }

  const actorId = 'harvestapi~linkedin-profile-search';

  const actorInput = {
    profileScraperMode: 'Short',
    maxItems: 25,
  };
  if (title) actorInput.searchQuery = title;
  if (location) actorInput.locations = [location];
  if (title) actorInput.currentJobTitles = [title];

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
