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

  // Exchange code for access token
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
    res.writeHead(302, { Location: '/client?error=token_failed' });
    return res.end();
  }

  // Get user profile
  const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token },
  });
  const user = await userRes.json();

  // Build cookie — JS-readable (no HttpOnly), contains name/email only
  const session = Buffer.from(JSON.stringify({
    name:    user.name || ((user.given_name||'') + ' ' + (user.family_name||'')).trim() || 'User',
    email:   user.email   || '',
    picture: user.picture || '',
  })).toString('base64');

  // Set cookie and redirect in one writeHead call
  res.writeHead(302, {
    Location:   '/client',
    'Set-Cookie': 'tk_user=' + session + '; Path=/; SameSite=Lax; Max-Age=86400',
  });
  res.end();
}
