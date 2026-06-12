// api/apify-enrich.js — Enrich a single shortlisted candidate with full LinkedIn
// profile detail via harvestapi/linkedin-profile-scraper ("Profile details", $4/1k).
//
// Intended use: called for candidates the recruiter has shortlisted (NOT the full
// search results list), to populate the Candidate Snapshot Card fields that the
// search/poll endpoints don't return — tenure in current role, certifications,
// and education. Salary, salary expectations and notice period are NOT obtainable
// from LinkedIn via any scraper and are out of scope for this endpoint.
//
// NOTE: field names below (experience/education/certifications/skills) are based
// on HarvestAPI's documented profile shape and may need small adjustments once
// tested against a real response — run one sample candidate through and compare
// `debug.rawResponse` before wiring this into the UI.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN not configured' });

  const { linkedinUrl = '' } = req.body || {};
  if (!linkedinUrl.trim()) return res.status(200).json({ enriched: null, reason: 'no_url' });

  // harvestapi/linkedin-profile-scraper — full profile detail (experience, education, certifications)
  // "Profile details" mode = $4/1000 (no email lookup — cheaper, and we don't need email here)
  const actorId = 'harvestapi~linkedin-profile-scraper';
  const apifyEndpoint = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=60&memory=256`;

  const actorInput = {
    profileScraperMode: 'Profile details no email ($4 per 1k)',
    urls: [linkedinUrl.trim()],
  };

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
    debugInfo.rawResponse = responseText.slice(0, 1000);

    if (!r.ok) {
      return res.status(200).json({ enriched: null, source: 'apify_error', debug: debugInfo });
    }

    try { raw = JSON.parse(responseText); } catch (e) { debugInfo.parseError = e.message; }
  } catch (err) {
    return res.status(200).json({ enriched: null, source: 'apify_error', debug: { fetchError: err.message } });
  }

  const profile = Array.isArray(raw) ? raw[0] : null;
  if (!profile) {
    return res.status(200).json({ enriched: null, source: 'apify_empty', debug: debugInfo });
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

  // Experience can come back under different keys depending on actor version
  const experience = profile.experience || profile.positions || profile.workExperience || [];

  // Compute tenure in current role from the most recent experience entry with no end date
  // (i.e. the role still in progress). Falls back to the first entry if all have end dates.
  function parseTenure(exp) {
    if (!Array.isArray(exp) || exp.length === 0) return null;

    const current = exp.find(e => !e.endDate && !e.end && !e?.dateRange?.end) || exp[0];
    const startRaw = current?.startDate || current?.start || current?.dateRange?.start;
    if (!startRaw) return null;

    let startDate;
    if (typeof startRaw === 'object' && startRaw.year) {
      startDate = new Date(startRaw.year, (startRaw.month || 1) - 1);
    } else {
      startDate = new Date(startRaw);
    }
    if (isNaN(startDate.getTime())) return null;

    const now = new Date();
    let years = now.getFullYear() - startDate.getFullYear();
    let months = now.getMonth() - startDate.getMonth();
    if (months < 0) { years -= 1; months += 12; }
    if (years < 0) return null;

    if (years === 0) return `${months} mo${months === 1 ? '' : 's'} current role`;
    if (months === 0) return `${years} yr${years === 1 ? '' : 's'} current role`;
    return `${years} yr${years === 1 ? '' : 's'} ${months} mo current role`;
  }

  // Certifications / professional qualifications (e.g. ACA, ACCA, CIMA)
  const certifications = (Array.isArray(profile.certifications) ? profile.certifications : [])
    .map(c => str(c?.name || c?.title || c))
    .filter(Boolean);

  // Education history
  const education = (Array.isArray(profile.education) ? profile.education : [])
    .map(e => ({
      school: str(e?.schoolName || e?.school || ''),
      degree: str(e?.degreeName || e?.degree || ''),
      field:  str(e?.fieldOfStudy || e?.field || ''),
    }))
    .filter(e => e.school || e.degree);

  // Skills (richer than the search endpoint — includes endorsement counts on some plans)
  const skills = (Array.isArray(profile.skills) ? profile.skills : [])
    .map(s => (typeof s === 'string' ? s : str(s?.name || s)))
    .filter(Boolean)
    .slice(0, 15);

  const enriched = {
    tenure: parseTenure(experience),
    certifications,
    education,
    skills,
    experienceCount: Array.isArray(experience) ? experience.length : 0,
  };

  return res.status(200).json({ enriched, source: 'apify', debug: debugInfo });
}
