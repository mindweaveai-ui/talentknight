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

  const F = {
    name:           'fld8k1UET3DWwJV3S',
    email:          'fld7JmBigDERwULoz',
    phone:          'flde7FE0nVbgbky8j',
    location:       'fldNx4IFaKgaOnNw3',
    linkedin:       'fldOmVhPF36ULGx7K',
    rightToWork:    'fldA5fQDWE5D3HwoV',
    role:           'fldwOPyq4vmWzEquB',
    company:        'fldJYcW9eWMMnFPDS',
    yearsExp:       'fldvniEirssDClM9N',
    seniority:      'fldZdGN4Ic6tVLAyR',
    targetRoles:    'fldpKdSs4boanTtlo',
    sector:         'fldQjqjDdx2oV4KqA',
    employmentType: 'fldXfM1FBMCsKo6ho',
    workPref:       'fld8yRrgggiAVo7I6',
    salaryMin:      'fldukD1lSgSMk5QP3',
    salaryMax:      'fld7s9k8DA4xZRDfB',
    noticePeriod:   'fld6bjkGxD9O17rZL',
    relocate:       'fldDcb78CT8XBCch8',
    educationLevel: 'fldWagGVvad1qKxKu',
    degreeSubject:  'fldjb6pNRuLnKsTaO',
    certifications: 'fldgTtC0PqkPoL69R',
    skills:         'fldjzxELfOSU8M0dC',
    bio:            'fldtJGFbRDqFR9PPJ',
    marketingSource:'fldF2n1hsQ4MwPKhp',
  };

  const body = req.body || {};

  if (!body.name || !body.email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const fields = {};
  if (body.name)           fields[F.name]           = body.name;
  if (body.email)          fields[F.email]          = body.email;
  if (body.phone)          fields[F.phone]          = body.phone;
  if (body.location)       fields[F.location]       = body.location;
  if (body.linkedin)       fields[F.linkedin]       = body.linkedin;
  if (body.rightToWork)    fields[F.rightToWork]    = body.rightToWork;
  if (body.role)           fields[F.role]           = body.role;
  if (body.company)        fields[F.company]        = body.company;
  if (body.yearsExp)       fields[F.yearsExp]       = body.yearsExp;
  if (body.seniority)      fields[F.seniority]      = body.seniority;
  if (body.targetRoles)    fields[F.targetRoles]    = body.targetRoles;
  if (body.sector)         fields[F.sector]         = body.sector;
  if (body.employmentType) fields[F.employmentType] = body.employmentType;
  if (body.workPref)       fields[F.workPref]       = body.workPref;
  if (body.salaryMin)      fields[F.salaryMin]      = body.salaryMin;
  if (body.salaryMax)      fields[F.salaryMax]      = body.salaryMax;
  if (body.noticePeriod)   fields[F.noticePeriod]   = body.noticePeriod;
  if (body.relocate)       fields[F.relocate]       = body.relocate;
  if (body.educationLevel) fields[F.educationLevel] = body.educationLevel;
  if (body.degreeSubject)  fields[F.degreeSubject]  = body.degreeSubject;
  if (body.certifications) fields[F.certifications] = body.certifications;
  if (body.skills)         fields[F.skills]         = body.skills;
  if (body.bio)            fields[F.bio]            = body.bio;
  if (body.marketingSource) fields[F.marketingSource] = body.marketingSource;

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
