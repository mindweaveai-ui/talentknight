// api/auth/linkedin.js — redirect user to LinkedIn OAuth
export default function handler(req, res) {
  const clientId    = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI;
  const scope       = 'openid profile email';
  const state       = Math.random().toString(36).slice(2, 10);

  const authUrl = 'https://www.linkedin.com/oauth/v2/authorization'
    + '?response_type=code'
    + '&client_id='    + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&scope='        + encodeURIComponent(scope)
    + '&state='        + state;

  res.writeHead(302, { Location: authUrl });
  res.end();
}
