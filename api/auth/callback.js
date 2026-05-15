// api/auth/callback.js — exchange code for token, set session cookie
export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error || !code) return res.redirect(302, '/client?error=auth_cancelled');

  const clientId     = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri  = process.env.LINKEDIN_REDIRECT_URI;

  // 1. Exchange code for access token
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error('Token error:', JSON.stringify(tokenData));
    return res.redirect(302, '/client?error=token_failed');
  }

  // 2. Get user profile via OpenID Connect userinfo
  const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token },
  });
  const user = await userRes.json();

  // 3. Set a JS-readable cookie (no sensitive data — just name/email for display)
  const session = Buffer.from(JSON.stringify({
    name:    user.name || ((user.given_name || '') + ' ' + (user.family_name || '')).trim() || 'User',
    email:   user.email || '',
    picture: user.picture || '',
  })).toString('base64');

  // SameSite=Lax, no HttpOnly — JS needs to read this to show/hide the login gate
  res.setHeader('Set-Cookie',
    'tk_user=' + session + '; Path=/; SameSite=Lax; Max-Age=86400'
  );
  res.redirect(302, '/client');
}
