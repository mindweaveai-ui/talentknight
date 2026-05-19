export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const AT_TOKEN     = process.env.AT_TOKEN;
  const MASTER_BASE  = 'appnAnRSfB7bgIQVU';
  const MASTER_TABLE = 'tblRJLWMSOB9YEXUI';

  // Airtable field IDs for Master Candidates table
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

  const { name, email, phone, location, linkedin, role, company, sector, type, skills, bio } = req.body || {};

  if (!name || !email) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Name and email are required' }));
  }

  // Append contact details into the bio field
  const contactLine = [
    email    ? `Email: ${email}`       : '',
    phone    ? `Phone: ${phone}`       : '',
    linkedin ? `LinkedIn: ${linkedin}` : '',
  ].filter(Boolean).join(' | ');

  const fullBio = [bio, contactLine].filter(Boolean).join('\n\n');

  const fields = {
    [F.name]:     name,
    [F.location]: location || '',
    [F.role]:     role     || '',
    [F.company]:  company  || '',
    [F.bio]:      fullBio,
    [F.skills]:   skills   || '',
    [F.sector]:   sector   || '',
    [F.type]:     type     || '',
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
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: atData.error?.message || 'Airtable error' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, id: atData.id }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
