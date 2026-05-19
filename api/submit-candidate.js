// api/submit-candidate.js — TalentKnight candidate self-submission
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

  // Free-text field IDs only — avoids "can't create select option" errors
  const F = {
    name:            'fld8k1UET3DWwJV3S',
    email:           'fld7JmBigDERwULoz',
    location:        'fldNx4IFaKgaOnNw3',
    role:            'fldwOPyq4vmWzEquB',
    company:         'fldJYcW9eWMMnFPDS',
    bio:             'fldtJGFbRDqFR9PPJ',
    skills:          'fldjzxELfOSU8M0dC',
    marketingSource: 'fldF2n1hsQ4MwPKhp',
  };

  const {
    name, email, phone, location, linkedin,
    role, company, sector, type, skills, bio,
    marketingSource,
  } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  // Append sector/type + contact details as plain text into bio
  const metaLine = [
    sector ? `Sector: ${sector}`    : '',
    type   ? `Looking for: ${type}` : '',
  ].filter(Boolean).join(' | ');

  const contactLine = [
    phone    ? `Phone: ${phone}`       : '',
    linkedin ? `LinkedIn: ${linkedin}` : '',
  ].filter(Boolean).join(' | ');

  const fullBio = [bio, metaLine, contactLine].filter(Boolean).join('\n\n');

  const fields = {
    [F.name]:            name,
    [F.email]:           email,
    [F.location]:        location        || '',
    [F.role]:            role            || '',
    [F.company]:         company         || '',
    [F.bio]:             fullBio,
    [F.skills]:          skills          || '',
    [F.marketingSource]: marketingSource || '',
  };

  try {
    const atRes = await fetch(
      `https://api.airtable.com/v0/${MASTER_BASE}/${MASTER_TABLE}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      }
    );

    const atData = await atRes.json();

    if (!atRes.ok) {
      return res.status(500).json({ error: atData.error?.message || 'Airtable error' });
    }

    return res.status(200).json({ ok: true, id: atData.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
