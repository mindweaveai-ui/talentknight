// api/dashboard.js — TalentKnight CRM dashboard data
// GET /api/dashboard?token=<client_token>
// Returns client info, their roles, and candidates per role
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { token } = req.query;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const BASE = 'appnAnRSfB7bgIQVU';
  const CLIENTS_TABLE = 'tblyRQmcdoRF51jJa';
  const ROLES_TABLE = 'tbltVrndDo3zAzMhe';
  const CANDIDATES_TABLE = 'tblRJLWMSOB9YEXUI';

  const CF = {
    name:    'fld7AIteYYVxT41lf',
    email:   'fldfknPe511FWUvKz',
    token:   'fld11Z2FSw2uQKE4b',
    active:  'fldBIoBDtUBN5tTPY',
    roles:   'fldXNHwOWNxZ6JcqF',  // reverse link from Roles.Client
  };

  const RF = {
    title:      'fldO3J0Fh0JaZ5lRW',
    location:   'flddgoDm9N0krVu13',
    brief:      'fldGLYE5iZxdZsFEg',
    status:     'fldNdoolFfZisVSFS',
    candidates: 'fldU795m0fFIMZ2pc',  // reverse link from Candidates.Assigned Role
  };

  const KF = {
    name:           'fld8k1UET3DWwJV3S',
    location:       'fldNx4IFaKgaOnNw3',
    role:           'fldwOPyq4vmWzEquB',
    company:        'fldJYcW9eWMMnFPDS',
    bio:            'fldtJGFbRDqFR9PPJ',
    linkedinUrl:    'fldOmVhPF36ULGx7K',
    personalEmail:  'fld0zHTu4JhuZ2LPl',
    outreachStatus: 'fldkzgRgl71KVUg93',
    pipelineStage:  'fldwlXw21bdKx5mpw',
    assignedRole:   'fld72aDuvebMTHpB0',
  };

  const atHeaders = { Authorization: `Bearer ${AT_TOKEN}` };

  // 1. Validate token against Clients table
  const clientUrl = `https://api.airtable.com/v0/${BASE}/${CLIENTS_TABLE}`
    + `?filterByFormula=${encodeURIComponent(`AND({${CF.token}}='${token}',{${CF.active}}=1)`)}`
    + `&returnFieldsByFieldId=true&pageSize=1`;

  let client;
  try {
    const r = await fetch(clientUrl, { headers: atHeaders });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: 'Airtable error: ' + (d.error?.message || r.status) });
    if (!d.records?.length) return res.status(401).json({ error: 'Invalid or inactive token' });
    client = { id: d.records[0].id, name: d.records[0].fields[CF.name], roleIds: d.records[0].fields[CF.roles] || [] };
  } catch (err) {
    return res.status(500).json({ error: 'Client lookup failed: ' + err.message });
  }

  if (!client.roleIds.length) {
    return res.status(200).json({ client: { name: client.name }, roles: [] });
  }

  // 2. Fetch all roles for this client
  const roleFormula = `OR(${client.roleIds.map(id => `RECORD_ID()='${id}'`).join(',')})` ;
  const rolesUrl = `https://api.airtable.com/v0/${BASE}/${ROLES_TABLE}`
    + `?filterByFormula=${encodeURIComponent(roleFormula)}`
    + `&returnFieldsByFieldId=true`;

  let roles = [];
  try {
    const r = await fetch(rolesUrl, { headers: atHeaders });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: 'Airtable error: ' + (d.error?.message || r.status) });
    roles = (d.records || []).map(rec => ({
      id: rec.id,
      title: rec.fields[RF.title] || 'Untitled Role',
      location: rec.fields[RF.location] || '',
      brief: rec.fields[RF.brief] || '',
      status: rec.fields[RF.status] || 'Active',
      candidateIds: rec.fields[RF.candidates] || [],
    }));
  } catch (err) {
    return res.status(500).json({ error: 'Roles fetch failed: ' + err.message });
  }

  // 3. Fetch all candidate IDs across all roles (deduped)
  const allCandidateIds = [...new Set(roles.flatMap(r => r.candidateIds))];

  let candidateMap = {};
  if (allCandidateIds.length) {
    const candFormula = `OR(${allCandidateIds.map(id => `RECORD_ID()='${id}'`).join(',')})` ;
    const candUrl = `https://api.airtable.com/v0/${BASE}/${CANDIDATES_TABLE}`
      + `?filterByFormula=${encodeURIComponent(candFormula)}`
      + `&returnFieldsByFieldId=true`;

    try {
      const r = await fetch(candUrl, { headers: atHeaders });
      const d = await r.json();
      if (r.ok) {
        (d.records || []).forEach(rec => {
          const f = rec.fields;
          const consented = f[KF.outreachStatus] === 'Interested';
          candidateMap[rec.id] = {
            id: rec.id,
            name: f[KF.name] || 'Unknown',
            role: f[KF.role] || '',
            company: f[KF.company] || '',
            location: f[KF.location] || '',
            bio: (f[KF.bio] || '').slice(0, 300),
            linkedinUrl: f[KF.linkedinUrl] || '',
            // Only expose contact details if candidate has consented
            email: consented ? (f[KF.personalEmail] || '') : '',
            outreachStatus: f[KF.outreachStatus] || '',
            pipelineStage: f[KF.pipelineStage] || 'Sourced',
          };
        });
      }
    } catch (_) { /* non-fatal — return roles with empty candidates */ }
  }

  // 4. Attach candidates to their roles
  const rolesWithCandidates = roles.map(role => ({
    ...role,
    candidateIds: undefined,
    candidates: role.candidateIds.map(id => candidateMap[id]).filter(Boolean),
  }));

  return res.status(200).json({
    client: { name: client.name },
    roles: rolesWithCandidates,
  });
}
