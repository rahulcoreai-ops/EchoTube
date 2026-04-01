# 🎵 EchoTube v2 — Premium Media Extractor

<div align="center">
  <p><i>Immersive. High-Fidelity. Professional.</i></p>
</div>

---

## ✨ Overview

EchoTube is a full-stack YouTube audio & video extractor. The **frontend** is a React SPA deployed on **Vercel**. The **backend** is a Node.js/Express API deployed on **Render**, using `yt-dlp` + `ffmpeg` to stream media directly to the user.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, Framer Motion, Three.js |
| **Backend** | Node.js 20, Express, `youtube-dl-exec` / `yt-dlp`, FFmpeg |
| **Build** | Vite 6, PWA Plugin |
| **Deployment** | Vercel (frontend) + Render (backend) |

---

## 🚀 Quick Start (Local)

```bash
# 1. Clone & install
git clone https://github.com/your-repo/EchoTube.git
cd EchoTube
npm install

# 2. Create your .env
cp .env.example .env
# Edit .env — leave VITE_API_BASE_URL empty for local (it'll use relative URLs)

# 3. Run (starts Express + Vite together)
npm run dev
# Open http://localhost:3000
```

**Prerequisites:** Node 18+, FFmpeg installed globally, yt-dlp installed globally.

---

## ☁️ Deployment Guide

### Step 1 — Deploy Backend to Render

1. Create a new **Web Service** on [render.com](https://render.com)
2. Connect your GitHub repo
3. Render will auto-detect `nixpacks.toml` — it will install `yt-dlp` + `ffmpeg`, build the frontend, and start the server
4. Set these **Environment Variables** on Render:

| Variable | Value |
|---|---|
| `FRONTEND_URL` | `https://your-app.vercel.app` ← your Vercel URL |
| `YOUTUBE_API_KEY` | Your Google API key (optional but recommended) |
| `YOUTUBE_COOKIES` | Contents of your YouTube cookies.txt (optional) |
| `NODE_ENV` | `production` |

5. Note your Render URL (e.g. `https://echoutube-api.onrender.com`)

---

### Step 2 — Deploy Frontend to Vercel

1. Import your repo on [vercel.com](https://vercel.com)
2. Set **Framework Preset** to `Vite`
3. Set this **Environment Variable** on Vercel:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://echoutube-api.onrender.com` ← your Render URL |

4. Deploy — done!

---

## ⚙️ Environment Variables Reference

See `.env.example` for full documentation.

---

## ⚖️ Legal

EchoTube is provided for **personal, non-commercial archival use only**.
Users are responsible for complying with YouTube's Terms of Service and local copyright laws.
We collect **zero data** — all session info is stored locally on your device.

---

<div align="center">
  <p>Made with ❤️ by <b>Chitra — CM</b></p>
</div>
