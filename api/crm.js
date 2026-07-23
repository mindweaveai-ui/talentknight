// api/crm.js — TalentKnight CRM
// Actions: dashboard | generate-token | update-stage | save-notes | create-role
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  if (!action) return res.status(400).json({ error: 'Missing ?action= parameter' });

  if (action === 'dashboard')      return handleDashboard(req, res);
  if (action === 'generate-token') return handleGenerateToken(req, res);
  if (action === 'update-stage')   return handleUpdateStage(req, res);
  if (action === 'save-notes')     return handleSaveNotes(req, res);
  if (action === 'create-role')    return handleCreateRole(req, res);
  return res.status(400).json({ error: 'Unknown action' });
}

// ── Shared helpers ────────────────────────────────────────────────
const BASE = 'appnAnRSfB7bgIQVU';
const CF = { name: 'fld7AIteYYVxT41lf', token: 'fld11Z2FSw2uQKE4b', active: 'fldBIoBDtUBN5tTPY', roles: 'fldXNHwOWNxZ6JcqF' };
const RF = { title: 'fldO3J0Fh0JaZ5lRW', location: 'flddgoDm9N0krVu13', brief: 'fldGLYE5iZxdZsFEg', status: 'fldNdoolFfZisVSFS', candidates: 'fldU795m0fFIMZ2pc' };
const KF = {
  name: 'fld8k1UET3DWwJV3S', role: 'fldwOPyq4vmWzEquB', company: 'fldJYcW9eWMMnFPDS',
  location: 'fldNx4IFaKgaOnNw3', linkedinUrl: 'fldOmVhPF36ULGx7K',
  personalEmail: 'fld0zHTu4JhuZ2LPl', outreachStatus: 'fldkzgRgl71KVUg93',
  pipelineStage: 'fldwlXw21bdKx5mpw', notes: 'fld15lbm2amuugdrv',
  stageChangedAt: 'fldVM6xsL7tXN1pvM',
};

async function validateToken(token, h) {
  const r = await fetch(
    `https://api.airtable.com/v0/${BASE}/tblyRQmcdoRF51jJa?filterByFormula=${encodeURIComponent(`AND({${CF.token}}='${token}',{${CF.active}}=1)`)}&returnFieldsByFieldId=true&pageSize=1`,
    { headers: h }
  ).then(r => r.json()).catch(() => null);
  if (!r?.records?.length) return null;
  return { id: r.records[0].id, name: r.records[0].fields[CF.name], roleIds: r.records[0].fields[CF.roles] || [] };
}

// ── DASHBOARD ─────────────────────────────────────────────────────
async function handleDashboard(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { token } = req.query;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const h = { Authorization: `Bearer ${AT_TOKEN}` };
  const client = await validateToken(token, h);
  if (!client) return res.status(401).json({ error: 'Invalid or inactive token' });
  if (!client.roleIds.length) return res.status(200).json({ client: { name: client.name }, roles: [] });

  const rolesRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/tbltVrndDo3zAzMhe?filterByFormula=${encodeURIComponent(`OR(${client.roleIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));

  const roles = (rolesRes.records || []).map(rec => ({
    id: rec.id,
    title: rec.fields[RF.title] || 'Untitled Role',
    location: rec.fields[RF.location] || '',
    brief: rec.fields[RF.brief] || '',
    status: rec.fields[RF.status] || 'Active',
    candidateIds: rec.fields[RF.candidates] || [],
  }));

  const allIds = [...new Set(roles.flatMap(r => r.candidateIds))];
  let candidateMap = {};

  if (allIds.length) {
    const candRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/tblRJLWMSOB9YEXUI?filterByFormula=${encodeURIComponent(`OR(${allIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));

    (candRes.records || []).forEach(rec => {
      const f = rec.fields;
      const consented = f[KF.outreachStatus] === 'Interested';
      const rawCompany = f[KF.company] || '';
      const company = /^\d+$/.test(rawCompany.trim()) ? '' : rawCompany;
      candidateMap[rec.id] = {
        id: rec.id,
        name: f[KF.name] || 'Unknown',
        role: f[KF.role] || '',
        company,
        location: f[KF.location] || '',
        linkedinUrl: f[KF.linkedinUrl] || '',
        email: consented ? (f[KF.personalEmail] || '') : '',
        outreachStatus: f[KF.outreachStatus] || '',
        pipelineStage: f[KF.pipelineStage] || 'Sourced',
        notes: f[KF.notes] || '',
        stageChangedAt: f[KF.stageChangedAt] || '',
      };
    });
  }

  return res.status(200).json({
    client: { name: client.name },
    roles: roles.map(role => ({
      ...role,
      candidateIds: undefined,
      candidates: role.candidateIds.map(id => candidateMap[id]).filter(Boolean),
    })),
  });
}

// ── GENERATE TOKEN ────────────────────────────────────────────────
async function handleGenerateToken(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { adminKey, clientName, email } = req.body || {};
  if (ADMIN_KEY && adminKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorised' });
  if (!clientName || !email) return res.status(400).json({ error: 'clientName and email are required' });

  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const today = new Date().toISOString().split('T')[0];

  const F = { name: 'fld7AIteYYVxT41lf', email: 'fldfknPe511FWUvKz', token: 'fld11Z2FSw2uQKE4b', active: 'fldBIoBDtUBN5tTPY', created: 'fldtwEfCtHWCNqxLY' };
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/tblyRQmcdoRF51jJa`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [F.name]: clientName, [F.email]: email, [F.token]: token, [F.active]: true, [F.created]: today } }),
  });
  const d = await r.json();
  if (!r.ok) return res.status(500).json({ error: 'Airtable error: ' + (d.error?.message || r.status) });

  const host = req.headers.host || 'talentknight.ai';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return res.status(200).json({ ok: true, clientId: d.id, token, dashboardUrl: `${protocol}://${host}/dashboard.html?token=${token}` });
}

// ── UPDATE STAGE ──────────────────────────────────────────────────
async function handleUpdateStage(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { token, candidateId, stage } = req.body || {};
  if (!token || !candidateId || !stage) return res.status(400).json({ error: 'Missing fields' });

  const VALID = ['Sourced','Contacted','Shortlisted','Interviewing','Offered','Placed','Rejected'];
  if (!VALID.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const client = await validateToken(token, h);
  if (!client) return res.status(401).json({ error: 'Invalid or inactive token' });

  const candRes = await fetch(`https://api.airtable.com/v0/${BASE}/tblRJLWMSOB9YEXUI/${candidateId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!candRes?.id) return res.status(404).json({ error: 'Candidate not found' });
  if (!candRes.fields['fld72aDuvebMTHpB0']?.some(id => client.roleIds.includes(id)))
    return res.status(403).json({ error: 'Candidate not in your pipeline' });

  const today = new Date().toISOString().split('T')[0];
  const upd = await fetch(`https://api.airtable.com/v0/${BASE}/tblRJLWMSOB9YEXUI/${candidateId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ fields: { [KF.pipelineStage]: stage, [KF.stageChangedAt]: today } }),
  }).then(r => r.json());

  return upd.id
    ? res.status(200).json({ ok: true, stage, stageChangedAt: today })
    : res.status(500).json({ error: 'Update failed' });
}

// ── SAVE NOTES ────────────────────────────────────────────────────
async function handleSaveNotes(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { token, candidateId, notes } = req.body || {};
  if (!token || !candidateId) return res.status(400).json({ error: 'Missing token or candidateId' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const client = await validateToken(token, h);
  if (!client) return res.status(401).json({ error: 'Invalid or inactive token' });

  const candRes = await fetch(`https://api.airtable.com/v0/${BASE}/tblRJLWMSOB9YEXUI/${candidateId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!candRes?.id) return res.status(404).json({ error: 'Candidate not found' });
  if (!candRes.fields['fld72aDuvebMTHpB0']?.some(id => client.roleIds.includes(id)))
    return res.status(403).json({ error: 'Candidate not in your pipeline' });

  const upd = await fetch(`https://api.airtable.com/v0/${BASE}/tblRJLWMSOB9YEXUI/${candidateId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ fields: { [KF.notes]: String(notes ?? '') } }),
  }).then(r => r.json());

  return upd.id ? res.status(200).json({ ok: true }) : res.status(500).json({ error: 'Save failed' });
}

// ── CREATE ROLE ───────────────────────────────────────────────────
async function handleCreateRole(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { token, title, location, brief } = req.body || {};
  if (!token || !title?.trim()) return res.status(400).json({ error: 'token and title are required' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const client = await validateToken(token, h);
  if (!client) return res.status(401).json({ error: 'Invalid or inactive token' });

  const roleRes = await fetch(`https://api.airtable.com/v0/${BASE}/tbltVrndDo3zAzMhe`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ fields: {
      [RF.title]: title.trim(),
      [RF.location]: (location || '').trim(),
      [RF.brief]: (brief || '').trim(),
      [RF.status]: 'Active',
    }}),
  }).then(r => r.json());

  if (!roleRes.id) return res.status(500).json({ error: 'Failed to create role' });

  await fetch(`https://api.airtable.com/v0/${BASE}/tblyRQmcdoRF51jJa/${client.id}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ fields: { [CF.roles]: [...client.roleIds, roleRes.id] } }),
  });

  return res.status(200).json({ ok: true, roleId: roleRes.id, title: title.trim() });
}
