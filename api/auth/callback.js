// api/auth/callback.js — DEBUG VERSION
export default async function handler(req, res) {
  const { code, error, state } = req.query;
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (error || !code) {
    res.status(400).json({ step: 'no_code', error, query: req.query });
    return;
  }

  const clientId     = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri  = process.env.LINKEDIN_REDIRECT_URI;

  // Exchange code for token
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code, redirect_uri: redirectUri,
      client_id: clientId, client_secret: clientSecret,
    }),
  });
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    res.status(400).json({ step: 'token_failed', tokenData, clientIdExists: !!clientId, secretExists: !!clientSecret, redirectUri });
    return;
  }

  // Get user profile
  const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token },
  });
  const user = await userRes.json();

  res.status(200).json({ step: 'success', user });
}
