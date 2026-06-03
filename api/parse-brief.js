// api/parse-brief.js — Use Claude to extract structured search params from a job brief
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { brief = '' } = req.body || {};
  if (!brief.trim()) return res.status(200).json({ parsed: null });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: `You are a recruitment brief parser. Extract structured search parameters from job briefs.

Return ONLY a valid JSON object in this exact format — no markdown, no preamble:
{
  "title": "exact job title to search for",
  "location": "city or region name only",
  "keywords": ["keyword1", "keyword2"],
  "qualifications": ["qual1", "qual2"],
  "mustHaves": ["requirement1", "requirement2"],
  "workType": "hybrid|remote|onsite|any"
}

Rules:
- title: the primary job title only (e.g. "Tax Manager", "Software Engineer", "CFO")
- location: city/region only, no country (e.g. "Essex", "London", "Manchester")
- keywords: 3-8 key skills or domain terms from the brief
- qualifications: any specific certifications or qualifications mentioned
- mustHaves: hard requirements the candidate must meet
- workType: extract from brief or default to "any"
- If a field has no data, use empty array [] or empty string ""`,
        messages: [{
          role: 'user',
          content: `Parse this job brief: ${brief}`
        }]
      })
    });

    if (!r.ok) return res.status(200).json({ parsed: null, error: 'Claude API failed' });

    const data = await r.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({ parsed });

  } catch (err) {
    return res.status(200).json({ parsed: null, error: err.message });
  }
}
