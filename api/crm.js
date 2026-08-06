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
  if (action === 'update-role')        return handleUpdateRole(req, res);
  if (action === 'delete-role')        return handleDeleteRole(req, res);
  if (action === 'find-matches')       return handleFindMatches(req, res);
  if (action === 'find-matches-poll')  return handleFindMatchesPoll(req, res);
  if (action === 'update-role-terms')  return handleUpdateRoleTerms(req, res);
  if (action === 'save-placement-salary') return handleSavePlacementSalary(req, res);
  if (action === 'rematch-pool')       return handleRematchPool(req, res);
  if (action === 'clarify-brief')      return handleClarifyBrief(req, res);
  if (action === 'candidate-history')  return handleCandidateHistory(req, res);
  if (action === 'add-history')        return handleAddHistory(req, res);
  if (action === 'assistant-search')   return handleAssistantSearch(req, res);
  if (action === 'company-record')     return handleCompanyRecord(req, res);
  if (action === 'update-company')     return handleUpdateCompany(req, res);
  if (action === 'create-company')     return handleCreateCompany(req, res);
  if (action === 'role-activity')      return handleRoleActivity(req, res);
  if (action === 'similar-candidates') return handleSimilarCandidates(req, res);
  if (action === 'client-intelligence-scan') return handleClientIntelligenceScan(req, res);
  if (action === 'client-signals')     return handleGetClientSignals(req, res);
  if (action === 'update-signal-status') return handleUpdateSignalStatus(req, res);
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
// Junction table: one row per (Candidate, Role) pair, holding that pair's Fit Score +
// Pipeline Stage. Added 2026-08-02 to fix a real bug — Fit Score/Pipeline Stage used to be
// flat fields on the Candidate record, so a candidate matched to 2+ concurrent Roles showed
// the same score/stage on every Role's board, and moving their stage on one Role silently
// moved it on all of them. The old flat fields (KF.fitScore/pipelineStage/stageChangedAt)
// are left in place as a frozen historical snapshot as of the migration — no longer written.
const ROLE_MATCHES = 'tblVD5U84GIci7Jkq';

// CRM Intelligence (added 2026-08-05): a chronological log of interactions per Candidate,
// optionally scoped to a Role — calls, emails, interviews, stage changes, submissions,
// offers, placements, and free-text notes. Auto-logged by handleUpdateStage on every stage
// change; manually logged by staff via the new candidate-history/add-history actions.
// Staff-only (like the Matched stage) — internal call/note history is never surfaced to
// Company Contacts.
const CONTACT_HISTORY = 'tblSWBpdU3T1twcBk';

// AI Client Intelligence (roadmap item #8, added 2026-08-05): flagged events detected by
// monitoring clients' public Companies House data (director appointments/resignations,
// registered office changes, accounts filed, company status changes). One row per detected
// event, written by the daily client-intelligence-scan cron below. Deliberately starts with
// Companies House only (free, no key-registration friction beyond a one-time signup, no
// per-request cost) rather than funding databases or LinkedIn activity — those have no
// free/reliable API and were explicitly deferred per Mike's own scoping call.
const CLIENT_SIGNALS = 'tblzQlONQylNvfl6W';

// Same Apify actor the public Vesper search on demo.html uses for live LinkedIn top-up.
const APIFY_ACTOR = 'harvestapi~linkedin-profile-search';

const CF = {
  name: 'fld7AIteYYVxT41lf', active: 'fldBIoBDtUBN5tTPY', roles: 'fldXNHwOWNxZ6JcqF',
  notes: 'flddKugZtkcL2cojH',
  // Rich Client Records (added 2026-08-05) — company profile fields for the new client
  // record page. Main Contact is the client's day-to-day point of contact, deliberately
  // separate from Company Contacts (that table is portal login users — not always the
  // same person as who you'd actually call).
  website: 'fldnKGDC5eSzNAsQy', industry: 'fldGXGfFA3v7lizRV', companySize: 'fldRqLea5ufzthldz',
  linkedinUrl: 'flddG9orkv9ncuGXW', mainContactName: 'fldyxLGgrY9OlttoB', mainContactTitle: 'fldlfq2u6oq00VueK',
  mainContactEmail: 'fldrzR2aaPumvHh4X', mainContactPhone: 'fldULpq6esdTVk1r8',
  feeTerms: 'fldkNO2L5rRUk2FS6', officeLocations: 'fldG68kB5UuZYQrF5',
  createdDate: 'fldtwEfCtHWCNqxLY',
  // AI Client Intelligence (added 2026-08-05) — chNumber is the structured Companies House
  // registration number (some Cyber Knight companies already had one embedded as free text
  // in `notes`, e.g. "CH: 16694430" — that's unrelated legacy text, this is the field the
  // scan actually reads). chSnapshot is a JSON blob of the last-known CH state (status,
  // office address, active directors, latest filing dates), used to diff against fresh data
  // each scan run. chLastChecked is just for visibility in the Airtable UI.
  chNumber: 'fldPp2dZsnZPDkw9m', chSnapshot: 'fldRN4ADi87cdPbf2', chLastChecked: 'fldeogX3QQjTPMXRF',
  // Needed by handleCreateCompany (added 2026-08-06) to link a newly-created Company to
  // its Organization — every other handler reads this indirectly via resolveAccess'
  // Organizations→Companies rollup, so this is the first place CF needed it directly.
  organization: 'fld6nTsXuSP3fy780',
};
const RF = {
  title: 'fldO3J0Fh0JaZ5lRW', location: 'flddgoDm9N0krVu13', brief: 'fldGLYE5iZxdZsFEg', status: 'fldNdoolFfZisVSFS',
  candidates: 'fldU795m0fFIMZ2pc', company: 'fldPOW3SzPV0mfg0B',
  // Earnings pipeline — staff-only commercial terms, never sent to Company Contacts.
  feePercent: 'fld8HSTILHFybW4Hj', targetSalary: 'fldVH9W53ozEm4N6G',
  // Vacancy Dashboard expansion (2026-08-05, roadmap item #2) — hiring manager contact +
  // a general role-level note, distinct from the per-(candidate,role) Notes on Role Matches.
  hiringManagerName: 'fldgwOZSWNTaf4jk8', hiringManagerEmail: 'fld0bKtv5cm6Lm4G6', hiringManagerPhone: 'fldSy1xjSkpj8SZeF',
  roleNotes: 'fld79A1JKsXv50YRS',
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
const OSF = { name: 'fldIMiB64MXLRln82', email: 'fldyS0isZa5LuVScg', clerkId: 'fld9qiWYAWe9mPx8i', organization: 'fldm9cJR6urVDzKLS', tier: 'fldMJlsUHuFX1yJOy', active: 'fldN7VcJ9fKx676dL' };
const CAF = { consultant: 'fldK640gTY74TE88t', company: 'fld8jtLa5bBgLiecA' };
const CCF = { name: 'fldS7Oj0wFblqAMW9', email: 'fldZr1W6KC4alo6O3', clerkId: 'fldxow90zxJZebzPo', company: 'fldRIczrSKBL7blS0', active: 'flddZUcmemx9fU3rf' };
const ORGF = { name: 'fldqGP76mkwa9AtYZ', companies: 'fldCmI1mZ1qsPDDAv' };
const RMF = {
  label: 'fldqJpmu8lbG8fcJJ', candidate: 'fldV7FC0dg8vCsb6Y', role: 'fldPX949XGdsRZD7H',
  fitScore: 'fldXxiaWdcG4FClat', pipelineStage: 'fld6PAXY7lGgmPOb9', stageChangedAt: 'fldGp33EmrMVDh31g',
  // Real geocoded distance in miles between the Role's Location and this candidate's
  // Location — see filterByDistance()/geocodeLocation() below. Added 2026-08-05.
  distanceMiles: 'fldTPNQbBIMUb2nNH',
  // One-line AI summary of why this candidate fits this specific Role — written by the
  // same rankPoolAgainstRole Claude call that produces fitScore. Added 2026-08-05 for the
  // "AI Candidate Summaries" roadmap item.
  summary: 'fld9JdfaoACkdbpMt',
  // Per-(Candidate, Role) Notes + Placement Salary — added 2026-08-05, replacing the old
  // flat KF.notes/KF.placementSalary fields on All Candidates. Those were a real
  // cross-client confidentiality leak: TalentKnight's candidate pool is shared across
  // every Organization (agency) using the platform, so a recruiter's note written about a
  // candidate for one client was visible to every OTHER client that candidate also
  // happened to be matched to — confirmed live on two candidates (Harriet Voss, Owen
  // Pearce) who were matched to roles under two different Organizations at once. Same fix
  // pattern as the 2026-08-02 Fit Score/Pipeline Stage migration. The old flat fields are
  // left in place as a frozen historical snapshot (not deleted, no longer written).
  notes: 'fldmjbiU5XzAFtFzI', placementSalary: 'fldDF0gK7yMvj7xvG',
};
const CHF = {
  label: 'fldqaqYOdK7VRjZ7f', candidate: 'fldLv9NXLNG0gbySX', role: 'fldXGWEke6b7lf6Zf',
  type: 'flddkAhMPro2NafjX', summary: 'fldu0oKZifl6BEFIv', loggedAt: 'fldQfqojDi7RDmnTo',
  loggedBy: 'fldkIvwxNR7n70EYK',
};
// Client Signals (AI Client Intelligence, added 2026-08-05) — see CLIENT_SIGNALS comment above.
const CSF = {
  summary: 'fldHxpD6YBO5Jl4EC', company: 'fldLPZLfznHgW0ral', type: 'fldgJP63eSMRIteUV',
  detail: 'fldKh29CDsg3nAI75', detectedDate: 'fldkPGu7ZVYSeoP2O', status: 'fldFpWbfDubtBl929',
  rawData: 'fld7lxQ1TGQsoBzEl',
};

// Stages that only Org Staff (Admin/Consultant) may see or set. "Matched" is where Vesper's
// AI matches land before a human reviews and promotes them into Sourced — kept invisible to
// Company Contacts so clients only ever see candidates a recruiter has vetted.
const STAFF_ONLY_STAGES = ['Matched'];

// Candidates already actively engaged elsewhere are never reassigned by find-matches —
// protects a live pipeline from being silently bumped onto a different Role's Matched queue.
const PROTECTED_STAGES = ['Interviewing', 'Offered', 'Placed'];

// Candidates ranked below this score are dropped entirely (not written to Role Matches, not
// linked to the Role) rather than counted as a match — part of the keyword-noise fix
// (2026-08-03): rankPoolAgainstRole always returns up to `limit` candidates regardless of
// absolute score, so without this gate even a 30-45 (weak/filler) fit got written as
// "Matched" whenever the pool didn't have 8 strong options. Complements the tightened
// keyword filter (buildKeywordFilter) rather than replacing it. 60 sits at the bottom of
// rankPoolAgainstRole's own "50-69 = partial fit" band, so anything scored as filler-only
// (<50) or borderline-partial (50-59) never reaches a recruiter's Matched column.
const MIN_MATCH_SCORE = 60;

// Maximum real-world distance (geocoded, straight-line miles — see filterByDistance()) a
// candidate can be from a Role's Location and still count as a match. Added 2026-08-05,
// replacing the 2026-08-04 AI-generated multi-town LinkedIn search filter (Fix #5) after
// confirming via Vercel logs that a well-formed multi-town `locations` array still returns
// 0 results from the Apify actor — there's no way to get Apify/LinkedIn to search a genuine
// mile radius at the source (their `locations` field is exact-match only, no radius param
// exists). Instead we search broadly and filter the results ourselves using real geocoded
// distance. 15 was Mike's own number when he asked "is there a way of looking 15 miles
// around the town" — matches a realistic one-way commute.
const MAX_COMMUTE_MILES = 15;

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

// Looks up a Clerk user's primary email via the Clerk Backend API. Session tokens only
// carry `sub` (the user ID), not email, so this is a separate lookup — used only as a
// fallback when a Clerk ID doesn't match any Org Staff/Company Contacts record yet.
async function getClerkUserEmail(clerkUserId) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  try {
    const user = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    }).then(r => r.json());
    const primary = (user.email_addresses || []).find(e => e.id === user.primary_email_address_id);
    const email = primary?.email_address || user.email_addresses?.[0]?.email_address || '';
    return email ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Self-service first-login linking: if someone invited by email (an Org Staff or Company
// Contacts record created with a Name/Email but no Clerk User ID yet) signs in via Clerk,
// this matches them by email and writes their Clerk User ID onto that record so every
// future login resolves by ID alone — no more manually pasting IDs into Airtable after
// every new hire or client contact signs up.
//
// Only matches records whose Clerk ID field is currently empty, so an already-linked
// record can never be silently overwritten/hijacked by a different account sharing an
// email string. Best-effort: a failed lookup or write just means the user sees the normal
// "not linked yet" screen and can retry (or get manually linked) — it never blocks login.
async function autoLinkByEmail(table, fields, clerkUserId, email, h) {
  if (!email) return null;
  const safeEmail = email.replace(/'/g, "\\'");
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE}/${table}?filterByFormula=${encodeURIComponent(`AND(LOWER({${fields.email}})='${safeEmail}',{${fields.active}}=1,{${fields.clerkId}}='')`)}&returnFieldsByFieldId=true&pageSize=1`,
    { headers: h }
  ).then(r => r.json()).catch(() => null);

  const rec = res?.records?.[0];
  if (!rec) return null;

  await fetch(`https://api.airtable.com/v0/${BASE}/${table}/${rec.id}`, {
    method: 'PATCH',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [fields.clerkId]: clerkUserId } }),
  }).catch(() => null);

  // Populate locally so the caller can proceed immediately without a second round-trip.
  rec.fields[fields.clerkId] = clerkUserId;
  return rec;
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
  // Cached so both the staff and contact email-fallback lookups below share a single
  // Clerk Backend API call instead of fetching the same email twice.
  let emailCache;
  const getEmail = async () => {
    if (emailCache === undefined) emailCache = await getClerkUserEmail(clerkUserId);
    return emailCache;
  };

  let staffRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${ORG_STAFF}?filterByFormula=${encodeURIComponent(`AND({${OSF.clerkId}}='${clerkUserId}',{${OSF.active}}=1)`)}&returnFieldsByFieldId=true&pageSize=100`,
    { headers: h }
  ).then(r => r.json()).catch(() => null);

  if (!staffRes?.records?.length) {
    const linked = await autoLinkByEmail(ORG_STAFF, OSF, clerkUserId, await getEmail(), h);
    if (linked) staffRes = { records: [linked] };
  }

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

  let contactRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${COMPANY_CONTACTS}?filterByFormula=${encodeURIComponent(`AND({${CCF.clerkId}}='${clerkUserId}',{${CCF.active}}=1)`)}&returnFieldsByFieldId=true&pageSize=1`,
    { headers: h }
  ).then(r => r.json()).catch(() => null);

  if (!contactRes?.records?.length) {
    const linked = await autoLinkByEmail(COMPANY_CONTACTS, CCF, clerkUserId, await getEmail(), h);
    if (linked) contactRes = { records: [linked] };
  }

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
  // Checks EVERY Role this candidate is linked to, not just roleIds[0] — a candidate can be
  // linked to multiple Roles across different Companies (see ROLE_MATCHES comment near the
  // top of this file), so only checking the first one could wrongly deny access to a
  // recruiter whose Company owns a different one of the candidate's linked Roles. Notes and
  // placement salary are candidate-level (not per-Role) fields, so "allowed" here correctly
  // means "this candidate touches at least one Role in your scope", not "their first Role
  // happens to be yours". Mirrors the per-Role check handleUpdateStage already does.
  const roleRecs = await fetch(
    `https://api.airtable.com/v0/${BASE}/${ROLES}?filterByFormula=${encodeURIComponent(`OR(${roleIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true&pageSize=100`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));
  const allowed = (roleRecs.records || []).some(rec => (rec.fields[RF.company] || []).some(id => companyIds.includes(id)));
  if (!allowed) return { ok: false, status: 403, error: 'Candidate not in your pipeline' };
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

// Builds the pool-filter keyword clause from a list of per-keyword field-check formulas
// (each an OR across role/bio/skills/sector/location/company for one keyword). Previously
// this was a flat OR across all keyword checks, so a single incidental hit — e.g. a shared
// location word like "london" matching in the location field — was enough to pull a totally
// unrelated candidate into the pool. Requiring at least 2 independent keyword hits (falling
// back to 1 when a brief only yields a single keyword) is a cheap, no-tuning-required way to
// cut that noise: it doesn't stop a single strong keyword match (e.g. an exact skill) from
// still counting toward the total, it just stops one weak/generic word from qualifying a
// candidate on its own. Shared by runMatchSearch and handleRematchPool so the two pool
// searches can't drift out of sync with each other.
function buildKeywordFilter(fieldChecks) {
  const threshold = Math.min(2, fieldChecks.length);
  return `SUM(${fieldChecks.map(fc => `IF(${fc},1,0)`).join(',')}) >= ${threshold}`;
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

// Normalizes a single Role Location for the Apify actor's `locations` filter (still just
// one value — see the 2026-08-05 comment on MAX_COMMUTE_MILES for why the 2026-08-04
// multi-town AI-expansion attempt (Fix #5) was reverted). "UK" gets expanded to "United
// Kingdom" because the actor's docs warn a bare "UK" token gets misread as "Ukraine".
function normalizeLocation(location) {
  return (location || '').replace(/\bUK\b/gi, 'United Kingdom').trim();
}

// ── Distance filtering (geocoding + haversine) ─────────────────────
// Added 2026-08-05. There is no way to get Apify/LinkedIn to search a genuine mile radius
// at the source — the actor's `locations` field is a strict array of exact geo matches,
// and a 2026-08-04 attempt to work around that by having Claude generate a list of nearby
// towns (Fix #5) turned out to fail silently: even a well-formed list like ["Brentwood,
// England, United Kingdom", "Shenfield, England, United Kingdom", ...] came back with 0
// results from the actor (confirmed via Vercel logs), most likely because one or more of
// the smaller towns still doesn't resolve as a LinkedIn geo entity and the whole run fails
// rather than searching the towns that do resolve. So instead: search broadly (single
// location, falling back to nationwide per the existing 2026-08-04 fallback below), then
// geocode the Role's Location and each shortlisted candidate's Location ourselves and
// filter/tag by real calculated distance — this is what actually answers "search within
// 15 miles," not anything LinkedIn's own filter can do.
//
// Originally built on OpenStreetMap's Nominatim (free, no API key) — replaced 2026-08-05
// after a live test came back with unfiltered results (Birmingham/Doncaster/Hartlepool,
// even a candidate in Iași, Romania, all "matched" to a Brentwood role) and Vercel's
// per-request External APIs panel showed zero calls to nominatim.openstreetmap.org ever
// completing — confirmed independently by the same host also being unreachable from a
// second, unrelated sandboxed environment. Nominatim's free tier is known to be
// unreliable from datacenter/cloud IP ranges (Vercel's included); when the very first
// geocode call (for the Role's own location) silently fails, filterByDistance() fails
// open and returns every candidate unfiltered, which is exactly what was observed.
//
// Now uses postcodes.io's Places API (`/places?q=`, backed by Ordnance Survey Open
// Names, free, no key, no documented rate limit) — UK government-adjacent
// infrastructure that's been reliably reachable from serverless in practice. It's a
// free-text search over GB place names, but expects a bare place name ("Great Warley"),
// not Apify's decorated "Great Warley, England, United Kingdom, GB" strings — hence
// extractPlaceName() below. Being UK-only by design, it will never resolve a genuinely
// non-UK location (see the UK_HINTS check in filterByDistance for how that's handled).
//
// (2026-08-05) Also strips a leading "Greater " — LinkedIn locations are frequently
// metro-area labels like "Greater Nottingham" or "Greater London", and postcodes.io's
// Places API returns zero results for those exact strings (confirmed directly: "Greater
// Nottingham" → [], "Nottingham" → resolves fine). Left unstripped, that geocode call
// fails, and because the candidate's raw location text still contains a UK hint ("GB"),
// filterByDistance()'s benefit-of-the-doubt fallback let them through completely
// unfiltered — reopening the exact bug the distance filter was built to close, just via a
// different trigger (a Nottingham candidate matched to a Leigh-on-Sea role surfaced this).
function extractPlaceName(text) {
  return (text || '').replace(/^greater\s+/i, '').split(',')[0].trim();
}

// (2026-08-05) A Buckley Watson "Tax Manager" role entered with Location "east london"
// returned 32 matches, only 12 of them UK-based — South Africa, the US, Canada, India and
// the UAE all got through. Root cause: postcodes.io's /places endpoint returns ZERO
// results for "east london" (confirmed directly), so the ROLE's own location failed to
// geocode, and filterByDistance's fallback for that case was `return candidates` —
// completely unfiltered, geography enforcement skipped entirely. Compass-direction area
// names are common recruiter shorthand, not a one-off typo — "south london" and "north
// manchester" fail the exact same way (confirmed directly), while stripping the prefix and
// retrying with "london" resolves correctly. So: strip a leading compass direction and
// retry once before giving up, instead of only handling "greater ".
function stripDirectionalPrefix(text) {
  const stripped = (text || '').replace(/^(east|west|north|south|central)\s+/i, '').trim();
  return stripped && stripped.toLowerCase() !== (text || '').trim().toLowerCase() ? stripped : null;
}

// (2026-08-05, same day as the fix above) The directional-prefix retry immediately caused
// a worse regression: candidates in "East London, Eastern Cape, South Africa, ZA" got
// extractPlaceName → "East London" → fails → stripDirectionalPrefix → "London" → resolves
// to LONDON, UK — so a South African candidate was scored 0 miles from a London role
// (confirmed live: Walter Nelson and Onke Nokwe, both East London ZA, both got
// distanceMiles: 0 the moment this shipped). Blindly retrying without checking WHOSE
// country the text names turns "can't geocode" into "confidently geocode to the wrong
// country," which is worse than the original bug. This also isn't unique to compass
// prefixes — extractPlaceName has always taken just the first comma segment regardless of
// country, so a candidate in "Cambridge, Ontario, Canada" or "London, Ontario, Canada"
// would resolve to the identically-named UK place too, pre-dating this fix entirely.
// Closing all of this the same way: if the full original text names a country other than
// the UK, never attempt to geocode it at all — let it fall through to filterByDistance's
// UK_HINTS text check instead, which correctly excludes it without risking a false match.
//
// Kept as named groups (not one flat alternation) because filterByDistance needs to reuse
// the SAME per-country pattern two ways: (1) here, to stop a candidate's location ever
// being geocoded against a same-named UK place, and (2) to detect when a ROLE's own
// location names a non-UK country and match candidates against that country by text
// instead of wrongly funnelling every non-UK role through the UK-only fallback (see
// filterByDistance's 2026-08-05 "Crypto Knight roles are genuinely US-based" fix below).
const COUNTRY_GROUPS = [
  { label: 'united states', re: /\b(united states|USA)\b/i },
  { label: 'south africa', re: /\b(south africa|eastern cape|western cape|gauteng)\b/i },
  { label: 'canada', re: /\b(canada|ontario|quebec|alberta|british columbia)\b/i },
  { label: 'india', re: /\bindia\b/i },
  { label: 'united arab emirates', re: /\b(united arab emirates|dubai|abu dhabi)\b/i },
  { label: 'australia', re: /\baustralia\b/i },
  { label: 'new zealand', re: /\bnew zealand\b/i },
  { label: 'ireland', re: /\bireland\b/i },
  { label: 'pakistan', re: /\bpakistan\b/i },
  { label: 'nigeria', re: /\bnigeria\b/i },
  { label: 'kenya', re: /\bkenya\b/i },
  { label: 'philippines', re: /\bphilippines\b/i },
  { label: 'singapore', re: /\bsingapore\b/i },
  { label: 'hong kong', re: /\bhong kong\b/i },
  { label: 'china', re: /\bchina\b/i },
  { label: 'germany', re: /\bgermany\b/i },
  { label: 'france', re: /\bfrance\b/i },
  { label: 'spain', re: /\bspain\b/i },
  { label: 'italy', re: /\bitaly\b/i },
  { label: 'netherlands', re: /\bnetherlands\b/i },
  { label: 'poland', re: /\bpoland\b/i },
  { label: 'romania', re: /\bromania\b/i },
  { label: 'brazil', re: /\bbrazil\b/i },
  { label: 'mexico', re: /\bmexico\b/i },
];
const NON_UK_COUNTRY_HINTS = new RegExp(COUNTRY_GROUPS.map(g => g.re.source).join('|'), 'i');
function detectNonUkCountry(text) {
  if (!text) return null;
  for (const g of COUNTRY_GROUPS) if (g.re.test(text)) return g;
  return null;
}

const geocodeCache = new Map();
async function geocodeLocation(text) {
  const key = (text || '').trim().toLowerCase();
  if (!key) return null;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  if (NON_UK_COUNTRY_HINTS.test(text)) {
    geocodeCache.set(key, null);
    return null;
  }

  const tryQuery = async (placeName) => {
    if (!placeName) return null;
    try {
      const url = `https://api.postcodes.io/places?q=${encodeURIComponent(placeName)}&limit=1`;
      const r = await fetch(url);
      const data = r.ok ? await r.json() : null;
      const hit = data?.result?.[0];
      if (hit && typeof hit.latitude === 'number' && typeof hit.longitude === 'number') {
        return { lat: hit.latitude, lon: hit.longitude };
      }
    } catch { /* fall through to next attempt / null */ }
    return null;
  };

  const placeName = extractPlaceName(text);
  let result = await tryQuery(placeName);
  if (!result) {
    // Second attempt: strip a leading compass direction ("East London" → "London") that
    // extractPlaceName's "greater " strip doesn't cover, and retry once. Safe now that the
    // NON_UK_COUNTRY_HINTS check above already ruled out this being a same-named place in
    // a different country.
    const directional = stripDirectionalPrefix(placeName);
    if (directional) result = await tryQuery(directional);
  }
  geocodeCache.set(key, result);
  return result;
}

function haversineMiles(a, b) {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// Geocodes the Role's Location once and each candidate's Location, attaches
// `.distanceMiles` to every candidate that resolved within MAX_COMMUTE_MILES, and drops
// anyone beyond it. Only ever called on an already-Claude-ranked shortlist (max 8), so
// worst case is ~9 sequential geocode calls — postcodes.io has no documented rate limit
// (unlike Nominatim's old ~1req/sec cap), so this no longer needs an enforced delay
// between calls and should add well under a second per call in practice.
//
// If the Role's Location itself doesn't geocode to a specific point — blank, "Remote", a
// bare country, or just a lookup failure — distance can't mean anything, so every
// candidate is returned unfiltered rather than silently dropping everyone. Same for a
// candidate whose own Location fails to geocode AND still looks plausibly UK-based
// (postcodes.io's Places data has gaps for very small/obscure locations) — kept
// undecorated rather than punished for a gap in the geocoder's coverage.
//
// But a candidate whose Location text doesn't even look UK-based (no England/Scotland/
// Wales/Northern Ireland/UK/GB mention) does NOT get that benefit of the doubt — added
// 2026-08-05 after the live test surfaced a candidate located in Iași, Romania matched
// to a Brentwood role. postcodes.io is UK-only by design, so it will never resolve a
// genuinely overseas location, and silently keeping those candidates unfiltered would
// reopen exactly the bug this whole fix exists to close.
const UK_HINTS = /\b(united kingdom|england|scotland|wales|northern ireland|gb|uk)\b/i;

async function filterByDistance(roleLocation, candidates) {
  const loc = (roleLocation || '').trim();
  if (!loc || !candidates.length) return candidates;

  // "Remote" roles have no fixed base to filter against — must stay unfiltered (this was
  // the pre-2026-08-05 behaviour and is still correct; only the "geocode genuinely failed"
  // case below needed tightening, not this one).
  if (/\bremote\b/i.test(loc)) return candidates;

  // (2026-08-05) TalentKnight isn't UK-only — Crypto Knight's roles are entered with
  // Location "United States". The Buckley Watson Tax Manager fix above made "role location
  // didn't geocode" fall back to a UK-only filter, which is correct for a genuinely UK role
  // with an obscure/misspelled place name, but WRONG for a role that's deliberately
  // non-UK — postcodes.io will never geocode "United States" (it's UK-only by design), so
  // every one of those roles would have silently had every real candidate excluded. Detect
  // the role's own country intent FIRST, before ever calling the UK geocoder on it: if the
  // Role's location names a specific non-UK country, match candidates by that same country
  // in their location text instead (no cross-border geocoding available yet, so text
  // matching is the best available signal) rather than defaulting to "must be UK."
  const roleCountry = detectNonUkCountry(loc);
  if (roleCountry) {
    return candidates.filter(c => !c.location || roleCountry.re.test(c.location));
  }

  // Presumed-UK role from here on (today's default and the actual common case).
  const roleGeo = await geocodeLocation(loc);
  if (!roleGeo) {
    // The Role's own location didn't resolve even after geocodeLocation's directional-
    // prefix retry — could be a genuinely obscure/misspelled UK place name (not "Remote"
    // or a named non-UK country, both already handled above). Either way, "can't compute
    // distance" must never again mean "skip geography filtering entirely" (that was the
    // root cause of the original Buckley Watson Tax Manager incident, 2026-08-05). Degrade
    // to a country-level filter instead: drop anyone whose location text has no UK
    // indication at all, keep the rest undecorated (no distanceMiles — genuinely unknown).
    return candidates.filter(c => !c.location || UK_HINTS.test(c.location));
  }

  const out = [];
  for (const c of candidates) {
    const geo = c.location ? await geocodeLocation(c.location) : null;
    if (!geo) {
      if (c.location && !UK_HINTS.test(c.location)) continue;
      out.push(c);
      continue;
    }
    const miles = haversineMiles(roleGeo, geo);
    if (miles <= MAX_COMMUTE_MILES) out.push({ ...c, distanceMiles: Math.round(miles * 10) / 10 });
  }
  return out;
}

// ── Notifications (optional, via Make.com) ────────────────────────
// No-op until MAKE_WEBHOOK_URL is set as an env var. Points at a Make.com scenario
// (Custom Webhook trigger → Send an email) that emails match alerts to the team.
// Originally Slack-shaped (SLACK_WEBHOOK_URL) — swapped 2026-08-04 since there's no
// TalentKnight Slack workspace, and Make was already in use for other TalentKnight
// automations (Airtable/Instantly integration, candidate enrichment). Text is plain
// (no Slack mrkdwn) since it's read as an email now, not a Slack message.
async function postNotification(text) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Best-effort — a notification failure should never block the caller.
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
//
// (2026-08-05) Also asks for a one-line `.summary` per candidate in the same call —
// the "AI Candidate Summaries" roadmap item (e.g. "10 years payroll bureau experience,
// Sage Payroll expert, lives 8 miles away, immediately available"), so recruiters don't
// have to open every profile to see why a match landed. Piggybacking on the existing
// ranking call means this costs zero extra API round-trips — just a bit more output.
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

  const system = `You are a recruitment matching assistant. Given a role brief and a numbered list of candidates, return ONLY a JSON array of objects for the strongest matches, best match first, maximum ${limit} entries. Each object must have "n" (the candidate's number from the list, integer), "score" (an integer 0-100 estimating how well they fit the role — 90+ excellent fit, 70-89 strong, 50-69 partial, below 50 only if you must include them to reach the list), and "summary" (a single plain-English sentence, max ~15 words, highlighting the most relevant experience/skills/location/availability for THIS role — written for a recruiter skimming a list, not the candidate). No markdown, no preamble, no explanation. Example: [{"n":3,"score":92,"summary":"8 years payroll bureau experience, Sage Payroll expert, based 8 miles away"},{"n":1,"score":78,"summary":"Strong Excel/reporting background but limited sector-specific exposure"}]`;
  const raw = await callClaude(system, `Role brief: ${briefText}\n\nCandidates:\n${listText}`, 900);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => {
        const cand = pool[(item?.n ?? 0) - 1];
        if (!cand) return null;
        const score = Math.max(0, Math.min(100, Math.round(Number(item?.score) || 0)));
        const summary = typeof item?.summary === 'string' ? item.summary.trim().slice(0, 200) : '';
        return { ...cand, fitScore: score, summary };
      })
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// Stages that count as "not meaningfully progressed yet" — safe to bounce/reset to
// 'Matched' when a fresh search re-surfaces this candidate for a Role. Anything past this
// (Contacted/Shortlisted/Interviewing/Offered/Placed) means a recruiter is already actively
// working the candidate for that specific Role, so a re-match should never silently stomp it.
const STAGE_RESET_SAFE = new Set(['', undefined, 'Sourced', 'Rejected', 'Matched']);

// Fetches every Role Matches row, paginated, normalized to {id, candidateId, roleId,
// fitScore, stage, stageChangedAt}. Linked-record fields can't be reliably filtered
// server-side via filterByFormula (same limitation noted in resolveAccess for Org Staff/
// Consultant Assignments), so callers fetch broadly and match client-side by candidateId/
// roleId membership. Fine at current table size; revisit with a real filter/index if the
// table grows into the thousands of rows.
async function fetchAllRoleMatches(h) {
  let all = [];
  let offset;
  do {
    const url = `https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}?returnFieldsByFieldId=true&pageSize=100${offset ? `&offset=${offset}` : ''}`;
    const res = await fetch(url, { headers: h }).then(r => r.json()).catch(() => ({ records: [] }));
    all = all.concat((res.records || []).map(rec => ({
      id: rec.id,
      candidateId: (rec.fields[RMF.candidate] || [])[0] || null,
      roleId: (rec.fields[RMF.role] || [])[0] || null,
      fitScore: typeof rec.fields[RMF.fitScore] === 'number' ? rec.fields[RMF.fitScore] : null,
      stage: rec.fields[RMF.pipelineStage] || '',
      stageChangedAt: rec.fields[RMF.stageChangedAt] || '',
      summary: rec.fields[RMF.summary] || '',
      notes: rec.fields[RMF.notes] || '',
      placementSalary: typeof rec.fields[RMF.placementSalary] === 'number' ? rec.fields[RMF.placementSalary] : null,
    })));
    offset = res.offset;
  } while (offset);
  return all;
}

// Writes/updates each candidate's Role Matches row for this specific Role — the one write
// path that actually lands a search result in the CRM's Matched column, now scoped
// per-Role instead of overwriting a flat per-Candidate field (see ROLE_MATCHES comment
// above for why that was a bug). Also appends to the Candidate's Assigned Role link (a
// simple "which Roles has this candidate ever touched" index, used by handleDashboard/
// candidateAllowed — unaffected by the per-Role score/stage fix since it was already a
// correctly-behaving multi-link field).
//
// Per-row reset-safety: a candidate with NO existing Role Matches row for this Role is
// always safe to create fresh as 'Matched' (brand new relationship for this Role, doesn't
// matter what their stage is on some other Role — that's handled separately by the
// cross-role PROTECTED_STAGES pool exclusion in runMatchSearch/handleRematchPool). A
// candidate who already has a row for THIS Role only gets reset to 'Matched' if that row's
// current stage is still reset-safe (STAGE_RESET_SAFE); otherwise we update the Fit Score
// but leave their stage alone and report them as notifyOnly so a recruiter can review.
//
// `candidates` is an array of {id, name, fitScore} (the shape rankPoolAgainstRole already
// returns), `allMatches` is a fetchAllRoleMatches(h) snapshot the caller fetched once.
async function upsertRoleMatches(candidates, roleId, roleTitle, allMatches, h) {
  if (!candidates.length) return { linked: [], notifyOnly: [] };
  const today = new Date().toISOString().split('T')[0];

  const existingByCandidate = {};
  allMatches.forEach(m => {
    if (m.roleId === roleId && m.candidateId) existingByCandidate[m.candidateId] = m;
  });

  const linked = [];
  const notifyOnly = [];
  const toCreate = [];
  const toUpdate = [];

  candidates.forEach(c => {
    const existing = existingByCandidate[c.id];
    const fields = {};
    if (c.fitScore != null) fields[RMF.fitScore] = c.fitScore;
    if (c.distanceMiles != null) fields[RMF.distanceMiles] = c.distanceMiles;
    if (c.summary) fields[RMF.summary] = c.summary;

    if (!existing) {
      fields[RMF.label] = `${c.name} → ${roleTitle}`;
      fields[RMF.candidate] = [c.id];
      fields[RMF.role] = [roleId];
      fields[RMF.pipelineStage] = 'Matched';
      fields[RMF.stageChangedAt] = today;
      toCreate.push({ fields });
      linked.push({ id: c.id, name: c.name });
    } else if (STAGE_RESET_SAFE.has(existing.stage)) {
      fields[RMF.pipelineStage] = 'Matched';
      fields[RMF.stageChangedAt] = today;
      toUpdate.push({ id: existing.id, fields });
      linked.push({ id: c.id, name: c.name });
    } else if (Object.keys(fields).length) {
      toUpdate.push({ id: existing.id, fields });
      notifyOnly.push({ id: c.id, name: c.name, currentStage: existing.stage });
    }
  });

  for (let i = 0; i < toCreate.length; i += 50) {
    await fetch(`https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ records: toCreate.slice(i, i + 50) }),
    }).catch(() => null);
  }
  for (let i = 0; i < toUpdate.length; i += 10) {
    await fetch(`https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ records: toUpdate.slice(i, i + 10) }),
    }).catch(() => null);
  }

  // Append this Role to the Candidate's Assigned Role index (multi-link, additive).
  const recordIds = candidates.map(c => c.id);
  const existingCands = await fetch(
    `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(`OR(${recordIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true&pageSize=100`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));
  const currentLinks = {};
  (existingCands.records || []).forEach(rec => { currentLinks[rec.id] = rec.fields[KF.assignedRole] || []; });

  for (let i = 0; i < recordIds.length; i += 10) {
    const batch = recordIds.slice(i, i + 10);
    await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({
        records: batch.map(id => {
          const links = new Set(currentLinks[id] || []);
          links.add(roleId);
          return { id, fields: { [KF.assignedRole]: [...links] } };
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
        // Vacancy Dashboard (2026-08-05) — visible to every viewer, same as location/brief.
        hiringManagerName: rec.fields[RF.hiringManagerName] || '',
        hiringManagerEmail: rec.fields[RF.hiringManagerEmail] || '',
        hiringManagerPhone: rec.fields[RF.hiringManagerPhone] || '',
        roleNotes: rec.fields[RF.roleNotes] || '',
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

      // Note: pipelineStage/fitScore/stageChangedAt/notes/placementSalary are intentionally
      // NOT read from the Candidate record here — those flat fields are frozen historical
      // snapshots (pipelineStage/fitScore/stageChangedAt as of the 2026-08-02 Role Matches
      // migration; notes/placementSalary as of the 2026-08-05 migration that fixed a live
      // cross-client confidentiality leak — see RMF comment near the top of this file).
      // Per-Role values are merged in below from Role Matches, once per Role, so a candidate
      // matched to 2+ Roles/Organizations gets the correct score/stage/notes/salary on each
      // Role's board instead of one shared value visible across every client.
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
      };
    });
  }

  // Per-Role Fit Score/Pipeline Stage/Stage Changed At, keyed by "roleId|candidateId" —
  // see ROLE_MATCHES comment near the top of this file for why this replaced flat fields.
  const matchByKey = {};
  if (allRoleIds.length) {
    (await fetchAllRoleMatches(h)).forEach(m => {
      if (m.roleId && m.candidateId) matchByKey[`${m.roleId}|${m.candidateId}`] = m;
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
            const roleCandidates = role.candidateIds
              .map(id => {
                const cand = candidateMap[id];
                if (!cand) return null;
                const m = matchByKey[`${role.id}|${id}`];
                const stage = m?.stage || 'Sourced';
                // Company Contacts never see staff-only stages (e.g. "Matched" — AI
                // matches awaiting recruiter review) even if linked to their role.
                if (!isStaff && STAFF_ONLY_STAGES.includes(stage)) return null;
                return {
                  ...cand,
                  fitScore: m?.fitScore ?? null,
                  pipelineStage: stage,
                  stageChangedAt: m?.stageChangedAt || '',
                  summary: m?.summary || '',
                  notes: m?.notes || '',
                  // Earnings pipeline — commercial data, never sent to Company Contacts.
                  placementSalary: isStaff ? (m?.placementSalary ?? null) : null,
                };
              })
              .filter(Boolean);
            const base = { ...role, candidateIds: undefined, candidates: roleCandidates };

            if (!isStaff) {
              // Commercial terms are staff-only — never expose fee/salary data to clients.
              delete base.feePercent;
              delete base.targetSalary;
              return base;
            }

            // Forecast = Fee % × Target Salary — the full potential fee if this Role closes,
            // not weighted by pipeline stage (Mike wanted the raw upside, not a probability-
            // discounted number). `probability` is still computed and kept on the Role purely
            // to drive the "X% likely" stage label in the Forecast table — it no longer
            // factors into forecastValue itself.
            // A Role with no candidates yet, or missing fee/salary terms, forecasts as null
            // rather than 0 — lets the UI distinguish "no data" from "genuinely worthless."
            const probability = roleCandidates.reduce((max, c) => Math.max(max, STAGE_WEIGHTS[c.pipelineStage] ?? 0), 0);
            base.probability = probability;
            base.forecastValue = (role.feePercent && role.targetSalary)
              ? Math.round(role.feePercent * role.targetSalary)
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

  // roleId is now required — Pipeline Stage lives on the Role Matches row for this
  // specific (candidate, role) pair, not on the Candidate record. Old clients sending
  // just {candidateId, stage} will get a 400 here; dashboard.html was updated alongside
  // this to always send roleId (it already has it in scope — the kanban board is
  // rendered per-Role).
  const { candidateId, roleId, stage } = req.body || {};
  if (!candidateId || !roleId || !stage) return res.status(400).json({ error: 'Missing fields' });

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

  // Checks access via the specific Role being updated, not candidateAllowed()'s
  // roleIds[0] shortcut (that only ever checked the FIRST role a candidate happened to
  // be linked to — could wrongly allow or deny access once a candidate is linked to
  // multiple Roles across different Companies). Mirrors the check handleFindMatches uses.
  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  const today = new Date().toISOString().split('T')[0];
  const allMatches = await fetchAllRoleMatches(h);
  const existing = allMatches.find(m => m.roleId === roleId && m.candidateId === candidateId);

  let upd;
  let candNameForLog = null;
  if (existing) {
    upd = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}/${existing.id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ fields: { [RMF.pipelineStage]: stage, [RMF.stageChangedAt]: today } }),
    }).then(r => r.json());
  } else {
    const candRec = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}/${candidateId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
    const candName = candRec?.fields?.[KF.name] || '';
    candNameForLog = candName;
    const roleTitle = roleRec.fields[RF.title] || '';
    upd = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ fields: {
        [RMF.label]: `${candName} → ${roleTitle}`,
        [RMF.candidate]: [candidateId], [RMF.role]: [roleId],
        [RMF.pipelineStage]: stage, [RMF.stageChangedAt]: today,
      } }),
    }).then(r => r.json());
  }

  // CRM Intelligence (2026-08-05): auto-log every stage change to Contact History so a
  // candidate's activity timeline reflects pipeline movement without recruiters having to
  // log it by hand. Best-effort — a logging failure should never fail the stage update
  // itself, which is why this runs after `upd` is already known to have succeeded.
  if (upd.id) {
    try {
      if (candNameForLog === null) {
        const candRec2 = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}/${candidateId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
        candNameForLog = candRec2?.fields?.[KF.name] || '';
      }
      await logContactHistory({
        candidateId, roleId, type: 'Stage Change',
        summary: `Stage changed to ${stage}`,
        label: `${candNameForLog} → ${stage}`,
        loggedBy: access.name,
      }, h);
    } catch { /* best-effort — never block the stage update on a logging failure */ }
  }

  return upd.id
    ? res.status(200).json({ ok: true, stage, stageChangedAt: today })
    : res.status(500).json({ error: 'Update failed' });
}

// ── CRM INTELLIGENCE (Contact History) ─────────────────────────────
// Shared writer used by both the auto-log-on-stage-change path above and the manual
// add-history action below. Staff-only concept — Company Contacts never write or read
// this table (internal call/note history isn't something to expose to clients).
async function logContactHistory({ candidateId, roleId, type, summary, label, loggedBy }, h) {
  const fields = {
    [CHF.candidate]: [candidateId],
    [CHF.type]: type,
    [CHF.summary]: summary,
    [CHF.loggedAt]: new Date().toISOString(),
    [CHF.loggedBy]: loggedBy || '',
    [CHF.label]: label || `${type} — ${summary}`.slice(0, 100),
  };
  if (roleId) fields[CHF.role] = [roleId];
  return fetch(`https://api.airtable.com/v0/${BASE}/${CONTACT_HISTORY}`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ fields }),
  }).then(r => r.json()).catch(() => null);
}

const CONTACT_HISTORY_TYPES = ['Note', 'Call', 'Email', 'Interview', 'Stage Change', 'Submission', 'Offer', 'Placement'];

// ── CANDIDATE HISTORY (read) ────────────────────────────────────────
// Returns a candidate's Contact History timeline, newest first. Fetches broadly then
// filters/sorts client-side, same pattern as fetchAllRoleMatches — Airtable's
// filterByFormula can't reliably match linked-record fields against a record ID (see that
// function's comment for the fuller explanation). Table is expected to stay small enough
// per-candidate that this is fine; revisit with a real filter if it ever isn't.
async function handleCandidateHistory(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const candidateId = req.query.candidateId;
  if (!candidateId) return res.status(400).json({ error: 'Missing candidateId' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const check = await candidateAllowed(candidateId, allCompanyIds, h);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  let all = [];
  let offset;
  do {
    const url = `https://api.airtable.com/v0/${BASE}/${CONTACT_HISTORY}?returnFieldsByFieldId=true&pageSize=100${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(url, { headers: h }).then(r => r.json()).catch(() => ({ records: [] }));
    all = all.concat(r.records || []);
    offset = r.offset;
  } while (offset);

  const entries = all
    .filter(rec => (rec.fields[CHF.candidate] || []).includes(candidateId))
    .map(rec => ({
      id: rec.id,
      type: rec.fields[CHF.type] || 'Note',
      summary: rec.fields[CHF.summary] || '',
      loggedAt: rec.fields[CHF.loggedAt] || rec.createdTime,
      loggedBy: rec.fields[CHF.loggedBy] || '',
    }))
    .sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt))
    .slice(0, 25);

  return res.status(200).json({ entries });
}

// ── ADD HISTORY (write) ─────────────────────────────────────────────
async function handleAddHistory(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { candidateId, roleId, type, summary } = req.body || {};
  if (!candidateId || !type || !summary?.trim()) return res.status(400).json({ error: 'Missing fields' });
  if (!CONTACT_HISTORY_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const check = await candidateAllowed(candidateId, allCompanyIds, h);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const written = await logContactHistory({
    candidateId, roleId: roleId || null, type, summary: summary.trim(),
    loggedBy: access.name,
  }, h);

  return written?.id
    ? res.status(200).json({ ok: true })
    : res.status(500).json({ error: 'Failed to log entry' });
}

// ── ROLE ACTIVITY (Vacancy Dashboard, 2026-08-05) ────────────────────
// Same Contact History table as handleCandidateHistory, but aggregated across every
// candidate touching this one Role instead of scoped to one candidate — lets a recruiter
// see the whole vacancy's timeline (stage changes, calls, notes) in one place without
// opening each candidate individually. Staff-only, same as candidate-level history.
async function handleRoleActivity(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const roleId = req.query.roleId;
  if (!roleId) return res.status(400).json({ error: 'Missing roleId' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  let all = [];
  let offset;
  do {
    const url = `https://api.airtable.com/v0/${BASE}/${CONTACT_HISTORY}?returnFieldsByFieldId=true&pageSize=100${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(url, { headers: h }).then(r => r.json()).catch(() => ({ records: [] }));
    all = all.concat(r.records || []);
    offset = r.offset;
  } while (offset);

  const relevant = all.filter(rec => (rec.fields[CHF.role] || []).includes(roleId));

  // Batch-fetch candidate names so each entry can show "who" — entries only carry a
  // candidateId, unlike the per-candidate history view where that's already known from context.
  const candIds = [...new Set(relevant.flatMap(rec => rec.fields[CHF.candidate] || []))];
  const candNameById = {};
  if (candIds.length) {
    const candRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(`OR(${candIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true&pageSize=100`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));
    (candRes.records || []).forEach(rec => { candNameById[rec.id] = rec.fields[KF.name] || 'Unknown'; });
  }

  const entries = relevant
    .map(rec => ({
      id: rec.id,
      type: rec.fields[CHF.type] || 'Note',
      summary: rec.fields[CHF.summary] || '',
      loggedAt: rec.fields[CHF.loggedAt] || rec.createdTime,
      loggedBy: rec.fields[CHF.loggedBy] || '',
      candidateId: (rec.fields[CHF.candidate] || [])[0] || null,
      candidateName: candNameById[(rec.fields[CHF.candidate] || [])[0]] || 'Unknown',
    }))
    .sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt))
    .slice(0, 40);

  return res.status(200).json({ entries });
}

// ── SIMILAR LIVE CANDIDATES (Vacancy Dashboard, 2026-08-05) ──────────
// Read-only suggestion panel for a Role — "who else in the pool looks like a fit" without
// actually linking anyone. Deliberately separate from Find Matches (runMatchSearch): this
// never writes Assigned Role/Matched stage, never kicks off an Apify run, and uses a lower
// soft floor (45, matching AI Recruiter Assistant's exploratory bar) rather than
// MIN_MATCH_SCORE's stricter auto-link threshold (60) — it's advisory, a recruiter decides
// whether to act on it. Excludes candidates already on this Role's board and anyone in a
// PROTECTED_STAGES match elsewhere (same reasoning as runMatchSearch — don't suggest
// poaching someone mid-process on another Role).
async function handleSimilarCandidates(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const roleId = req.query.roleId;
  if (!roleId) return res.status(400).json({ error: 'Missing roleId' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  const title = roleRec.fields[RF.title] || '';
  const location = roleRec.fields[RF.location] || '';
  const brief = roleRec.fields[RF.brief] || '';
  const existingCandidateIds = new Set(roleRec.fields[RF.candidates] || []);

  const briefText = [title, location, brief].filter(Boolean).join(' — ');
  const keywords = extractKeywords(briefText);
  if (!keywords.length) return res.status(200).json({ results: [] });

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
  const formula = `AND(${typeFilter}, ${buildKeywordFilter(fieldChecks)})`;

  const poolRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(formula)}&pageSize=60&returnFieldsByFieldId=true`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));

  const allMatches = await fetchAllRoleMatches(h);
  const protectedIds = new Set(
    allMatches.filter(m => PROTECTED_STAGES.includes(m.stage)).map(m => m.candidateId)
  );

  const pool = (poolRes.records || []).map(rec => ({
    id: rec.id,
    name: rec.fields[KF.name] || '',
    role: rec.fields[KF.role] || '',
    company: rec.fields[KF.company] || '',
    location: rec.fields[KF.location] || '',
    sector: rec.fields[KF.sector] || '',
    bio: rec.fields[KF.bio] || '',
    linkedinUrl: rec.fields[KF.linkedinUrl] || '',
    photoUrl: rec.fields[KF.photoUrl] || '',
  })).filter(c => c.name && !existingCandidateIds.has(c.id) && !protectedIds.has(c.id));

  let ranked = (await rankPoolAgainstRole(briefText, pool, 6)).filter(c => c.fitScore >= 45);
  ranked = await filterByDistance(location, ranked);

  return res.status(200).json({ results: ranked.slice(0, 5) });
}

// ── AI RECRUITER ASSISTANT ───────────────────────────────────────────
// Free-text natural-language search across the WHOLE candidate base — "find someone
// similar to Holly but with payroll bureau experience", "candidates within 15 miles who
// know CIS". Unlike Find Matches, this isn't scoped to one Role's brief and never writes
// anything (no Role Matches created, no pipeline stage touched) — it's a read-only
// exploratory search, so there's no need to exclude PROTECTED_STAGES candidates or
// restrict by Candidate Type the way runMatchSearch does for actual role-linking.
//
// Reuses the exact same building blocks as role matching: extractKeywords() +
// buildKeywordFilter() to cheaply narrow Airtable's ~8000 candidates down to a plausible
// pool server-side, then rankPoolAgainstRole() (the query text standing in for a Role's
// brief) to get Claude-scored results with a one-line "why" summary — the same mechanism
// that already powers Fit Score/AI Candidate Summaries, just pointed at free text instead
// of a Role record.
//
// Known limitation, not fixed here: a query like "similar to Sean" only works well if
// Sean's own skills/sector words happen to overlap with other candidates' profile text —
// there's no special-case lookup that fetches Sean's actual record to compare against.
// Good enough for a first version; flagging in case results for name-comparison queries
// feel weaker than skill/location queries.
async function handleAssistantSearch(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const query = (req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing query' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });

  const keywords = extractKeywords(query);
  if (!keywords.length) {
    return res.status(200).json({ results: [], note: 'Try adding more specific skills, job titles, or locations to your search.' });
  }

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
  const formula = buildKeywordFilter(fieldChecks);

  const poolRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(formula)}&pageSize=60&returnFieldsByFieldId=true`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));

  const pool = (poolRes.records || []).map(rec => {
    const f = rec.fields;
    const consented = f[KF.outreachStatus] === 'Interested';
    const rawCompany = f[KF.company] || '';
    const company = /^\d+$/.test(rawCompany.trim()) ? '' : rawCompany;
    return {
      id: rec.id,
      name: f[KF.name] || '',
      role: f[KF.role] || '',
      company,
      location: f[KF.location] || '',
      sector: f[KF.sector] || '',
      bio: f[KF.bio] || '',
      linkedinUrl: f[KF.linkedinUrl] || '',
      email: consented ? (f[KF.personalEmail] || '') : '',
      phone: consented ? (f[KF.mobile] || '') : '',
      // Notes intentionally omitted here — this is a role-free, pool-wide search (no
      // single client relationship to scope a note to), so there's no safe per-role value
      // to show. See RMF comment near the top of this file for the cross-client leak this
      // avoids repeating.
      photoUrl: f[KF.photoUrl] || '',
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
    };
  }).filter(c => c.name);

  // Soft floor, not MIN_MATCH_SCORE (60) — that threshold is tuned for "should this be
  // auto-linked as a real Role match", which is a higher bar than "worth showing a
  // recruiter browsing results for a loose free-text query".
  const ranked = (await rankPoolAgainstRole(query, pool, 10)).filter(c => c.fitScore >= 40);

  return res.status(200).json({ results: ranked });
}

// ── RICH CLIENT RECORDS ──────────────────────────────────────────────
// Full client profile: company details, main contact, terms, open vacancies, placement
// history, and recent activity. Placement history and activity are entirely derived from
// data that already exists (Role Matches + Contact History) — no new tables needed for
// those. Only the company-profile fields themselves (website, industry, main contact,
// etc.) are new Airtable fields, added 2026-08-05 directly on Companies.
async function handleCompanyRecord(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const companyId = req.query.companyId;
  if (!companyId) return res.status(400).json({ error: 'Missing companyId' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  if (!allCompanyIds.includes(companyId)) return res.status(403).json({ error: 'Company not in your access scope' });

  const companyRec = await fetch(`https://api.airtable.com/v0/${BASE}/${COMPANIES}/${companyId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!companyRec?.id) return res.status(404).json({ error: 'Company not found' });
  const cf = companyRec.fields;

  const roleIds = cf[CF.roles] || [];
  let roles = [];
  let placements = [];
  let activity = [];

  if (roleIds.length) {
    const rolesRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${ROLES}?filterByFormula=${encodeURIComponent(`OR(${roleIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true&pageSize=100`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));

    roles = (rolesRes.records || []).map(rec => ({
      id: rec.id,
      title: rec.fields[RF.title] || 'Untitled Role',
      status: rec.fields[RF.status] || 'Active',
      candidateCount: (rec.fields[RF.candidates] || []).length,
    }));
    const roleTitleById = Object.fromEntries(roles.map(r => [r.id, r.title]));

    const allMatches = await fetchAllRoleMatches(h);
    const placedMatches = allMatches.filter(m => roleIds.includes(m.roleId) && m.stage === 'Placed');

    if (placedMatches.length) {
      const candIds = [...new Set(placedMatches.map(m => m.candidateId))];
      const candRes = await fetch(
        `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(`OR(${candIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true&pageSize=100`,
        { headers: h }
      ).then(r => r.json()).catch(() => ({ records: [] }));
      const candNameById = {};
      (candRes.records || []).forEach(rec => {
        candNameById[rec.id] = rec.fields[KF.name] || 'Unknown';
      });
      // placementSalary comes from the Role Matches row (m.placementSalary), not a flat
      // Candidate field — see RMF comment near the top of this file. This is naturally
      // already scoped correctly here since placedMatches is filtered to this company's
      // own roleIds.
      placements = placedMatches
        .map(m => ({
          candidateId: m.candidateId,
          candidateName: candNameById[m.candidateId] || 'Unknown',
          roleTitle: roleTitleById[m.roleId] || 'Untitled Role',
          placementSalary: m.placementSalary ?? null,
          placedAt: m.stageChangedAt || '',
        }))
        .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
    }

    // Recent activity: Contact History entries scoped to this company's roles. Same
    // fetch-broadly-then-filter-client-side pattern as fetchAllRoleMatches/
    // handleCandidateHistory — linked-record fields can't be reliably matched via
    // filterByFormula.
    let allHistory = [];
    let offset;
    do {
      const url = `https://api.airtable.com/v0/${BASE}/${CONTACT_HISTORY}?returnFieldsByFieldId=true&pageSize=100${offset ? `&offset=${offset}` : ''}`;
      const r = await fetch(url, { headers: h }).then(r => r.json()).catch(() => ({ records: [] }));
      allHistory = allHistory.concat(r.records || []);
      offset = r.offset;
    } while (offset);

    activity = allHistory
      .filter(rec => (rec.fields[CHF.role] || []).some(id => roleIds.includes(id)))
      .map(rec => ({
        id: rec.id,
        type: rec.fields[CHF.type] || 'Note',
        summary: rec.fields[CHF.summary] || '',
        loggedAt: rec.fields[CHF.loggedAt] || rec.createdTime,
        loggedBy: rec.fields[CHF.loggedBy] || '',
      }))
      .sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt))
      .slice(0, 20);
  }

  return res.status(200).json({
    company: {
      id: companyRec.id,
      name: cf[CF.name] || 'Untitled Company',
      website: cf[CF.website] || '',
      industry: cf[CF.industry] || '',
      companySize: cf[CF.companySize] || '',
      linkedinUrl: cf[CF.linkedinUrl] || '',
      mainContactName: cf[CF.mainContactName] || '',
      mainContactTitle: cf[CF.mainContactTitle] || '',
      mainContactEmail: cf[CF.mainContactEmail] || '',
      mainContactPhone: cf[CF.mainContactPhone] || '',
      feeTerms: cf[CF.feeTerms] || '',
      officeLocations: cf[CF.officeLocations] || '',
      notes: cf[CF.notes] || '',
      createdDate: cf[CF.createdDate] || '',
      chNumber: cf[CF.chNumber] || '',
    },
    roles,
    placements,
    activity,
  });
}

async function handleUpdateCompany(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { companyId, ...updates } = req.body || {};
  if (!companyId) return res.status(400).json({ error: 'Missing companyId' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  if (!allCompanyIds.includes(companyId)) return res.status(403).json({ error: 'Company not in your access scope' });

  // Only the editable profile fields — deliberately excludes name/active/roles/notes'
  // sibling tables etc. Whatever the frontend sends for these keys overwrites the field;
  // keys not present in the request body are left untouched (a real partial update, not
  // a full-record overwrite).
  const EDITABLE = {
    website: CF.website, industry: CF.industry, companySize: CF.companySize, linkedinUrl: CF.linkedinUrl,
    mainContactName: CF.mainContactName, mainContactTitle: CF.mainContactTitle,
    mainContactEmail: CF.mainContactEmail, mainContactPhone: CF.mainContactPhone,
    feeTerms: CF.feeTerms, officeLocations: CF.officeLocations, notes: CF.notes,
    // Lets staff switch on AI Client Intelligence monitoring for a client without needing
    // Airtable access — see handleClientIntelligenceScan, which silently skips any Company
    // with this field blank.
    chNumber: CF.chNumber,
  };
  const fields = {};
  for (const [key, fieldId] of Object.entries(EDITABLE)) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) fields[fieldId] = updates[key] ?? '';
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });

  const upd = await fetch(`https://api.airtable.com/v0/${BASE}/${COMPANIES}/${companyId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ fields }),
  }).then(r => r.json()).catch(() => null);

  return upd?.id
    ? res.status(200).json({ ok: true })
    : res.status(500).json({ error: 'Failed to save' });
}

// ── CREATE COMPANY (self-serve "+ New client", added 2026-08-06) ──────────
// Until now every Company record (Buckley Watson, the TBC placeholders, Cyber Knight's
// whole client list) had to be created directly in Airtable — there was no dashboard path
// at all, only "+ New role" under an ALREADY-existing Client. Mike hit this gap live while
// trying to onboard a new Armstrong Knight client. Mirrors handleCreateRole's pattern.
//
// Restricted to Organization Admins, not Consultants. Consultants are scoped to specific
// Companies via the Consultant Assignments table (see resolveAccess) — if a Consultant
// created a brand-new Company themselves, they wouldn't even see it afterward until an
// Admin assigned them to it, which would look like the button silently failed. Admins see
// every Company in their Organization automatically, so this is unambiguous for them.
// resolveAccess() deliberately doesn't expose tier on its returned organizations (nothing
// else needed it), so this re-fetches the caller's own Org Staff record(s) to check it.
async function handleCreateCompany(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { organizationId, name, website, industry, officeLocations } = req.body || {};
  if (!organizationId || !name?.trim()) return res.status(400).json({ error: 'organizationId and name are required' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });
  if (!access.organizations.some(o => o.id === organizationId)) {
    return res.status(403).json({ error: 'Organization not in your access scope' });
  }

  const staffRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${ORG_STAFF}?filterByFormula=${encodeURIComponent(`AND({${OSF.clerkId}}='${clerkUserId}',{${OSF.active}}=1)`)}&returnFieldsByFieldId=true&pageSize=100`,
    { headers: h }
  ).then(r => r.json()).catch(() => ({ records: [] }));
  const isAdminHere = (staffRes.records || []).some(s =>
    (s.fields[OSF.organization] || [])[0] === organizationId && s.fields[OSF.tier] === 'Admin'
  );
  if (!isAdminHere) return res.status(403).json({ error: 'Only an Organization Admin can add a new client.' });

  const createRes = await fetch(`https://api.airtable.com/v0/${BASE}/${COMPANIES}`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ fields: {
      [CF.name]: name.trim(),
      [CF.active]: true,
      [CF.organization]: [organizationId],
      [CF.website]: website?.trim() || '',
      [CF.industry]: industry?.trim() || '',
      [CF.officeLocations]: officeLocations?.trim() || '',
      [CF.createdDate]: new Date().toISOString().slice(0, 10),
    } }),
  }).then(r => r.json()).catch(() => null);

  return createRes?.id
    ? res.status(200).json({ ok: true, companyId: createRes.id, name: name.trim() })
    : res.status(500).json({ error: 'Failed to create client' });
}

// ── SAVE NOTES ────────────────────────────────────────────────────
async function handleSaveNotes(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  // roleId is now required — Notes live on the Role Matches row for this specific
  // (candidate, role) pair, not on the shared Candidate record. That flat field was a
  // real cross-client confidentiality leak (a note written for one Organization's client
  // was visible on every other Organization's board the candidate happened to be linked
  // to — confirmed live on Harriet Voss and Owen Pearce, 2026-08-05). Old clients sending
  // just {candidateId, notes} get a 400 here; dashboard.html was updated alongside this to
  // always send roleId (the drawer only allows editing notes when opened in role context).
  // Mirrors handleUpdateStage's access check and upsert pattern.
  const { candidateId, roleId, notes } = req.body || {};
  if (!candidateId || !roleId) return res.status(400).json({ error: 'Missing fields' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  const allMatches = await fetchAllRoleMatches(h);
  const existing = allMatches.find(m => m.roleId === roleId && m.candidateId === candidateId);

  let upd;
  if (existing) {
    upd = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}/${existing.id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ fields: { [RMF.notes]: String(notes ?? '') } }),
    }).then(r => r.json());
  } else {
    const candRec = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}/${candidateId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
    const candName = candRec?.fields?.[KF.name] || '';
    const roleTitle = roleRec.fields[RF.title] || '';
    upd = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ fields: {
        [RMF.label]: `${candName} → ${roleTitle}`,
        [RMF.candidate]: [candidateId], [RMF.role]: [roleId],
        [RMF.notes]: String(notes ?? ''),
      } }),
    }).then(r => r.json());
  }

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
    const keywordFilter = buildKeywordFilter(fieldChecks);
    // Cross-role PROTECTED_STAGES exclusion used to be a filterByFormula check against the
    // (now-frozen) flat KF.pipelineStage field — moved to a client-side check against
    // Role Matches below, since stage is per-Role now and there's no single flat field
    // left to filter on server-side.
    const formula = `AND(${typeFilter}, ${keywordFilter})`;

    const poolRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(formula)}&pageSize=60&returnFieldsByFieldId=true`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));

    const allMatches = await fetchAllRoleMatches(h);
    const protectedIds = new Set(
      allMatches.filter(m => PROTECTED_STAGES.includes(m.stage)).map(m => m.candidateId)
    );

    const pool = (poolRes.records || []).map(rec => ({
      id: rec.id,
      name: rec.fields[KF.name] || '',
      role: rec.fields[KF.role] || '',
      company: rec.fields[KF.company] || '',
      location: rec.fields[KF.location] || '',
      sector: rec.fields[KF.sector] || '',
      bio: rec.fields[KF.bio] || '',
    })).filter(c => c.name && !protectedIds.has(c.id));

    matched = (await rankPoolAgainstRole(briefText, pool, 8)).filter(c => c.fitScore >= MIN_MATCH_SCORE);
    matched = await filterByDistance(location, matched);

    if (matched.length) {
      const { linked, notifyOnly } = await upsertRoleMatches(matched, roleId, title, allMatches, h);
      if (linked.length) postNotification(`${linked.length} candidate(s) matched to ${title || 'a role'}: ${linked.map(c => c.name).join(', ')}`);
      if (notifyOnly.length) postNotification(`${notifyOnly.map(c => c.name).join(', ')} also fit ${title || 'a role'} but ${notifyOnly.length === 1 ? 'is' : 'are'} already active elsewhere on this role (stage untouched) — worth a look.`);
    }
  }

  // Kick off a live LinkedIn top-up in the background — frontend polls find-matches-poll
  // separately, this call only needs to start the run and hand back its ID. "Full" mode
  // captures skills/industry/summary per profile (not just name+headline like "Short"),
  // so every candidate this saves is genuinely searchable later, not more sparse-pool rubbish.
  //
  // Two silent-failure modes found 2026-08-04 investigating zero-match Armstrong Knight test
  // roles (Service Desk Analyst; Bookeeping/Client Bookkeeper) — every run showed "Succeeded"
  // in Apify with 0 results, nothing surfaced anywhere in the app:
  //   1. The actor's own field docs warn a bare "UK" in a location string gets misread as
  //      "Ukraine" (must be "United Kingdom") — "Shenfield, Essex, UK" 404'd as an unrecognized
  //      location, while "benfleet" alone (no "UK" token) resolved fine.
  //   2. `currentJobTitles` is a strict filter on a LinkedIn profile's exact current title.
  //      Fine for the short canonical titles apify-search.js/apify-start.js extract via regex
  //      (Manager, Engineer, etc.), but a literal full Role Title like "Client Bookkeeper" or
  //      a compound like "Service desk analyst, 2nd line support" matches almost nobody's
  //      literal LinkedIn title. Dropped in favor of `searchQuery` alone, which the actor
  //      documents as fuzzy and already carries the same title text.
  // A third, related finding the same day: even once "Shenfield" resolves correctly, a single
  // small town returns almost nothing (confirmed: 4 candidates for Service Desk Analyst in
  // Brentwood, all sharing the identical normalized location string) — the actor's `locations`
  // filter has no radius/distance parameter at all (checked the full input schema), it's a
  // strict exact match against one LinkedIn geo entity. A same-day attempt to fix this by having
  // Claude expand one town into several nearby commutable towns (`expandLocationForSearch()`,
  // Fix #5) was reverted 2026-08-05 after confirming via Vercel logs that even a well-formed
  // multi-town array still returns 0 results from the actor. Real "search within X miles"
  // behavior is now handled entirely after the fact by `filterByDistance()` above (see its
  // comment) — this first-pass search just uses the single normalized Role Location.
  let runId = null;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (APIFY_TOKEN && title) {
    try {
      const actorInput = { profileScraperMode: 'Full', maxItems: 25, searchQuery: title };
      if (location) actorInput.locations = [normalizeLocation(location)];
      console.log('[find-matches] actorInput for role', JSON.stringify({ title, roleLocation: location, locations: actorInput.locations }));
      const startUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}&memory=256`;
      const r = await fetch(startUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(actorInput) });
      if (r.ok) {
        const d = await r.json();
        runId = d?.data?.id || null;
        console.log('[find-matches] apify run started', runId);
      } else {
        console.log('[find-matches] apify run start failed', r.status, await r.text().catch(() => ''));
      }
    } catch { /* live top-up is best-effort — pool results above still stand */ }
  }

  return {
    matchedCount: matched.length,
    matched: matched.map(c => ({ id: c.id, name: c.name, fitScore: c.fitScore, distanceMiles: c.distanceMiles ?? null })),
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

  const { runId, roleId, retry } = req.query;
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

  // Location-not-recognized fallback, added 2026-08-04 — found investigating the
  // "Service desk analyst, 2nd line support" role (Location: "Shenfield") returning zero
  // live matches. The actor's own log showed a 404 "Input location \"Shenfield\" is not
  // recognized by LinkedIn" — but the actor run itself still reports SUCCEEDED with an
  // empty dataset, so nothing ever surfaced as an error anywhere in the app. Bare small-town
  // names (no county/country) are the trigger; big cities/countries (e.g. "United States")
  // resolve fine, so there's no reliable way to pre-validate every location string a
  // recruiter might type. Instead: if the first run comes back SUCCEEDED with 0 items and
  // this isn't already a retry, kick a second run for the same Role title with no location
  // filter at all (nationwide UK/wherever), and hand the frontend that new runId to keep
  // polling — degrades to a broader search instead of silently reporting nothing.
  if (raw.length === 0 && retry !== '1' && APIFY_TOKEN) {
    const title = roleRec.fields[RF.title];
    // Diagnostic log, added 2026-08-04 — confirms when this nationwide fallback actually
    // fires. As of 2026-08-05 the first-pass search uses a single normalized Role Location
    // (see normalizeLocation() — the multi-town AI-expansion this comment used to reference
    // was reverted), and whatever this fallback surfaces gets run back through
    // filterByDistance() below just like the first pass would have, so a Manchester result
    // for a Brentwood role still can't slip through even on the nationwide path.
    console.log('[find-matches-poll] first pass returned 0, triggering nationwide fallback', JSON.stringify({ runId, roleId, title }));
    if (title) {
      try {
        const retryInput = { profileScraperMode: 'Full', maxItems: 25, searchQuery: title };
        const retryStartUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}&memory=256`;
        const rr = await fetch(retryStartUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(retryInput) });
        if (rr.ok) {
          const rd = await rr.json();
          const newRunId = rd?.data?.id;
          console.log('[find-matches-poll] nationwide retry run started', newRunId);
          if (newRunId) return res.status(200).json({ status: 'RUNNING', runId: newRunId, retry: '1' });
        }
      } catch { /* fall through to normal 0-result handling below */ }
    }
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

  // Distance filtering matters most here: this is the path that also handles the
  // nationwide-fallback dataset (see the "Location-not-recognized fallback" comment
  // above) — without it, a role in Brentwood with no local LinkedIn hits could silently
  // link candidates from Manchester or Doncaster. Applied after Claude's fit-score
  // ranking, so it only ever runs against an already-short (max 8) list.
  let ranked = (await rankPoolAgainstRole(briefText, resolved, 8)).filter(c => c.fitScore >= MIN_MATCH_SCORE);
  ranked = await filterByDistance(roleLoc, ranked);
  let linked = [], notifyOnly = [];
  if (ranked.length) {
    const allMatches = await fetchAllRoleMatches(h);
    ({ linked, notifyOnly } = await upsertRoleMatches(ranked, roleId, roleTitle, allMatches, h));
    if (linked.length) postNotification(`${linked.length} new LinkedIn candidate(s) matched to ${roleTitle || 'a role'}: ${linked.map(c => c.name).join(', ')}`);
    if (notifyOnly.length) postNotification(`${notifyOnly.map(c => c.name).join(', ')} also fit ${roleTitle || 'a role'} but already active elsewhere on this role — worth a look.`);
  }

  return res.status(200).json({
    status: 'SUCCEEDED',
    matchedCount: ranked.length,
    matched: ranked.map(c => ({ id: c.id, name: c.name, fitScore: c.fitScore, distanceMiles: c.distanceMiles ?? null })),
  });
}

// ── REMATCH POOL (background, cron-triggered) ─────────────────────
// Runs once daily via Vercel Cron (see vercel.json "crons"). Re-checks every Active Role
// against the *current* full candidate pool — not just at Role-creation time, and not
// only when someone clicks "Find matches" — so candidates added or enriched after a
// Role was created still get surfaced against it, and candidates rejected from one role
// get a chance at others. Reuses the exact same keyword-filter + Claude-ranking path as
// the live "Find matches" button; the only difference is what triggers it and that it
// loops every Active Role instead of just one. Posts an email summary if
// MAKE_WEBHOOK_URL is configured — otherwise a silent no-op until that's set up.
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
    const keywordFilter = buildKeywordFilter(fieldChecks);
    // Cross-role PROTECTED_STAGES exclusion moved client-side (see runMatchSearch comment) —
    // fetched fresh each loop iteration so a stage change written for an earlier Role in
    // this same run is reflected before the next Role's pool is filtered.
    const formula = `AND(${typeFilter}, ${keywordFilter})`;

    const poolRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${CANDIDATES}?filterByFormula=${encodeURIComponent(formula)}&pageSize=60&returnFieldsByFieldId=true`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));

    const allMatches = await fetchAllRoleMatches(h);
    const protectedIds = new Set(
      allMatches.filter(m => PROTECTED_STAGES.includes(m.stage)).map(m => m.candidateId)
    );
    const alreadyOnThisRole = new Set(
      allMatches.filter(m => m.roleId === role.id).map(m => m.candidateId)
    );

    const pool = (poolRes.records || []).map(rec => ({
      id: rec.id,
      name: rec.fields[KF.name] || '',
      role: rec.fields[KF.role] || '',
      company: rec.fields[KF.company] || '',
      location: rec.fields[KF.location] || '',
      sector: rec.fields[KF.sector] || '',
      bio: rec.fields[KF.bio] || '',
    // Skip candidates already linked to this exact Role (nothing new to surface) and
    // anyone currently Interviewing/Offered/Placed on a DIFFERENT Role (protected).
    })).filter(c => c.name && !alreadyOnThisRole.has(c.id) && !protectedIds.has(c.id));

    if (!pool.length) continue;

    let matched = (await rankPoolAgainstRole(briefText, pool, 8)).filter(c => c.fitScore >= MIN_MATCH_SCORE);
    // geocodeLocation()'s cache is module-level and persists across this loop's iterations
    // (not just within one role), so candidates who show up in more than one role's
    // shortlist only ever get geocoded once per cron run — keeps the added latency from
    // compounding too badly across a base with many Active Roles.
    matched = await filterByDistance(role.location, matched);
    if (!matched.length) continue;

    const { linked, notifyOnly } = await upsertRoleMatches(matched, role.id, role.title, allMatches, h);
    totalLinked += linked.length;
    totalNotify += notifyOnly.length;
    if (linked.length) summaryLines.push(`*${role.title}*: +${linked.length} new match(es) — ${linked.map(c => c.name).join(', ')}`);
    if (notifyOnly.length) summaryLines.push(`*${role.title}*: ${notifyOnly.map(c => c.name).join(', ')} also fit but already active elsewhere on this role — review manually`);
  }

  if (summaryLines.length) {
    await postNotification(`Daily rematch — ${totalLinked} new match(es), ${totalNotify} cross-role flag(s) across ${roles.length} active role(s):\n${summaryLines.join('\n')}`);
  }

  return res.status(200).json({ ok: true, rolesChecked: roles.length, totalLinked, totalNotify });
}

// ── AI CLIENT INTELLIGENCE (roadmap item #8, added 2026-08-05) ────────────
// Monitors every Company across all Organizations that has a Companies House Number set
// (CF.chNumber) for director appointments/resignations, registered office moves, accounts
// filed, confirmation statements filed, and company status changes. v1 deliberately limited
// to Companies House — it's free, requires no per-request cost, and needs only a one-time
// API key signup (see COMPANIES_HOUSE_API_KEY below). Funding announcements and LinkedIn
// activity signals from the original roadmap wishlist are deferred — there's no free/
// reliable API for either, and Mike explicitly chose "start with what's free and reliable"
// over a paid data source when this was scoped.
//
// Basic Auth per Companies House's REST API convention: API key as the username, blank
// password. Docs: https://developer-specs.company-information.service.gov.uk/
async function fetchChJson(path, apiKey) {
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  try {
    const r = await fetch(`https://api.company-information.service.gov.uk${path}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function formatChAddress(addr) {
  if (!addr) return '';
  return [addr.address_line_1, addr.address_line_2, addr.locality, addr.region, addr.postal_code, addr.country]
    .filter(Boolean).join(', ');
}

// Pulls the four data points that matter for this feature in parallel: company profile
// (status + registered office), officers (filtered to directors only — a new company
// secretary isn't the kind of signal a recruiter needs to act on), and the most recent
// accounts + confirmation-statement filings. Only ACTIVE directors (resignedOn null) are
// kept in the snapshot — diffChSnapshots() below compares the active-name set between two
// snapshots rather than tracking every resignedOn change individually, which is simpler and
// sufficient: an appointment shows up as a name newly in the active set, a resignation as a
// name newly missing from it.
async function fetchCompanyHouseSnapshot(companyNumber, apiKey) {
  const [profile, officersRes, accountsRes, confirmRes] = await Promise.all([
    fetchChJson(`/company/${companyNumber}`, apiKey),
    fetchChJson(`/company/${companyNumber}/officers?items_per_page=50`, apiKey),
    fetchChJson(`/company/${companyNumber}/filing-history?category=accounts&items_per_page=1`, apiKey),
    fetchChJson(`/company/${companyNumber}/filing-history?category=confirmation-statement&items_per_page=1`, apiKey),
  ]);
  if (!profile) return null;
  const officers = (officersRes?.items || [])
    .filter(o => /director/i.test(o.officer_role || ''))
    .map(o => ({ name: o.name, role: o.officer_role, resignedOn: o.resigned_on || null }));
  return {
    status: profile.company_status || '',
    officeAddress: formatChAddress(profile.registered_office_address),
    officers,
    lastAccountsDate: accountsRes?.items?.[0]?.date || null,
    lastConfirmationDate: confirmRes?.items?.[0]?.date || null,
    checkedAt: new Date().toISOString().slice(0, 10),
  };
}

// Compares two snapshots and returns the list of detected events. Called only when a
// PREVIOUS snapshot already exists — the very first check for a newly-added Companies House
// Number just stores the initial snapshot with no diff, so a company that's had the same 5
// directors for years doesn't flood Client Signals with 5 fake "appointed" events the moment
// monitoring switches on.
function diffChSnapshots(prev, cur) {
  const events = [];
  const prevActive = new Set((prev.officers || []).filter(o => !o.resignedOn).map(o => o.name));
  const curActive = new Set((cur.officers || []).filter(o => !o.resignedOn).map(o => o.name));
  for (const name of curActive) {
    if (!prevActive.has(name)) events.push({ type: 'Director Appointed', detail: `${name} was appointed as a director.`, raw: { name } });
  }
  for (const name of prevActive) {
    if (!curActive.has(name)) events.push({ type: 'Director Resigned', detail: `${name} resigned as a director.`, raw: { name } });
  }
  if (prev.officeAddress && cur.officeAddress && prev.officeAddress !== cur.officeAddress) {
    events.push({ type: 'Registered Office Changed', detail: `Registered office moved from "${prev.officeAddress}" to "${cur.officeAddress}".`, raw: { from: prev.officeAddress, to: cur.officeAddress } });
  }
  if (prev.status && cur.status && prev.status !== cur.status) {
    events.push({ type: 'Company Status Changed', detail: `Company status changed from "${prev.status}" to "${cur.status}".`, raw: { from: prev.status, to: cur.status } });
  }
  if (prev.lastAccountsDate && cur.lastAccountsDate && prev.lastAccountsDate !== cur.lastAccountsDate) {
    events.push({ type: 'Accounts Filed', detail: `New accounts filed (made up to ${cur.lastAccountsDate}).`, raw: { date: cur.lastAccountsDate } });
  }
  if (prev.lastConfirmationDate && cur.lastConfirmationDate && prev.lastConfirmationDate !== cur.lastConfirmationDate) {
    events.push({ type: 'Confirmation Statement Filed', detail: `New confirmation statement filed (${cur.lastConfirmationDate}).`, raw: { date: cur.lastConfirmationDate } });
  }
  return events;
}

// Rewrites each event's plain detail sentence into the roadmap's target voice — plain
// English interpretation plus a concrete recommended action, e.g. "ABC Ltd secured £20m
// funding, recruitment activity likely in 3-6 months, recommended action: contact Finance
// Director." One Claude call per company (covering all its events for this run) rather than
// per event, to keep API cost down. Falls back to the plain mechanical detail sentence
// (still useful, just less actionable) if Claude is unavailable or returns something unusable.
async function summarizeSignals(companyName, industry, events) {
  const system = 'You are a recruitment CRM assistant. Given a client company and a list of detected Companies House events for them, write a short plain-English interpretation for EACH event plus one concrete recommended follow-up action for a recruiter — in the style: "Secured new funding/directors, recruitment activity likely to follow, recommended action: contact the Finance Director." Keep each to 1-2 sentences. Return ONLY a JSON array, one object per input event IN THE SAME ORDER, each with a "detail" string. No markdown, no preamble, no explanation.';
  const userText = `Company: ${companyName}${industry ? ` (${industry})` : ''}\n\nEvents:\n${events.map((e, i) => `${i + 1}. [${e.type}] ${e.detail}`).join('\n')}`;
  const raw = await callClaude(system, userText, 500);
  if (!raw) return events;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return events;
    return events.map((e, i) => {
      const d = parsed[i]?.detail;
      return { ...e, detail: (typeof d === 'string' && d.trim()) ? d.trim().slice(0, 1000) : e.detail };
    });
  } catch {
    return events;
  }
}

// Cron-gated exactly like handleRematchPool (Vercel sends CRON_SECRET as a Bearer token on
// scheduled invocations — see vercel.json). Only processes active Companies that have a
// Companies House Number set; everything else is silently skipped (not an error — most
// Companies won't have a number populated yet, see the Companies House Number field
// description in Airtable). Returns 200 with `skipped` rather than 500 when
// COMPANIES_HOUSE_API_KEY isn't configured, so an unconfigured key doesn't show up as a
// failing cron run in Vercel's dashboard — it's a genuine "not set up yet" state, not a bug.
async function handleClientIntelligenceScan(req, res) {
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const chApiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!chApiKey) return res.status(200).json({ ok: true, skipped: 'COMPANIES_HOUSE_API_KEY not configured' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };

  let companies = [];
  let offset;
  do {
    const url = `https://api.airtable.com/v0/${BASE}/${COMPANIES}?filterByFormula=${encodeURIComponent(`AND({${CF.chNumber}}!='',{${CF.active}}=1)`)}&returnFieldsByFieldId=true&pageSize=100${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(url, { headers: h }).then(r => r.json()).catch(() => ({ records: [] }));
    companies = companies.concat(r.records || []);
    offset = r.offset;
  } while (offset);

  let checked = 0, newSignals = 0, failed = 0;
  const digestLines = [];

  for (const rec of companies) {
    const companyNumber = (rec.fields[CF.chNumber] || '').trim();
    if (!companyNumber) continue;
    const companyName = rec.fields[CF.name] || 'Unknown company';
    const industry = rec.fields[CF.industry] || '';

    const curSnap = await fetchCompanyHouseSnapshot(companyNumber, chApiKey);
    if (!curSnap) { failed++; continue; }
    checked++;

    let prevSnap = null;
    const prevRaw = rec.fields[CF.chSnapshot];
    if (prevRaw) {
      try { prevSnap = JSON.parse(prevRaw); } catch { prevSnap = null; }
    }

    if (prevSnap) {
      let events = diffChSnapshots(prevSnap, curSnap);
      if (events.length) {
        events = await summarizeSignals(companyName, industry, events);
        for (const ev of events) {
          await fetch(`https://api.airtable.com/v0/${BASE}/${CLIENT_SIGNALS}`, {
            method: 'POST', headers: h,
            body: JSON.stringify({ fields: {
              [CSF.summary]: `${ev.type} — ${companyName}`.slice(0, 200),
              [CSF.company]: [rec.id],
              [CSF.type]: ev.type,
              [CSF.detail]: ev.detail,
              [CSF.detectedDate]: curSnap.checkedAt,
              [CSF.status]: 'New',
              [CSF.rawData]: JSON.stringify(ev.raw || {}).slice(0, 9000),
            } }),
          }).catch(() => null);
          newSignals++;
        }
        digestLines.push(`*${companyName}*: ${events.map(e => e.type).join(', ')}`);
      }
    }

    await fetch(`https://api.airtable.com/v0/${BASE}/${COMPANIES}/${rec.id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ fields: {
        [CF.chSnapshot]: JSON.stringify(curSnap),
        [CF.chLastChecked]: curSnap.checkedAt,
      } }),
    }).catch(() => null);
  }

  if (digestLines.length) {
    await postNotification(`Client intelligence scan — ${newSignals} new signal(s) across ${checked} compan${checked === 1 ? 'y' : 'ies'} checked:\n${digestLines.join('\n')}`);
  }

  return res.status(200).json({ ok: true, checked, newSignals, failed, totalWithNumber: companies.length });
}

// Staff-only. Returns signals for one Company (companyId given) or, if omitted, every
// signal across every Company the caller can see — used for a future dashboard-wide badge,
// though v1's UI only calls this scoped to a single Company's record page.
async function handleGetClientSignals(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const companyId = req.query.companyId;
  if (companyId && !allCompanyIds.includes(companyId)) return res.status(403).json({ error: 'Company not in your access scope' });

  let all = [];
  let offset;
  do {
    const url = `https://api.airtable.com/v0/${BASE}/${CLIENT_SIGNALS}?returnFieldsByFieldId=true&pageSize=100${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(url, { headers: h }).then(r => r.json()).catch(() => ({ records: [] }));
    all = all.concat(r.records || []);
    offset = r.offset;
  } while (offset);

  const scopeIds = companyId ? [companyId] : allCompanyIds;
  const relevant = all.filter(rec => (rec.fields[CSF.company] || []).some(id => scopeIds.includes(id)));

  const companyNameById = {};
  if (!companyId && relevant.length) {
    const compIds = [...new Set(relevant.flatMap(rec => rec.fields[CSF.company] || []))];
    const compRes = await fetch(
      `https://api.airtable.com/v0/${BASE}/${COMPANIES}?filterByFormula=${encodeURIComponent(`OR(${compIds.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&returnFieldsByFieldId=true&pageSize=100`,
      { headers: h }
    ).then(r => r.json()).catch(() => ({ records: [] }));
    (compRes.records || []).forEach(rec => { companyNameById[rec.id] = rec.fields[CF.name] || 'Unknown'; });
  }

  const signals = relevant
    .map(rec => {
      const cid = (rec.fields[CSF.company] || [])[0] || null;
      return {
        id: rec.id,
        summary: rec.fields[CSF.summary] || '',
        type: rec.fields[CSF.type] || '',
        detail: rec.fields[CSF.detail] || '',
        detectedDate: rec.fields[CSF.detectedDate] || rec.createdTime,
        status: rec.fields[CSF.status] || 'New',
        companyId: cid,
        companyName: companyId ? undefined : (companyNameById[cid] || 'Unknown'),
      };
    })
    .sort((a, b) => new Date(b.detectedDate) - new Date(a.detectedDate))
    .slice(0, 50);

  return res.status(200).json({ signals });
}

// Staff-only. Marks a signal Reviewed/Actioned/Dismissed — never deletes it, keeping a full
// audit trail of what was surfaced and what a recruiter did about it.
async function handleUpdateSignalStatus(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { signalId, status } = req.body || {};
  if (!signalId || !status) return res.status(400).json({ error: 'Missing fields' });
  const ALLOWED_STATUSES = ['New', 'Reviewed', 'Actioned', 'Dismissed'];
  if (!ALLOWED_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Staff only.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const sigRec = await fetch(`https://api.airtable.com/v0/${BASE}/${CLIENT_SIGNALS}/${signalId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!sigRec?.id) return res.status(404).json({ error: 'Signal not found' });
  const sigCompanyIds = sigRec.fields[CSF.company] || [];
  if (!sigCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Signal not in your access scope' });

  const upd = await fetch(`https://api.airtable.com/v0/${BASE}/${CLIENT_SIGNALS}/${signalId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ fields: { [CSF.status]: status } }),
  }).then(r => r.json()).catch(() => null);

  return upd?.id ? res.status(200).json({ ok: true }) : res.status(500).json({ error: 'Save failed' });
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

// ── UPDATE ROLE ───────────────────────────────────────────────────
// Staff-only. Edits a Role's title/location/brief/status in place. Added 2026-08-04 —
// until now the only role-related writes were create-role and update-role-terms (Fee%/
// Target Salary), so there was no way to fix a typo or close a role once created without
// editing Airtable directly. Flagged after Mike found a near-duplicate "Bookeeping" role
// created by mistake (see project memory) with no in-app way to fix it.
async function handleUpdateRole(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { roleId, title, location, brief, status, hiringManagerName, hiringManagerEmail, hiringManagerPhone, roleNotes } = req.body || {};
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });
  if (title !== undefined && !title.trim()) return res.status(400).json({ error: 'title cannot be empty' });
  const VALID_STATUSES = ['Active', 'Paused', 'Filled', 'Closed'];
  if (status !== undefined && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const clerkUserId = await getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: 'Invalid or missing session' });

  const h = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };
  const access = await resolveAccess(clerkUserId, h);
  if (!access) return res.status(403).json({ error: "Your account isn't linked to a company yet." });
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Only recruiters can edit roles.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  const fields = {};
  if (title !== undefined) fields[RF.title] = title.trim();
  if (location !== undefined) fields[RF.location] = location.trim();
  if (brief !== undefined) fields[RF.brief] = brief.trim();
  if (status !== undefined) fields[RF.status] = status;
  if (hiringManagerName !== undefined) fields[RF.hiringManagerName] = hiringManagerName.trim();
  if (hiringManagerEmail !== undefined) fields[RF.hiringManagerEmail] = hiringManagerEmail.trim();
  if (hiringManagerPhone !== undefined) fields[RF.hiringManagerPhone] = hiringManagerPhone.trim();
  if (roleNotes !== undefined) fields[RF.roleNotes] = roleNotes.trim();

  const upd = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ fields }),
  }).then(r => r.json());

  return upd.id ? res.status(200).json({ ok: true }) : res.status(500).json({ error: 'Update failed' });
}

// ── DELETE ROLE ───────────────────────────────────────────────────
// Staff-only. Hard-deletes a Role. Also deletes any Role Matches rows that reference it
// first, so the delete doesn't leave orphaned junction rows pointing at a now-gone Role.
// Does NOT touch the candidates themselves — only this Role's link to them. Frontend gates
// this behind a confirm() dialog; "Closed" status (via update-role) is the safer, reversible
// alternative for just hiding a role from the default sidebar view without losing data.
async function handleDeleteRole(req, res) {
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
  if (access.viewerType !== 'staff') return res.status(403).json({ error: 'Only recruiters can delete roles.' });

  const allCompanyIds = access.organizations.flatMap(o => o.companyIds);
  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  const allMatches = await fetchAllRoleMatches(h);
  const matchIdsToDelete = allMatches.filter(m => m.roleId === roleId).map(m => m.id);
  for (let i = 0; i < matchIdsToDelete.length; i += 10) {
    const batch = matchIdsToDelete.slice(i, i + 10);
    const qs = batch.map(id => `records[]=${id}`).join('&');
    await fetch(`https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}?${qs}`, {
      method: 'DELETE', headers: h,
    }).catch(() => null);
  }

  const del = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}`, {
    method: 'DELETE', headers: h,
  }).then(r => r.json()).catch(() => null);

  return del?.deleted ? res.status(200).json({ ok: true }) : res.status(500).json({ error: 'Delete failed' });
}

// ── SAVE PLACEMENT SALARY ─────────────────────────────────────────
// Staff-only. Records the actual agreed salary once a candidate is Placed — the basis
// for actual (billed) earnings, as opposed to the Role-level forecast.
async function handleSavePlacementSalary(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const AT_TOKEN = process.env.AT_TOKEN;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  // roleId is now required — Placement Salary lives on the Role Matches row for this
  // specific (candidate, role) pair, not on the shared Candidate record. Same 2026-08-05
  // cross-client leak fix as handleSaveNotes above (see that comment for the fuller
  // explanation); a placement fee for one Organization's client must never be visible
  // against that candidate on another Organization's board.
  const { candidateId, roleId, placementSalary } = req.body || {};
  if (!candidateId || !roleId) return res.status(400).json({ error: 'Missing fields' });
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
  const roleRec = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLES}/${roleId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
  if (!roleRec?.id) return res.status(404).json({ error: 'Role not found' });
  const roleCompanyIds = roleRec.fields[RF.company] || [];
  if (!roleCompanyIds.some(id => allCompanyIds.includes(id))) return res.status(403).json({ error: 'Role not in your access scope' });

  const allMatches = await fetchAllRoleMatches(h);
  const existing = allMatches.find(m => m.roleId === roleId && m.candidateId === candidateId);

  let upd;
  if (existing) {
    upd = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}/${existing.id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ fields: { [RMF.placementSalary]: placementSalary } }),
    }).then(r => r.json());
  } else {
    const candRec = await fetch(`https://api.airtable.com/v0/${BASE}/${CANDIDATES}/${candidateId}?returnFieldsByFieldId=true`, { headers: h }).then(r => r.json()).catch(() => null);
    const candName = candRec?.fields?.[KF.name] || '';
    const roleTitle = roleRec.fields[RF.title] || '';
    upd = await fetch(`https://api.airtable.com/v0/${BASE}/${ROLE_MATCHES}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ fields: {
        [RMF.label]: `${candName} → ${roleTitle}`,
        [RMF.candidate]: [candidateId], [RMF.role]: [roleId],
        [RMF.placementSalary]: placementSalary,
      } }),
    }).then(r => r.json());
  }

  return upd.id ? res.status(200).json({ ok: true }) : res.status(500).json({ error: 'Save failed' });
}
