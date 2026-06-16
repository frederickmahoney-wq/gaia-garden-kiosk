export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ── TEST ENDPOINT ────────────────────────────────────────────────────────
  if (request.method === 'GET') {
    const hasKey = !!env.ANTHROPIC_API_KEY;
    return new Response(JSON.stringify({
      status: 'G.A.I.A. function is running',
      apiKeySet: hasKey,
    }), { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders }); }

  // ── WEATHER REQUEST ──────────────────────────────────────────────────────
  if (body.type === 'weather') {
    const { zip } = body;
    if (!zip) return new Response(JSON.stringify({ error: 'Missing zip' }), { status: 400, headers: corsHeaders });

    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${zip}&count=1&language=en&format=json`);
      const geoData = await geoRes.json();
      const loc = geoData?.results?.[0];
      if (!loc) return new Response(JSON.stringify({ error: 'ZIP code not found' }), { status: 404, headers: corsHeaders });

      const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,apparent_temperature,precipitation,weathercode,windspeed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7`;
      const wxRes = await fetch(wxUrl);
      const wxData = await wxRes.json();

      return new Response(JSON.stringify({
        location: { name: loc.name, state: loc.admin1, lat: loc.latitude, lon: loc.longitude },
        weather: wxData
      }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Weather error: ' + err.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── AI REQUEST ───────────────────────────────────────────────────────────
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in Cloudflare environment variables' }), { status: 500, headers: corsHeaders });
  }

  const { prompt } = body;
  if (!prompt) return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400, headers: corsHeaders });

  try {
    const result = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await result.json();
    if (!result.ok) {
      return new Response(JSON.stringify({ error: 'Anthropic error ' + result.status }), { status: result.status, headers: corsHeaders });
    }

    const text = data.content?.[0]?.text || '';
    return new Response(JSON.stringify({ text }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Function error: ' + err.message }), { status: 500, headers: corsHeaders });
  }
}
