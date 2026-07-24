// api/crm.js — TalentKnight CRM
// Actions: dashboard | update-stage | save-notes | create-role
// Auth: Clerk session tokens (Authorization: Bearer <token>), replacing the old magic-link token flow.
import { verifyToken } from '@clerk/backend';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  if (!action) return res.status(400).json({ error: 'Missing ?action= parameter' });

  if (action === 'dashboard')      return handleDashboard(req, res);
  if (action === 'update-stage')   return handleUpdateStage(req, res);
  if (action === 'save-notes')     return handleSaveNotes(req, res);
  if (action === 'create-role')    return handleCreateRole(req, res);
  if (action === 'generate-token') return res.status(410).json({ error: 'Magic-link tokens are retired. Sign in via Clerk instead.' });
  return res.status(400).json({ error: 'Unknown action' });
}

// ── Shared config ─────────────────────────────────────────────────
const BASE = 'appnAnRSfB7bgIQVU';
const COMPANIES = 'tblyRQmcdoRF51jJa';
const ROLES = 'tbltVrndDo3zAzMhe';
const CANDIDATES = 'tblRJLWMSOB9YEXUI';
const ORGANIZATIONS = 'tblKDRFNdB2UhLQxo';
const ORG_STAFF = 'tblPM0Btn9BzBvnhG';
const CONSULTANT_ASSIGNMENTS = 'tbl5hhfM2SWa6i5Lw';
const COMPANY_CONTACTS = 'tblw8aIC6fGAVKRi8';

const CF = { name: 'fld7AIteYYVxT41lf', active: 'fldBIoBDtUBN5tTPY', roles: 'fldXNHwOWNxZ6JcqF' };
const RF = { title: 'fldO3J0Fh0JaZ5lRW', location: 'flddgoDm9N0krVu13', brief: 'fldGLYE5iZxdZsFEg', status: 'fldNdoolFfZisVSFS', candidates: 'fldU795m0fFIMZ2pc', company: 'fldPOW3SzPV0mfg0B' };
const KF = {
  name: 'fld8k1UET3DWwJV3S', role: 'fldwOPyq4vmWzEquB', company: 'fldJYcW9eWMMnFPDS',
  location: 'fldNx4IFaKgaOnNw3', linkedinUrl: 'fldOmVhPF36ULGx7K',
  personalEmail: 'fld0zHTu4JhuZ2LPl', outreachStatus: 'fldkzgRgl71KVUg93',
  pipelineStage: 'fldwlXw21bdKx5mpw', notes: 'fld15lbm2amuugdrv',
  stageChangedAt: 'fldVM6xsL7tXN1pvM', photoUrl: 'fldLjRmZdkPpNzqRF',
  assignedRole: 'fld72aDuvebMTHpB0',
};
const OSF = { name: 'fldIMiB64MXLRln82', clerkId: 'fld9qiWYAWe9mPx8i', organization: 'fldm9cJR6urVDzKLS', tier: 'fldMJlsUHuFX1yJOy', active: 'fldN7VcJ9fKx676dL' };
const CAF = { consultant: 'fldK640gTY74TE88t', company: 'fld8jtLa5bBgLiecA' };
const CCF = { name: 'fldS7Oj0wFblqAMW9', clerkId: 'fldxow90zxJZebzPo', company: 'fldRIczrSKBL7blS0', active: 'flddZUcmemx9fU3rf' };
const ORGF = { name: 'fldqGP76mkwa9AtYZ', companies: 'fldCmI1mZ1qsPDDAv' };

// ── Clerk session verification ───────────────────────────────────
async function getClerkUserId(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return null;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  try {
    const payload = await verifyToken(match[1], { secretKey });
    return payload.sub || null;
  } catch {
    return null;
  }
}

// ── Resolve Clerk user → accessible Company IDs ──────────────────
// Checks Org Staff first (Admin = every Company in their Organization, Consultant = only
// assigned Companies via Consultant Assignments), then falls back to Company Contacts
// (single-company viewer). Returns null if the Clerk user isn't provisioned in either table.
async function resolveAccess(clerkUserId, h) {
  const staffRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${ORG_STAFF}?filterByFormula=${encodeURIComponent(`AND({${OSF.clerkId}}='${clerkUserId}',{${OSF.active}}=1)`)}&returnFieldsByFieldId=true&pageSize=1`,
    { headers: h }
  ).then(r => r.json()).catch(() => null);

  if (staffRes?.records?.length) {
    const staff = staffRes.records[0];
    const tier = staff.fields[OSF.tier];
    const orgId = (staff.fields[OSF.organization] || [])[0];
    if (!orgId) return null;

    if (tier === 'Admin') {
      const orgRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ORGANIZATIONS}/${orgId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
      return { name: staff.fields[OSF.name] || 'Admin', companyIds: orgRec?.fields?.[ORGF.companies] || [] };
    }

    // Consultant: fetch assignments and filter client-side — Airtable's filterByFormula
    // can't reliably match linked-record fields against a record ID string.
    const asgRes = await fetch(`https://api.airtable.com/v0/${BASE}/${CONSULTANT_ASSIGNMENTS}?returnFieldsByFieldId=true&pageSize=100`, { headers: h }).then(r => r.json()).catch(() => ({ records: [] }));
    const companyIds = (asgRes.records || [])
      .filter(a => (a.fields[CAF.consultant] || []).includes(staff.id))
      .flatMap(a => a.fields[CAF.company] || []);
    return { name: staff.fields[OSF.name] || 'Consultant', companyIds: [...new Set(companyIds)] };
  }

  const contactRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${COMPANY_CONTACTS}?filterByFormula=${encodeURIComponent(`AND({${CCF.clerkId}}='${clerkUserId}',{${CCF.active}}=1)`)}&returnFieldsByFieldId=true&pageSize=1`,
    { headers: h }
  ).then(r => r.json()).catch(() => null);

  if (contactRes?.records?.length) {
    const contact = contactRes.records[0];
    return { name: contact.fields[CCF.name] || 'Guest', companyIds: contact.fields[CCF.company] || [] };
  }

  return null;
}

async function candidateAllowed(candidateId, companyIds, h) {
  const candRes = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}/${candidateId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!candRes?.id) return { ok: false, status: 404, error: 'Candidate not found' };
  const roleIds = candRes.fields[KF.assignedRole] || [];
  if (!roleIds.length) return { ok: false, status: 403, error: 'Candidate not in your pipeline' };
  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleIds[0]}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  const roleCompanyIds = roleRec?.fields?.[RF.company] || [];
  if (!roleCompanyIds.some(id => companyIds.includes(id))) return { ok: false, status: 403, error: 'Candidate not in your pipeline' };
  return { ok: true };
}

// ── DASHBOARD ─────────────────────────────────────────────────────
async function handleDashboard(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}` };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet. Contact your admin." });
  if (!access.companyIds.length) return res.status(200).json({ user: { name: access.name }, companies: [] });

  const companiesRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${COMPANIES}?filterByFormula=${encodeURIComponent(`OR(${access.companyIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));

  const companiesData = (companiesRes.records || []).map(rec => ({
    id: rec.id,
    name: rec.fields[CF.name] || 'Untitled Company',
    roleIds: rec.fields[CF.roles] || [],
  }));

  const allRoleIds = [...new Set(companiesData.flatMap(c => c.roleIds))];
  const roleMap = {};

  if (allRoleIds.length) {
    const rolesRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${ROLES}?filterByFormula=${encodeURIComponent(`OR(${allRoleIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));

    (rolesRes.records || []).forEach(rec => {
      roleMap[rec.id] = {
        id: rec.id,
        title: rec.fields[RF.title] || 'Untitled Role',
        location: rec.fields[RF.location] || '',
        brief: rec.fields[RF.brief] || '',
        status: rec.fields[RF.status] || 'Active',
        candidateIds: rec.fields[RF.candidates] || [],
      };
    });
  }

  const allCandIds = [...new Set(Object.values(roleMap).flatMap(r => r.candidateIds))];
  const candidateMap = {};

  if (allCandIds.length) {
    const candRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(`OR(${allCandIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true`,
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
        photoUrl: f[KF.photoUrl] || '',
      };
    });
  }

  const companies = companiesData.map(c => ({
    id: c.id,
    name: c.name,
    roles: c.roleIds.map(id => roleMap[id]).filter(Boolean).map(role => ({
      ...role,
      candidateIds: undefined,
      candidates: role.candidateIds.map(id => candidateMap[id]).filter(Boolean),
    })),
  }));

  return res.status(200).json({ user: { name: access.name }, companies });
}

// ── UPDATE STAGE ──────────────────────────────────────────────────
async function handleUpdateStage(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { candidateId, stage } = req.body || {};
  if (!candidateId || !stage) return res.status(400).json({ error: 'Missing fields' });

  const VALID = ['Sourced','Contacted','Shortlisted','Interviewing','Offered','Placed','Rejected'];
  if (!VALID.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });

  const check = await candidateAllowed(candidateId, access.companyIds, h);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const today = new Date().toISOString().split('T')[0];
  const upd = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}/${candidateId}`, {
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

  const { candidateId, notes } = req.body || {};
  if (!candidateId) return res.status(400).json({ error: 'Missing candidateId' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });

  const check = await candidateAllowed(candidateId, access.companyIds, h);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const upd = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}/${candidateId}`, {
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

  const { companyId, title, location, brief } = req.body || {};
  if (!companyId || !title?.trim()) return res.status(400).json({ error: 'companyId and title are required' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (!access.companyIds.includes(companyId)) return res.status(403).json({ error: 'Company not in your access scope' });

  const roleRes = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ fields: {
      [RF.title]: title.trim(),
      [RF.location]: (location || '').trim(),
      [RF.brief]: (brief || '').trim(),
      [RF.status]: 'Active',
      [RF.company]: [companyId],
    }}),
  }).then(r => r.json());

  if (!roleRes.id) return res.status(500).json({ error: 'Failed to create role' });
  return res.status(200).json({ ok: true, roleId: roleRes.id, title: title.trim() });
}
