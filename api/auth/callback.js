// api/auth/callback.js
export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error || !code) {
    res.writeHead(302, { Location: '/client?error=auth_cancelled' });
    return res.end();
  }

  const clientId     = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri  = process.env.LINKEDIN_REDIRECT_URI;
  const atToken      = process.env.AT_TOKEN;

  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    res.writeHead(302, { Location: '/client?error=token_failed' });
    return res.end();
  }

  const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token },
  });
  const user = await userRes.json();

  const name    = user.name || ((user.given_name || '') + ' ' + (user.family_name || '')).trim() || 'User';
  const email   = user.email || '';
  const picture = user.picture || '';

  if (atToken && name && name !== 'User') {
    const AT_BASE  = 'appSGTaLpQrz0UbhA';
    const AT_TABLE = 'tblnthNI6akbzkvQ1';
    const today    = new Date().toISOString().split('T')[0];
    try {
      await fetch('https://api.airtable.com/v0/' + AT_BASE + '/' + AT_TABLE, {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + atToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: [{ fields: {
            'fld188VstRwNjlIRI': name,
            'fldtsj1Qm97jSElAr': email,
            'fldCV5NalTELpME2E': 'LinkedIn',
            'fldKkHgcL1CYglJVS': today,
            'fld7WIEYAA1TLNrJ9': 'New',
          }}]
        }),
      });
    } catch (_) {}
  }

  const userData = Buffer.from(JSON.stringify({ name, email, picture })).toString('base64');
  res.writeHead(302, { Location: '/client?li=' + encodeURIComponent(userData) });
  res.end();
                    }
