// api/generate-token.js — create a new client with a magic link token
// POST /api/generate-token
// Body: { adminKey, clientName, email }
// Protected by a simple admin key (ADMIN_KEY env var)
import { randomBytes } from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const AT_TOKEN = process.env.AT_TOKEN;
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (!AT_TOKEN) return res.status(500).json({ error: 'AT_TOKEN not configured' });

  const { adminKey, clientName, email } = req.body || {};

  // Protect with admin key if configured
  if (ADMIN_KEY && adminKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  if (!clientName || !email) {
    return res.status(400).json({ error: 'clientName and email are required' });
  }

  const BASE = 'appnAnRSfB7bgIQVU';
  const CLIENTS_TABLE = 'tblyRQmcdoRF51jJa';
  const F = {
    name:    'fld7AIteYYVxT41lf',
    email:   'fldfknPe511FWUvKz',
    token:   'fld11Z2FSw2uQKE4b',
    active:  'fldBIoBDtUBN5tTPY',
    created: 'fldtwEfCtHWCNqxLY',
  };

  const token = randomBytes(20).toString('hex');  // 40-char hex token
  const today = new Date().toISOString().split('T')[0];

  const atHeaders = { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };

  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${CLIENTS_TABLE}`, {
      method: 'POST',
      headers: atHeaders,
      body: JSON.stringify({
        fields: {
          [F.name]:    clientName,
          [F.email]:   email,
          [F.token]:   token,
          [F.active]:  true,
          [F.created]: today,
        },
      }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: 'Airtable error: ' + (d.error?.message || r.status) });

    const host = req.headers.host || 'talentknight.ai';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const dashboardUrl = `${protocol}://${host}/dashboard?token=${token}`;

    return res.status(200).json({
      ok: true,
      clientId: d.id,
      token,
      dashboardUrl,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create client: ' + err.message });
  }
}
