# 🌿 G.A.I.A. — Garden AI Assistant

**G**arden **A**I **A**ssistant — An AI-powered plant identification kiosk built for The Home Depot garden center experience, named after the Greek goddess of the Earth.

![G.A.I.A. Kiosk](https://img.shields.io/badge/Powered%20by-Claude%20AI-74c69d?style=flat-square&logo=anthropic)
![Netlify](https://img.shields.io/badge/Deploy-Netlify-00C7B7?style=flat-square&logo=netlify)
![Mobile Ready](https://img.shields.io/badge/Mobile-Ready-52b788?style=flat-square)

---

## Features

- 🔍 **Plant Search** — Search by name or specific cultivar (e.g. "Double Black Petunia")
- 📝 **Describe & Identify** — Describe a plant's appearance and G.A.I.A. identifies it
- 📷 **Camera Scan** — Open camera or upload a photo for instant AI plant identification
- 🌿 **Full Care Profiles** — Sunlight, water, soil type, pH, USDA zone, bloom season, and planting tips
- 🏪 **Live Store Inventory** — Simulated Home Depot inventory with pricing, aisle, and bay location
- 🖼️ **Plant Photos** — Automatic botanical images via Wikipedia/Wikimedia
- 📱 **Mobile First** — Fully responsive, works on iOS Safari and Android Chrome

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/gaia-garden-kiosk.git
cd gaia-garden-kiosk
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set your Anthropic API key

Create a `.env` file in the project root (this file is gitignored — never commit it):

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Get your API key at [console.anthropic.com](https://console.anthropic.com).

### 4. Run locally

```bash
npm run dev
```

This starts Netlify Dev at `http://localhost:8888` with the serverless function proxy active.

---

## Deploy to Netlify (Recommended)

### Option A — Deploy via Netlify UI

1. Push this repo to GitHub
2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import from Git**
3. Select your repository
4. Build settings are auto-detected from `netlify.toml`
5. Go to **Site settings → Environment variables** and add:
   ```
   ANTHROPIC_API_KEY = sk-ant-your-key-here
   ```
6. Trigger a redeploy — your site is live!

### Option B — Deploy via CLI

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify env:set ANTHROPIC_API_KEY sk-ant-your-key-here
netlify deploy --prod
```

---

## Deploy to GitHub Pages (Static Mode)

If you want to use GitHub Pages instead of Netlify, the app can run in **direct API mode** — the API key is stored in the browser's `localStorage` and entered by the user on first visit.

1. Edit `js/app.js` — change `API_ENDPOINT` from `"/.netlify/functions/ai"` to `"DIRECT"`
2. The app will prompt for the API key on first load and store it locally
3. Enable GitHub Pages in your repo settings → **Pages** → Source: **main branch / root**

> ⚠️ Direct mode exposes your API key in the browser. Only use this for personal/demo use, never production.

---

## Project Structure

```
gaia-garden-kiosk/
├── index.html                  # Main app shell
├── css/
│   └── styles.css              # All styles
├── js/
│   └── app.js                  # All application logic
├── netlify/
│   └── functions/
│       └── ai.js               # Serverless API proxy (keeps key secure)
├── netlify.toml                # Netlify build + header config
├── package.json
├── .gitignore
└── README.md
```

---

## Architecture

```
Browser (index.html + app.js)
    │
    │  POST /prompt
    ▼
Netlify Function (netlify/functions/ai.js)
    │
    │  POST with x-api-key header
    ▼
Anthropic Claude API (claude-sonnet-4-20250514)
    │
    ▼
Response → rendered in browser
```

Plant images are fetched directly from the **Wikipedia REST API** and **Wikimedia Commons** — both are public, no key required.

---

## Hardware Kiosk Deployment

For a physical in-store kiosk (weatherproof enclosure):

| Component | Recommendation |
|-----------|---------------|
| Display | 27–32" industrial touchscreen (Elo or Advantech, IP65) |
| Computer | Intel NUC or Raspberry Pi 5 running kiosk-mode Chromium |
| Camera | Downward-facing USB industrial camera (Basler or IDS) |
| Enclosure | NEMA 4X rated stainless / powder-coated aluminum |
| Connectivity | LTE failover + store WiFi dual-path |
| Mounting | Pedestal or wall-mount with anti-vandal hardware |

Run Chromium in kiosk mode:
```bash
chromium-browser --kiosk --app=http://localhost:8888 --noerrdialogs --disable-infobars
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ Yes | Your Anthropic API key from console.anthropic.com |

---

## API Usage & Cost

G.A.I.A. makes one Claude API call per user action (search, identify, inventory lookup). Estimated cost per full session (search + detail + inventory): ~$0.003–0.008 USD using Claude Sonnet.

---

## License

MIT — free to use, modify, and deploy. Built with ❤️ and 🌿 by F.J. Innovations & Holdings LLC.
