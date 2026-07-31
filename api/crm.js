// api/crm.js — TalentKnight CRM
// Actions: dashboard | update-stage | save-notes | create-role | find-matches | find-matches-poll
// Auth: Clerk session tokens (Authorization: Bearer <token>), replacing the old magic-link token flow.
import { verifyToken } from '@clerk/backend';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  if (!action) return res.status(400).json({ error: 'Missing ?action= parameter' });

  if (action === 'dashboard')          return handleDashboard(req, res);
  if (action === 'update-stage')       return handleUpdateStage(req, res);
  if (action === 'save-notes')         return handleSaveNotes(req, res);
  if (action === 'create-role')        return handleCreateRole(req, res);
  if (action === 'find-matches')       return handleFindMatches(req, res);
  if (action === 'find-matches-poll')  return handleFindMatchesPoll(req, res);
  if (action === 'update-role-terms')  return handleUpdateRoleTerms(req, res);
  if (action === 'save-placement-salary') return handleSavePlacementSalary(req, res);
  if (action === 'rematch-pool')       return handleRematchPool(req, res);
  if (action === 'clarify-brief')      return handleClarifyBrief(req, res);
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

// Same Apify actor the public Vesper search on demo.html uses for live LinkedIn top-up.
const APIFY_ACTOR = 'harvestapi~linkedin-profile-search';

const CF = { name: 'fld7AIteYYVxT41lf', active: 'fldBIoBDtUBN5tTPY', roles: 'fldXNHwOWNxZ6JcqF' };
const RF = {
  title: 'fldO3J0Fh0JaZ5lRW', location: 'flddgoDm9N0krVu13', brief: 'fldGLYE5iZxdZsFEg', status: 'fldNdoolFfZisVSFS',
  candidates: 'fldU795m0fFIMZ2pc', company: 'fldPOW3SzPV0mfg0B',
  // Earnings pipeline — staff-only commercial terms, never sent to Company Contacts.
  feePercent: 'fld8HSTILHFybW4Hj', targetSalary: 'fldVH9W53ozEm4N6G',
};
const KF = {
  name: 'fld8k1UET3DWwJV3S', role: 'fldwOPyq4vmWzEquB', company: 'fldJYcW9eWMMnFPDS',
  location: 'fldNx4IFaKgaOnNw3', linkedinUrl: 'fldOmVhPF36ULGx7K',
  personalEmail: 'fld0zHTu4JhuZ2LPl', outreachStatus: 'fldkzgRgl71KVUg93',
  pipelineStage: 'fldwlXw21bdKx5mpw', notes: 'fld15lbm2amuugdrv',
  stageChangedAt: 'fldVM6xsL7tXN1pvM', photoUrl: 'fldLjRmZdkPpNzqRF',
  assignedRole: 'fld72aDuvebMTHpB0',
  // Richer candidate profile fields — already present in Airtable, now surfaced in the dashboard.
  sector: 'fldQjqjDdx2oV4KqA', yearsExperience: 'fldvniEirssDClM9N', seniority: 'fldZdGN4Ic6tVLAyR',
  workPreference: 'fld8yRrgggiAVo7I6', salaryMin: 'fldukD1lSgSMk5QP3', salaryMax: 'fld7s9k8DA4xZRDfB',
  noticePeriod: 'fld6bjkGxD9O17rZL', willingToRelocate: 'fldDcb78CT8XBCch8', rightToWorkUK: 'fldA5fQDWE5D3HwoV',
  skills: 'fldjzxELfOSU8M0dC', certifications: 'fldgTtC0PqkPoL69R', educationLevel: 'fldWagGVvad1qKxKu',
  mobile: 'fldpCX8EWARrz4xjN', bio: 'fldtJGFbRDqFR9PPJ',
  // Used by find-matches / find-matches-poll — same fields the public Vesper search reads/writes.
  type: 'fldU5qaydUaqg8GxQ', firstName: 'fldcs3RwQaCDfb5F0', lastName: 'fldHxBcnOl6PvotSu',
  candidateSource: 'flda47WcrjAHQM3En', enrichmentStatus: 'fldHX3Q6XduR3q6JJ',
  // Earnings pipeline — staff-only, the actual agreed salary once a candidate is Placed.
  placementSalary: 'fldhomjZl7P3B6180',
  // AI fit score (0-100) against whichever Role this candidate is currently matched to.
  fitScore: 'fldkIxE2953yKOP1c',
};
const OSF = { name: 'fldIMiB64MXLRln82', clerkId: 'fld9qiWYAWe9mPx8i', organization: 'fldm9cJR6urVDzKLS', tier: 'fldMJlsUHuFX1yJOy', active: 'fldN7VcJ9fKx676dL' };
const CAF = { consultant: 'fldK640gTY74TE88t', company: 'fld8jtLa5bBgLiecA' };
const CCF = { name: 'fldS7Oj0wFblqAMW9', clerkId: 'fldxow90zxJZebzPo', company: 'fldRIczrSKBL7blS0', active: 'flddZUcmemx9fU3rf' };
const ORGF = { name: 'fldqGP76mkwa9AtYZ', companies: 'fldCmI1mZ1qsPDDAv' };

// Stages that only Org Staff (Admin/Consultant) may see or set. "Matched" is where Vesper's
// AI matches land before a human reviews and promotes them into Sourced — kept invisible to
// Company Contacts so clients only ever see candidates a recruiter has vetted.
const STAFF_ONLY_STAGES = ['Matched'];

// Candidates already actively engaged elsewhere are never reassigned by find-matches —
// protects a live pipeline from being silently bumped onto a different Role's Matched queue.
const PROTECTED_STAGES = ['Interviewing', 'Offered', 'Placed'];

// ── Earnings pipeline ──────────────────────────────────────────────
// Rough probability-of-closing weight per pipeline stage, used to turn a Role's
// Fee % × Target Salary into a forecasted (weighted) value rather than treating every
// active Role as equally likely to land. A Role's weight is taken from its most-advanced
// candidate. Staff-only — Company Contacts never see fee/salary/forecast data.
const STAGE_WEIGHTS = {
  Matched: 0.1, Sourced: 0.15, Contacted: 0.25, Shortlisted: 0.4,
  Interviewing: 0.6, Offered: 0.8, Placed: 1, Rejected: 0,
};

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

// ── Resolve Clerk user → accessible Organizations/Companies ──────
// Checks Org Staff first, then falls back to Company Contacts (single-company viewer).
// Returns null if the Clerk user isn't provisioned in either table.
//
// A single person can be Org Staff in more than one Organization (e.g. Darren Cox is
// Admin for both "Essex Recruitment Partners" and "Cyber Knight" — sibling recruiting
// brands under the same Armstrong Knight group). Every active Org Staff record for
// their Clerk user ID is resolved, so the dashboard can offer an organization switcher
// rather than arbitrarily picking whichever record Airtable happens to return first.
//
// viewerType is 'staff' for Org Staff (sees the Matched queue, may span multiple orgs)
// or 'contact' for Company Contacts (single company, never sees Matched).
async function resolveAccess(clerkUserId, h) {
  const staffRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${ORG_STAFF}?filterByFormula=${encodeURIComponent(`AND({${OSF.clerkId}}='${clerkUserId}',{${OSF.active}}=1)`)}&returnFieldsByFieldId=true&pageSize=100`,
    { headers: h }
  ).then(r => r.json()).catch(() => null);

  if (staffRes?.records?.length) {
    let name = 'Staff';
    const organizations = [];
    let assignmentsCache = null;

    for (const staff of staffRes.records) {
      name = staff.fields[OSF.name] || name;
      const tier = staff.fields[OSF.tier];
      const orgId = (staff.fields[OSF.organization] || [])[0];
      if (!orgId) continue;

      const orgRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ORGANIZATIONS}/${orgId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
      const orgName = orgRec?.fields?.[ORGF.name] || 'Organization';

      let companyIds;
      if (tier === 'Admin') {
        companyIds = orgRec?.fields?.[ORGF.companies] || [];
      } else {
        // Consultant: fetch assignments once and filter client-side — Airtable's
        // filterByFormula can't reliably match linked-record fields against a record ID.
        if (!assignmentsCache) {
          assignmentsCache = await fetch(`https://api.airtable.com/v0/${BASE}/${CONSULTANT_ASSIGNMENTS}?returnFieldsByFieldId=true&pageSize=100`, { headers: h }).then(r => r.json()).catch(() => ({ records: [] }));
        }
        companyIds = [...new Set((assignmentsCache.records || [])
          .filter(a => (a.fields[CAF.consultant] || []).includes(staff.id))
          .flatMap(a => a.fields[CAF.company] || []))];
      }
      organizations.push({ id: orgId, name: orgName, companyIds });
    }

    return { name, viewerType: 'staff', organizations };
  }

  const contactRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${COMPANY_CONTACTS}?filterByFormula=${encodeURIComponent(`AND({${CCF.clerkId}}='${clerkUserId}',{${CCF.active}}=1)`)}&returnFieldsByFieldId=true&pageSize=1`,
    { headers: h }
  ).then(r => r.json()).catch(() => null);

  if (contactRes?.records?.length) {
    const contact = contactRes.records[0];
    // Company Contacts aren't linked to an Organization at all — wrap their single
    // company in a synthetic one-entry "organizations" list so the response shape
    // matches the staff case and the frontend can treat both uniformly.
    return {
      name: contact.fields[CCF.name] || 'Guest',
      viewerType: 'contact',
      organizations: [{ id: null, name: null, companyIds: contact.fields[CCF.company] || [] }],
    };
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

// ── Find-matches helpers ──────────────────────────────────────────
// Same stopword-filtering keyword extraction candidates.js uses for the public search,
// applied here to a Role's title/location/brief instead of a visitor-typed brief.
function extractKeywords(text) {
  const stopwords = new Set([
    'with', 'that', 'this', 'have', 'from', 'they', 'will', 'been', 'were', 'their', 'there',
    'about', 'would', 'could', 'should', 'looking', 'seeking', 'need', 'want', 'hire', 'find',
    'recruit', 'ideal', 'good', 'great', 'level', 'years', 'year', 'experience', 'experienced',
    'someone', 'person', 'candidate', 'professional', 'team', 'work', 'based', 'must', 'also',
    'some', 'very', 'well', 'able', 'into', 'over', 'more', 'make', 'what', 'just', 'like',
  ]);
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopwords.has(w))
    .slice(0, 10);
}

// Thin wrapper around the same Claude call parse-brief.js and demo.html's rankWithClaude
// already use in production, just pointed at ANTHROPIC_API_KEY server-side.
async function callClaude(system, userText, maxTokens = 300) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    return text.replace(/```json|```/g, '').trim();
  } catch {
    return null;
  }
}

// ── Slack notifications (optional) ────────────────────────────────
// No-op until SLACK_WEBHOOK_URL is set as an env var — create an Incoming Webhook in
// Slack (any channel) and paste its URL in as SLACK_WEBHOOK_URL. Nothing else in this
// file needs to change once that's set; every call site below already calls this.
async function postToSlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Best-effort — a Slack outage should never block the caller.
  }
}

// Ranks a candidate pool against a Role's brief, same idea as demo.html's rankWithClaude
// but returns the actual candidate objects (keyed by list position) instead of names —
// avoids any name-collision ambiguity when writing Assigned Role back to Airtable.
//
// Also asks Claude for a 0-100 fit score per candidate (same scale/spirit as the public
// Vesper demo's "Fit score" UX on demo.html) so the CRM can show recruiters how strong a
// match actually is, not just an unscored ranked order. Each returned candidate carries
// a `.fitScore` alongside its existing fields.
async function rankPoolAgainstRole(briefText, pool, limit = 8) {
  if (!pool.length) return [];
  const listText = pool.slice(0, 40).map((c, i) => {
    const parts = [c.name];
    if (c.role) parts.push(c.role);
    if (c.company) parts.push(c.company);
    if (c.location) parts.push(c.location);
    if (c.sector) parts.push(c.sector);
    let line = `${i + 1}. ${parts.join(' · ')}`;
    if (c.bio) line += ` — ${c.bio.slice(0, 160)}`;
    return line;
  }).join('\n');

  const system = `You are a recruitment matching assistant. Given a role brief and a numbered list of candidates, return ONLY a JSON array of objects for the strongest matches, best match first, maximum ${limit} entries. Each object must have "n" (the candidate's number from the list, integer) and "score" (an integer 0-100 estimating how well they fit the role — 90+ excellent fit, 70-89 strong, 50-69 partial, below 50 only if you must include them to reach the list). No markdown, no preamble, no explanation. Example: [{"n":3,"score":92},{"n":1,"score":78}]`;
  const raw = await callClaude(system, `Role brief: ${briefText}\n\nCandidates:\n${listText}`, 400);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => {
        const cand = pool[(item?.n ?? 0) - 1];
        if (!cand) return null;
        const score = Math.max(0, Math.min(100, Math.round(Number(item?.score) || 0)));
        return { ...cand, fitScore: score };
      })
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// Writes Assigned Role + Pipeline Stage onto a batch of candidate record IDs — the one
// write path that actually lands a search result in the CRM's Matched column.
//
// Assigned Role is a multi-link field (confirmed via the Airtable schema —
// prefersSingleRecordLink: false), so this APPENDS the new role to whatever's already
// linked rather than overwriting it. The previous version of this function replaced
// the link outright, which silently dropped a candidate's connection to any role they
// were previously matched against the moment they matched a second one.
//
// Pipeline Stage is still a single global field per candidate, not one per role. If a
// candidate is already meaningfully engaged elsewhere (Contacted/Shortlisted for a
// different role), we still link the new role but leave their stage alone rather than
// bouncing it back to 'Matched' — and report them back as "notifyOnly" so the caller
// can flag it for a recruiter to review by hand instead of silently overwriting real
// pipeline state that's already in progress.
const STAGE_RESET_SAFE = new Set(['', undefined, 'Sourced', 'Rejected', 'Matched']);

async function patchCandidatesStage(recordIds, roleId, h, scores = {}) {
  if (!recordIds.length) return { linked: [], notifyOnly: [] };
  const today = new Date().toISOString().split('T')[0];

  const existing = await fetch(
    `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(`OR(${recordIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true&pageSize=100`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));
  const current = {};
  (existing.records || []).forEach(rec => {
    current[rec.id] = {
      links: rec.fields[KF.assignedRole] || [],
      stage: rec.fields[KF.pipelineStage] || '',
      name: rec.fields[KF.name] || '',
    };
  });

  const linked = [];
  const notifyOnly = [];

  for (let i = 0; i < recordIds.length; i += 10) {
    const batch = recordIds.slice(i, i + 10);
    await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({
        records: batch.map(id => {
          const info = current[id] || { links: [], stage: '', name: '' };
          const links = new Set(info.links);
          const alreadyLinked = links.has(roleId);
          links.add(roleId);
          const resetSafe = STAGE_RESET_SAFE.has(info.stage);
          const fields = { [KF.assignedRole]: [...links] };
          // Fit score is written whenever we have one, regardless of the stage-reset
          // branch below — it's informative even for a candidate who's already active
          // elsewhere and whose Pipeline Stage we're deliberately not touching.
          if (scores[id] != null) fields[KF.fitScore] = scores[id];
          if (resetSafe) {
            fields[KF.pipelineStage] = 'Matched';
            fields[KF.stageChangedAt] = today;
            linked.push({ id, name: info.name });
          } else if (!alreadyLinked) {
            notifyOnly.push({ id, name: info.name, currentStage: info.stage });
          }
          return { id, fields };
        }),
      }),
    }).catch(() => null);
  }

  return { linked, notifyOnly };
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
  const isStaff = access.viewerType === 'staff';
  const allCompanyIds = [...new Set(access.organizations.flatMap(o => o.companyIds))];
  if (!allCompanyIds.length) return res.status(200).json({ user: { name: access.name, isStaff }, organizations: [] });

  const companiesRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${COMPANIES}?filterByFormula=${encodeURIComponent(`OR(${allCompanyIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));

  const companiesData = (companiesRes.records || []).map(rec => ({
    id: rec.id,
    name: rec.fields[CF.name] || 'Untitled Company',
    roleIds: rec.fields[CF.roles] || [],
  }));
  const companyById = Object.fromEntries(companiesData.map(c => [c.id, c]));

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
        feePercent: typeof rec.fields[RF.feePercent] === 'number' ? rec.fields[RF.feePercent] : null,
        targetSalary: typeof rec.fields[RF.targetSalary] === 'number' ? rec.fields[RF.targetSalary] : null,
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
      const stage = f[KF.pipelineStage] || 'Sourced';

      // Company Contacts never see staff-only stages (e.g. "Matched" — AI matches
      // awaiting recruiter review) even if a candidate is linked to their role.
      if (!isStaff && STAFF_ONLY_STAGES.includes(stage)) return;

      candidateMap[rec.id] = {
        id: rec.id,
        name: f[KF.name] || 'Unknown',
        role: f[KF.role] || '',
        company,
        location: f[KF.location] || '',
        linkedinUrl: f[KF.linkedinUrl] || '',
        email: consented ? (f[KF.personalEmail] || '') : '',
        phone: consented ? (f[KF.mobile] || '') : '',
        outreachStatus: f[KF.outreachStatus] || '',
        pipelineStage: stage,
        notes: f[KF.notes] || '',
        stageChangedAt: f[KF.stageChangedAt] || '',
        photoUrl: f[KF.photoUrl] || '',
        sector: f[KF.sector] || '',
        yearsExperience: f[KF.yearsExperience] || '',
        seniority: f[KF.seniority] || '',
        workPreference: f[KF.workPreference] || '',
        salaryMin: typeof f[KF.salaryMin] === 'number' ? f[KF.salaryMin] : null,
        salaryMax: typeof f[KF.salaryMax] === 'number' ? f[KF.salaryMax] : null,
        noticePeriod: f[KF.noticePeriod] || '',
        willingToRelocate: f[KF.willingToRelocate] || '',
        rightToWorkUK: f[KF.rightToWorkUK] || '',
        skills: f[KF.skills] || '',
        certifications: f[KF.certifications] || '',
        educationLevel: f[KF.educationLevel] || '',
        bio: f[KF.bio] || '',
        fitScore: typeof f[KF.fitScore] === 'number' ? f[KF.fitScore] : null,
        // Earnings pipeline — commercial data, never sent to Company Contacts.
        placementSalary: isStaff && typeof f[KF.placementSalary] === 'number' ? f[KF.placementSalary] : null,
      };
    });
  }

  // Assemble per-organization: lets a user with access to more than one Organization
  // (e.g. an Admin working across sibling agency brands) switch between them in the UI,
  // instead of only ever seeing whichever one happened to resolve first.
  const organizations = access.organizations
    .map(org => ({
      id: org.id,
      name: org.name,
      companies: org.companyIds
        .map(id => companyById[id])
        .filter(Boolean)
        .map(c => ({
          id: c.id,
          name: c.name,
          roles: c.roleIds.map(id => roleMap[id]).filter(Boolean).map(role => {
            const roleCandidates = role.candidateIds.map(id => candidateMap[id]).filter(Boolean);
            const base = { ...role, candidateIds: undefined, candidates: roleCandidates };

            if (!isStaff) {
              // Commercial terms are staff-only — never expose fee/salary data to clients.
              delete base.feePercent;
              delete base.targetSalary;
              return base;
            }

            // Forecast = Fee % × Target Salary × probability-of-closing, where probability
            // is taken from this Role's most-advanced candidate stage (STAGE_WEIGHTS).
            // A Role with no candidates yet, or missing fee/salary terms, forecasts as null
            // rather than 0 — lets the UI distinguish "no data" from "genuinely worthless."
            const probability = roleCandidates.reduce((max, c) => Math.max(max, STAGE_WEIGHTS[c.pipelineStage] ?? 0), 0);
            base.probability = probability;
            base.forecastValue = (role.feePercent && role.targetSalary)
              ? Math.round(role.feePercent * role.targetSalary * probability)
              : null;

            // Actual (billed) earnings only apply to Placed candidates — computed here
            // rather than in the candidate loop above because it needs this Role's Fee %.
            base.candidates = roleCandidates.map(c => {
              if (c.pipelineStage !== 'Placed') return c;
              const salary = c.placementSalary ?? role.targetSalary ?? null;
              const actualEarnings = (role.feePercent && salary) ? Math.round(role.feePercent * salary) : null;
              return { ...c, actualEarnings };
            });

            return base;
          }),
        })),
    }))
    .filter(org => org.companies.length);

  return res.status(200).json({ user: { name: access.name, isStaff }, organizations });
}

// ── UPDATE STAGE ──────────────────────────────────────────────────
async function handleUpdateStage(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { candidateId, stage } = req.body || {};
  if (!candidateId || !stage) return res.status(400).json({ error: 'Missing fields' });

  const VALID = ['Matched','Sourced','Contacted','Shortlisted','Interviewing','Offered','Placed','Rejected'];
  if (!VALID.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });

  if (STAFF_ONLY_STAGES.includes(stage) && access.viewerType !== 'staff') {
    return res.status(403).json({ error: 'Only recruiters can set this stage.' });
  }

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const check = await candidateAllowed(candidateId, allCompanyIds, h);
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

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const check = await candidateAllowed(candidateId, allCompanyIds, h);
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

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  if (!allCompanyIds.includes(companyId)) return res.status(403).json({ error: 'Company not in your access scope' });

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

  // Auto-run the same live-search that "Find matches" does, so a brand-new Role starts
  // building a relevant candidate pool immediately instead of waiting for someone to click
  // the button. Best-effort — a failure here never blocks role creation itself.
  const searchResult = await runMatchSearch(
    roleRes.id, title.trim(), (location || '').trim(), (brief || '').trim(), h
  ).catch(() => ({ matchedCount: 0, matched: [], runId: null }));

  return res.status(200).json({ ok: true, roleId: roleRes.id, title: title.trim(), ...searchResult });
}

// ── FIND MATCHES (start) ─────────────────────────────────────────
// Staff-only. Same instant-pool-search + Claude-ranking pattern the public Vesper search
// on demo.html uses, pointed at a specific Role's brief instead of a visitor's typed text.
// Matches picked from the existing pool are written straight to Assigned Role + Matched
// stage; a live Apify LinkedIn run is also kicked off and its runId handed back so the
// dashboard can poll find-matches-poll for a background top-up, exactly like demo.html's
// pollAndUpgrade() does for the public search.
async function handleFindMatches(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { roleId } = req.body || {};
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Only recruiters can search for matches.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);

  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  const title = roleRec.fields[RF.title] || '';
  const location = roleRec.fields[RF.location] || '';
  const brief = roleRec.fields[RF.brief] || '';

  const result = await runMatchSearch(roleId, title, location, brief, h);
  return res.status(200).json({ ok: true, ...result });
}

// Core of Find Matches, shared by the manual button (handleFindMatches) and the
// auto-run-on-create path (handleCreateRole): instant pool search + Claude ranking,
// writes Assigned Role + Matched stage onto pool hits, then kicks off a live Apify
// LinkedIn run in "Full" profile mode — richer per-candidate data (skills, industry,
// full summary, not just name/headline) so every candidate the live search saves is
// actually usable for future keyword matching, not just this one Role. Returns the
// runId so the caller can poll find-matches-poll for the background top-up.
async function runMatchSearch(roleId, title, location, brief, h) {
  const briefText = [title, location, brief].filter(Boolean).join(' — ');
  const keywords = extractKeywords(briefText);
  let matched = [];

  if (keywords.length) {
    const ALLOWED_TYPES = ['LinkedIn', 'live'];
    const fieldChecks = keywords.map(kw => {
      const safe = kw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `OR(
        SEARCH("${safe}", LOWER(IF({${KF.role}}, {${KF.role}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.bio}}, {${KF.bio}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.skills}}, {${KF.skills}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.sector}}, {${KF.sector}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.location}}, {${KF.location}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.company}}, {${KF.company}}, "")))
      )`;
    });
    const typeFilter = `OR(${ALLOWED_TYPES.map(t => `{${KF.type}} = '${t}'`).join(',')})`;
    const stageProtectFilter = `NOT(OR(${PROTECTED_STAGES.map(s => `{${KF.pipelineStage}} = '${s}'`).join(',')}))`;
    const keywordFilter = `OR(${fieldChecks.join(',')})`;
    const formula = `AND(${typeFilter}, ${stageProtectFilter}, ${keywordFilter})`;

    const poolRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(formula)}&pageSize=60&returnFieldsByFieldId=true`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));

    const pool = (poolRes.records || []).map(rec => ({
      id: rec.id,
      name: rec.fields[KF.name] || '',
      role: rec.fields[KF.role] || '',
      company: rec.fields[KF.company] || '',
      location: rec.fields[KF.location] || '',
      sector: rec.fields[KF.sector] || '',
      bio: rec.fields[KF.bio] || '',
    })).filter(c => c.name);

    matched = await rankPoolAgainstRole(briefText, pool, 8);
  }

  if (matched.length) {
    const scores = Object.fromEntries(matched.map(c => [c.id, c.fitScore]));
    const { linked, notifyOnly } = await patchCandidatesStage(matched.map(c => c.id), roleId, h, scores);
    if (linked.length) postToSlack(`:dart: *${linked.length} candidate(s) matched* to *${title || 'a role'}*: ${linked.map(c => c.name).join(', ')}`);
    if (notifyOnly.length) postToSlack(`:eyes: *${notifyOnly.map(c => c.name).join(', ')}* also fit *${title || 'a role'}* but ${notifyOnly.length === 1 ? 'is' : 'are'} already active elsewhere (stage untouched) — worth a look.`);
  }

  // Kick off a live LinkedIn top-up in the background — frontend polls find-matches-poll
  // separately, this call only needs to start the run and hand back its ID. "Full" mode
  // captures skills/industry/summary per profile (not just name+headline like "Short"),
  // so every candidate this saves is genuinely searchable later, not more sparse-pool rubbish.
  let runId = null;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (APIFY_TOKEN && title) {
    try {
      const actorInput = { profileScraperMode: 'Full', maxItems: 25, searchQuery: title, currentJobTitles: [title] };
      if (location) actorInput.locations = [location];
      const startUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}&memory=256`;
      const r = await fetch(startUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(actorInput) });
      if (r.ok) {
        const d = await r.json();
        runId = d?.data?.id || null;
      }
    } catch { /* live top-up is best-effort — pool results above still stand */ }
  }

  return {
    matchedCount: matched.length,
    matched: matched.map(c => ({ id: c.id, name: c.name, fitScore: c.fitScore })),
    runId,
  };
}

// ── FIND MATCHES (poll) ───────────────────────────────────────────
// Mirrors apify-poll.js: checks the Apify run, dedupes/saves any new LinkedIn profiles
// into the master All Candidates table — but additionally ranks the live batch against
// the Role's brief and writes Assigned Role + Matched stage onto the best matches, which
// apify-poll.js (used by the public search) deliberately never does.
async function handleFindMatchesPoll(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN not configured' });

  const { runId, roleId } = req.query;
  if (!runId || !roleId) return res.status(400).json({ error: 'runId and roleId are required' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Only recruiters can do this.' });
  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);

  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`;
  let status;
  try {
    const r = await fetch(statusUrl);
    if (!r.ok) return res.status(200).json({ status: 'ERROR' });
    const d = await r.json();
    status = d?.data?.status;
  } catch {
    return res.status(200).json({ status: 'ERROR' });
  }

  if (status === 'RUNNING' || status === 'READY' || status === 'CREATED') return res.status(200).json({ status: 'RUNNING' });
  if (status !== 'SUCCEEDED') return res.status(200).json({ status: 'FAILED', reason: status });

  const datasetUrl = `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=25`;
  let raw = [];
  try {
    const r = await fetch(datasetUrl);
    if (!r.ok) return res.status(200).json({ status: 'FAILED' });
    raw = await r.json();
  } catch {
    return res.status(200).json({ status: 'FAILED' });
  }

  function str(v) {
    if (!v) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object') return (v.full || v.city || v.country || Object.values(v).filter(x => typeof x === 'string').join(', ')).trim();
    return String(v).trim();
  }
  function extractPhoto(p) {
    const rawUrl = p.profilePicture || p.profilePic || p.photo || p.photoUrl || p.pictureUrl || p.profilePhoto || p.avatar || p.profileImageUrl || p.imgUrl || p.image || p.picture || '';
    return (typeof rawUrl === 'string' && rawUrl.startsWith('https://')) ? rawUrl.trim() : '';
  }
  // HarvestAPI's "Full" profile mode returns skills as objects — { name, positions,
  // endorsements } per its documented schema — not plain strings. The previous version of
  // this mapping did `.join(', ')` straight over that array, which silently wrote literal
  // "[object Object]" text into every affected candidate's Skills field (each object's
  // default toString()). This extracts the actual name, with topSkills (a plain string
  // array) as a fallback for profiles where the detailed skills list is empty.
  function extractSkills(p) {
    const fromSkills = Array.isArray(p.skills)
      ? p.skills.map(s => (s && typeof s === 'object' ? s.name : s)).filter(Boolean)
      : [];
    const list = fromSkills.length ? fromSkills : (Array.isArray(p.topSkills) ? p.topSkills.filter(Boolean) : []);
    return list.slice(0, 10).join(', ');
  }

  const scraped = (Array.isArray(raw) ? raw : [])
    .map(p => ({
      name: str([p.firstName, p.lastName].filter(Boolean).join(' ') || p.fullName || ''),
      firstName: str(p.firstName || ''),
      lastName: str(p.lastName || ''),
      role: str(p.headline || p.title || ''),
      company: str(p.companyName || p.currentCompany || (p.currentPosition?.[0]?.companyName) || ''),
      location: str(p.location || p.addressWithCountry || ''),
      bio: str(p.summary || p.about || '').slice(0, 400),
      skills: extractSkills(p),
      sector: str(p.industry || ''),
      linkedinUrl: str(p.profileUrl || p.linkedinUrl || p.url || ''),
      photoUrl: extractPhoto(p),
    }))
    .filter(c => c.name);

  // Dedupe against the existing pool — reuse the record if one already exists (by LinkedIn
  // URL, then by name), otherwise create it. Either way we end up with a real record ID to
  // link to this Role, which is the piece the public search's apify-poll.js never needed.
  const withUrl = scraped.filter(c => c.linkedinUrl);
  const withoutUrl = scraped.filter(c => !c.linkedinUrl);
  const resolved = [];

  if (withUrl.length) {
    const filters = withUrl.map(c => `{${KF.linkedinUrl}} = '${c.linkedinUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
    const checkRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(`OR(${filters.join(',')})`)}&returnFieldsByFieldId=true`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));
    const existingByUrl = {};
    (checkRes.records || []).forEach(rec => { existingByUrl[(rec.fields[KF.linkedinUrl] || '').trim().toLowerCase()] = rec.id; });

    const toCreate = [];
    withUrl.forEach(c => {
      const key = c.linkedinUrl.trim().toLowerCase();
      if (existingByUrl[key]) resolved.push({ ...c, id: existingByUrl[key] });
      else toCreate.push(c);
    });

    for (let i = 0; i < toCreate.length; i += 10) {
      const batch = toCreate.slice(i, i + 10);
      const created = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          records: batch.map(c => ({ fields: {
            [KF.name]: c.name,
            [KF.firstName]: c.firstName || c.name.split(' ')[0] || '',
            [KF.lastName]: c.lastName || c.name.split(' ').slice(1).join(' ') || '',
            [KF.location]: c.location, [KF.role]: c.role, [KF.company]: c.company,
            [KF.bio]: c.bio, [KF.skills]: c.skills, [KF.sector]: c.sector,
            [KF.type]: 'LinkedIn', [KF.linkedinUrl]: c.linkedinUrl,
            [KF.candidateSource]: 'Apify', [KF.enrichmentStatus]: 'Pending',
            ...(c.photoUrl ? { [KF.photoUrl]: c.photoUrl } : {}),
          } })),
          typecast: true,
        }),
      }).then(r => r.json()).catch(() => ({ records: [] }));
      (created.records || []).forEach((rec, idx) => resolved.push({ ...batch[idx], id: rec.id }));
    }
  }

  if (withoutUrl.length) {
    const filters = withoutUrl.map(c => `{${KF.name}} = '${c.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
    const checkRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(`OR(${filters.join(',')})`)}&returnFieldsByFieldId=true`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));
    const existingByName = {};
    (checkRes.records || []).forEach(rec => { existingByName[(rec.fields[KF.name] || '').trim().toLowerCase()] = rec.id; });

    const toCreate = [];
    withoutUrl.forEach(c => {
      const key = c.name.trim().toLowerCase();
      if (existingByName[key]) resolved.push({ ...c, id: existingByName[key] });
      else toCreate.push(c);
    });

    for (let i = 0; i < toCreate.length; i += 10) {
      const batch = toCreate.slice(i, i + 10);
      const created = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          records: batch.map(c => ({ fields: {
            [KF.name]: c.name,
            [KF.firstName]: c.firstName || c.name.split(' ')[0] || '',
            [KF.lastName]: c.lastName || c.name.split(' ').slice(1).join(' ') || '',
            [KF.location]: c.location, [KF.role]: c.role, [KF.company]: c.company,
            [KF.bio]: c.bio, [KF.skills]: c.skills, [KF.sector]: c.sector,
            [KF.type]: 'LinkedIn', [KF.candidateSource]: 'Apify', [KF.enrichmentStatus]: 'Pending',
            ...(c.photoUrl ? { [KF.photoUrl]: c.photoUrl } : {}),
          } })),
          typecast: true,
        }),
      }).then(r => r.json()).catch(() => ({ records: [] }));
      (created.records || []).forEach((rec, idx) => resolved.push({ ...batch[idx], id: rec.id }));
    }
  }

  const roleTitle = roleRec.fields[RF.title] || '';
  const roleLoc = roleRec.fields[RF.location] || '';
  const roleBrief = roleRec.fields[RF.brief] || '';
  const briefText = [roleTitle, roleLoc, roleBrief].filter(Boolean).join(' — ');

  const ranked = await rankPoolAgainstRole(briefText, resolved, 8);
  let linked = [], notifyOnly = [];
  if (ranked.length) {
    const scores = Object.fromEntries(ranked.map(c => [c.id, c.fitScore]));
    ({ linked, notifyOnly } = await patchCandidatesStage(ranked.map(c => c.id), roleId, h, scores));
    if (linked.length) postToSlack(`:dart: *${linked.length} new LinkedIn candidate(s) matched* to *${roleTitle || 'a role'}*: ${linked.map(c => c.name).join(', ')}`);
    if (notifyOnly.length) postToSlack(`:eyes: *${notifyOnly.map(c => c.name).join(', ')}* also fit *${roleTitle || 'a role'}* but already active elsewhere — worth a look.`);
  }

  return res.status(200).json({
    status: 'SUCCEEDED',
    matchedCount: ranked.length,
    matched: ranked.map(c => ({ id: c.id, name: c.name, fitScore: c.fitScore })),
  });
}

// ── REMATCH POOL (background, cron-triggered) ─────────────────────
// Runs once daily via Vercel Cron (see vercel.json "crons"). Re-checks every Active Role
// against the *current* full candidate pool — not just at Role-creation time, and not
// only when someone clicks "Find matches" — so candidates added or enriched after a
// Role was created still get surfaced against it, and candidates rejected from one role
// get a chance at others. Reuses the exact same keyword-filter + Claude-ranking path as
// the live "Find matches" button; the only difference is what triggers it and that it
// loops every Active Role instead of just one. Posts a Slack summary if
// SLACK_WEBHOOK_URL is configured — otherwise a silent no-op until that's set up.
async function handleRematchPool(req, res) {
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  // Vercel automatically sends this header on Cron-triggered requests once CRON_SECRET
  // is set as a project env var — there's no Clerk session for a cron job to present.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };

  const rolesRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${ROLES}?filterByFormula=${encodeURIComponent(`{${RF.status}}='Active'`)}&returnFieldsByFieldId=true&pageSize=100`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));

  const roles = (rolesRes.records || []).map(rec => ({
    id: rec.id,
    title: rec.fields[RF.title] || '',
    location: rec.fields[RF.location] || '',
    brief: rec.fields[RF.brief] || '',
  }));

  let totalLinked = 0;
  let totalNotify = 0;
  const summaryLines = [];

  for (const role of roles) {
    const briefText = [role.title, role.location, role.brief].filter(Boolean).join(' — ');
    const keywords = extractKeywords(briefText);
    if (!keywords.length) continue;

    const ALLOWED_TYPES = ['LinkedIn', 'live'];
    const fieldChecks = keywords.map(kw => {
      const safe = kw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `OR(
        SEARCH("${safe}", LOWER(IF({${KF.role}}, {${KF.role}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.bio}}, {${KF.bio}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.skills}}, {${KF.skills}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.sector}}, {${KF.sector}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.location}}, {${KF.location}}, ""))),
        SEARCH("${safe}", LOWER(IF({${KF.company}}, {${KF.company}}, "")))
      )`;
    });
    const typeFilter = `OR(${ALLOWED_TYPES.map(t => `{${KF.type}} = '${t}'`).join(',')})`;
    const stageProtectFilter = `NOT(OR(${PROTECTED_STAGES.map(s => `{${KF.pipelineStage}} = '${s}'`).join(',')}))`;
    const keywordFilter = `OR(${fieldChecks.join(',')})`;
    const formula = `AND(${typeFilter}, ${stageProtectFilter}, ${keywordFilter})`;

    const poolRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(formula)}&pageSize=60&returnFieldsByFieldId=true`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));

    const pool = (poolRes.records || []).map(rec => ({
      id: rec.id,
      name: rec.fields[KF.name] || '',
      role: rec.fields[KF.role] || '',
      company: rec.fields[KF.company] || '',
      location: rec.fields[KF.location] || '',
      sector: rec.fields[KF.sector] || '',
      bio: rec.fields[KF.bio] || '',
      assignedRole: rec.fields[KF.assignedRole] || [],
    // Skip candidates already linked to this exact Role — nothing new to surface.
    })).filter(c => c.name && !c.assignedRole.includes(role.id));

    if (!pool.length) continue;

    const matched = await rankPoolAgainstRole(briefText, pool, 8);
    if (!matched.length) continue;

    const scores = Object.fromEntries(matched.map(c => [c.id, c.fitScore]));
    const { linked, notifyOnly } = await patchCandidatesStage(matched.map(c => c.id), role.id, h, scores);
    totalLinked += linked.length;
    totalNotify += notifyOnly.length;
    if (linked.length) summaryLines.push(`*${role.title}*: +${linked.length} new match(es) — ${linked.map(c => c.name).join(', ')}`);
    if (notifyOnly.length) summaryLines.push(`*${role.title}*: ${notifyOnly.map(c => c.name).join(', ')} also fit but already active elsewhere — review manually`);
  }

  if (summaryLines.length) {
    await postToSlack(`:recycle: *Daily rematch* — ${totalLinked} new match(es), ${totalNotify} cross-role flag(s) across ${roles.length} active role(s):\n${summaryLines.join('\n')}`);
  }

  return res.status(200).json({ ok: true, rolesChecked: roles.length, totalLinked, totalNotify });
}

// ── CLARIFY BRIEF (conversational intake, employer side) ──────────
// Staff-only. Given a role's title/location/brief as typed into the "Request a new
// role" modal, asks Claude for up to 3 short clarifying questions covering whatever's
// genuinely missing — must-have vs nice-to-have skills, seniority band, remote/hybrid/
// onsite, salary range, sector specifics — before the brief ever reaches runMatchSearch.
// Returns an empty array if the brief is already detailed enough.
//
// Deliberately additive: the dashboard appends any answers to the plain brief text
// itself before calling create-role, so create-role and runMatchSearch need zero
// changes — they still just receive a single (now richer) brief string, same as today.
async function handleClarifyBrief(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });
  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Only recruiters can do this.' });

  const { title, location, brief } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const briefText = [title, location, brief].filter(Boolean).join(' — ');
  const system = 'You are helping a recruiter sharpen a hiring brief before it is matched against a candidate pool. Given the brief below, return ONLY a JSON array of up to 3 short clarifying questions covering things that would meaningfully change who counts as a good match — must-have vs nice-to-have skills, seniority level, remote/hybrid/onsite, salary range, sector specifics — but ONLY ask about things not already stated in the brief. If the brief is already detailed enough, return an empty array. No markdown, no preamble, no explanation. Example: ["Is this remote, hybrid, or fully on-site?", "What is the target salary range?"]';
  const raw = await callClaude(system, briefText, 200);

  let questions = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) questions = parsed.filter(q => typeof q === 'string' && q.trim()).slice(0, 3);
    } catch {
      // Malformed JSON from the model — treat as "no questions" rather than error out.
    }
  }

  return res.status(200).json({ questions });
}

// ── UPDATE ROLE TERMS ─────────────────────────────────────────────
// Staff-only. Sets a Role's commercial terms (Fee % and Target Salary), which drive the
// earnings forecast in handleDashboard. Either field may be cleared by sending null.
async function handleUpdateRoleTerms(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { roleId, feePercent, targetSalary } = req.body || {};
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });
  if (feePercent != null && (typeof feePercent !== 'number' || feePercent < 0 || feePercent > 1)) {
    return res.status(400).json({ error: 'feePercent must be a fraction between 0 and 1' });
  }
  if (targetSalary != null && (typeof targetSalary !== 'number' || targetSalary < 0)) {
    return res.status(400).json({ error: 'targetSalary must be a non-negative number' });
  }

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Only recruiters can set deal terms.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  const fields = {};
  if (feePercent !== undefined) fields[RF.feePercent] = feePercent;
  if (targetSalary !== undefined) fields[RF.targetSalary] = targetSalary;

  const upd = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ fields }),
  }).then(r => r.json());

  return upd.id ? res.status(200).json({ ok: true }) : res.status(500).json({ error: 'Update failed' });
}

// ── SAVE PLACEMENT SALARY ─────────────────────────────────────────
// Staff-only. Records the actual agreed salary once a candidate is Placed — the basis
// for actual (billed) earnings, as opposed to the Role-level forecast.
async function handleSavePlacementSalary(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { candidateId, placementSalary } = req.body || {};
  if (!candidateId) return res.status(400).json({ error: 'candidateId is required' });
  if (placementSalary != null && (typeof placementSalary !== 'number' || placementSalary < 0)) {
    return res.status(400).json({ error: 'placementSalary must be a non-negative number' });
  }

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Only recruiters can set placement salary.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const check = await candidateAllowed(candidateId, allCompanyIds, h);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const upd = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}/${candidateId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ fields: { [KF.placementSalary]: placementSalary } }),
  }).then(r => r.json());

  return upd.id ? res.status(200).json({ ok: true }) : res.status(500).json({ error: 'Save failed' });
}
