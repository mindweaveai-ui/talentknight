// api/update-stage.js — update a candidate's pipeline stage
// PATCH /api/update-stage
// Body: { token, candidateId, stage }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { token, candidateId, stage } = req.body || {};
  if (!token || !candidateId || !stage) {
    return res.status(400).json({ error: 'Missing token, candidateId, or stage' });
  }

  const VALID_STAGES = ['Sourced', 'Contacted', 'Shortlisted', 'Interviewing', 'Offered', 'Placed', 'Rejected'];
  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: 'Invalid stage value' });
  }

  const BASE = 'appnAnRSfB7bgIQVU';
  const CLIENTS_TABLE = 'tblyRQmcdoRF51jJa';
  const CANDIDATES_TABLE = 'tblRJLWMSOB9YEXUI';
  const TOKEN_FIELD = 'fld11Z2FSw2uQKE4b';
  const ACTIVE_FIELD = 'fldBIoBDtUBN5tTPY';
  const ROLE_IDS_FIELD = 'fldXNHwOWNxZ6JcqF';  // Roles linked to client
  const ASSIGNED_ROLE_FIELD = 'fld72aDuvebMTHpB0';
  const PIPELINE_STAGE_FIELD = 'fldwlXw21bdKx5mpw';

  const atHeaders = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };

  // 1. Validate token
  const clientUrl = `https://api.airtable.com/v0/${BASE}/${CLIENTS_TABLE}`
    + `?filterByFormula=${encodeURIComponent(`AND({${TOKEN_FIELD}}='${token}',{${ACTIVE_FIELD}}=1)`)}`
    + `&returnFieldsByFieldId=true&pageSize=1`;

  let clientRoleIds = [];
  try {
    const r = await fetch(clientUrl, { headers: atHeaders });
    const d = await r.json();
    if (!r.ok || !d.records?.length) return res.status(401).json({ error: 'Invalid or inactive token' });
    clientRoleIds = d.records[0].fields[ROLE_IDS_FIELD] || [];
  } catch (err) {
    return res.status(500).json({ error: 'Auth check failed: ' + err.message });
  }

  // 2. Verify candidate belongs to one of this client's roles
  const candUrl = `https://api.airtable.com/v0/${BASE}/${CANDIDATES_TABLE}/${candidateId}`
    + `?returnFieldsByFieldId=true`;

  try {
    const r = await fetch(candUrl, { headers: atHeaders });
    const d = await r.json();
    if (!r.ok) return res.status(404).json({ error: 'Candidate not found' });
    const candidateRoles = d.fields[ASSIGNED_ROLE_FIELD] || [];
    const authorized = candidateRoles.some(roleId => clientRoleIds.includes(roleId));
    if (!authorized) return res.status(403).json({ error: 'Candidate not in your pipeline' });
  } catch (err) {
    return res.status(500).json({ error: 'Candidate lookup failed: ' + err.message });
  }

  // 3. Update pipeline stage
  const updateUrl = `https://api.airtable.com/v0/${BASE}/${CANDIDATES_TABLE}/${candidateId}`;
  try {
    const r = await fetch(updateUrl, {
      method: 'PATCH',
      headers: atHeaders,
      body: JSON.stringify({ fields: { [PIPELINE_STAGE_FIELD]: stage } }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: 'Update failed: ' + (d.error?.message || r.status) });
    return res.status(200).json({ ok: true, stage });
  } catch (err) {
    return res.status(500).json({ error: 'Update failed: ' + err.message });
  }
}
