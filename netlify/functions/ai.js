const https = require("https");
const http = require("http");

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  // ── TEST ENDPOINT (GET request) ───────────────────────────────────────────
  // Visit /.netlify/functions/ai to confirm function is running
  if (event.httpMethod === "GET") {
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    const keyPreview = hasKey ? "sk-ant-..." + (process.env.ANTHROPIC_API_KEY || "").slice(-4) : "NOT SET";
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "G.A.I.A. function is running",
        apiKeySet: hasKey,
        apiKeyPreview: keyPreview,
        nodeVersion: process.version
      })
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON body" }) }; }

  // ── WEATHER REQUEST ───────────────────────────────────────────────────────
  if (body.type === "weather") {
    const { zip } = body;
    if (!zip) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing zip" }) };
    try {
      const geoRes = await httpGet(`https://geocoding-api.open-meteo.com/v1/search?name=${zip}&count=1&language=en&format=json`);
      const geoData = JSON.parse(geoRes.body);
      const loc = geoData?.results?.[0];
      if (!loc) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "ZIP code not found" }) };
      const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,apparent_temperature,precipitation,weathercode,windspeed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7`;
      const wxRes = await httpGet(wxUrl);
      const wxData = JSON.parse(wxRes.body);
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({
          location: { name: loc.name, state: loc.admin1, lat: loc.latitude, lon: loc.longitude },
          weather: wxData
        })
      };
    } catch (err) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Weather error: " + err.message }) };
    }
  }

  // ── AI REQUEST ────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY environment variable is not set in Netlify" })
    };
  }

  const { prompt } = body;
  if (!prompt) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing prompt" }) };

  const requestBody = JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }]
  });

  try {
    const result = await httpsPost({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    }, requestBody);

    if (result.status !== 200) {
      return {
        statusCode: result.status,
        headers: CORS,
        body: JSON.stringify({ error: "Anthropic error " + result.status + ": " + result.body.substring(0, 200) })
      };
    }

    const data = JSON.parse(result.body);
    const text = data.content?.[0]?.text || "";
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Function error: " + err.message })
    };
  }
};
