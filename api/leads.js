const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = 'appmWbVE3QsqXSY4e';
const TABLE_ID = 'tblQjbblExBgXm4LR';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, company, phone, type, notes } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const fields = {
    'Name': name,
    'Email': email,
  };
  if (company) fields['Company'] = company;
  if (phone)   fields['Phone'] = phone;
  if (type)    fields['Type'] = type;
  if (notes)   fields['Notes'] = notes;

  // Date as YYYY-MM-DD
  fields['Date'] = new Date().toISOString().split('T')[0];

  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Airtable error:', data);
      return res.status(500).json({ error: 'Failed to save lead', detail: data });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error('leads.js error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
