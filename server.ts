import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import youtubedl from "youtube-dl-exec";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";

// ─── Cookie setup ────────────────────────────────────────────────────────────
const setupEnvironmentCookies = (): string => {
  if (process.env.YOUTUBE_COOKIES) {
    const tempCookies = path.join(process.cwd(), "temp_cookies.txt");
    try {
      fs.writeFileSync(tempCookies, process.env.YOUTUBE_COOKIES);
      return tempCookies;
    } catch (e) {
      console.error("Failed to write env cookies:", e);
    }
  }
  return "";
};
const ENV_COOKIE_PATH = setupEnvironmentCookies();

// ─── yt-dlp options ──────────────────────────────────────────────────────────
const getDlOpts = () => {
  const opts: Record<string, unknown> = {
    dumpJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    referer: "https://www.youtube.com/",
    // Impersonate Chrome + use Android client to bypass bot-detection
    impersonate: "chrome",
    extractorArgs: "youtube:player_client=android,web",
    noPlaylist: true,
    noPart: true,
    noCacheDir: true,
    bufferSize: "16K",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  // Cookie lookup: env-written file > local files
  const cookieCandidates = [
    ENV_COOKIE_PATH,
    path.join(process.cwd(), "cookies.txt"),
    path.join(process.cwd(), "www.youtube.com_cookies.txt"),
  ];
  for (const p of cookieCandidates) {
    if (p && fs.existsSync(p)) {
      opts.cookies = p;
      break;
    }
  }

  return opts;
};

// ─── In-memory cache ─────────────────────────────────────────────────────────
interface CacheEntry { data: unknown; expiry: number }
const infoCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ─── URL allow-list ───────────────────────────────────────────────────────────
const ALLOWED_HOSTS = ["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"];

const isAllowedUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      ALLOWED_HOSTS.some((h) => u.hostname === h)
    );
  } catch {
    return false;
  }
};

// ─── Video ID extractor ──────────────────────────────────────────────────────
const getVideoId = (url: string): string | null => {
  const re = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
  const m = url.match(re);
  return m ? m[1] : null;
};

// ─── Session rate limiter ────────────────────────────────────────────────────
interface RateLimitEntry { count: number; resetAt: number }
const sessionLimits = new Map<string, RateLimitEntry>();
const RATE_WINDOW = 60_000;   // 1 min
const RATE_MAX    = 20;       // requests per window

const sessionRateLimiter: express.RequestHandler = (req, res, next) => {
  const key = (req.headers["x-session-id"] as string) || req.ip || "anon";
  const now = Date.now();
  let entry = sessionLimits.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW };
  }
  entry.count++;
  sessionLimits.set(key, entry);
  if (entry.count > RATE_MAX) {
    res.status(429).json({ error: "Too many requests. Please wait a moment." });
    return;
  }
  next();
};

// Cleanup stale rate-limit entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessionLimits) {
    if (now > v.resetAt) sessionLimits.delete(k);
  }
}, RATE_WINDOW);

// ─── Main server ──────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000");

  // ── CORS ──────────────────────────────────────────────────────────────────
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:3000",
  ].filter(Boolean) as string[];

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // same-origin / curl / Postman
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin))
          return cb(null, true);
        cb(new Error(`CORS blocked: ${origin}`));
      },
      credentials: true,
    })
  );
  app.use(express.json());

  // ── Health check ──────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", ts: Date.now() });
  });

  // ── /api/info ─────────────────────────────────────────────────────────────
  app.get("/api/info", sessionRateLimiter, async (req, res) => {
    const videoUrl = req.query.url as string;

    if (!videoUrl) {
      res.status(400).json({ error: "URL is required." });
      return;
    }
    if (!isAllowedUrl(videoUrl)) {
      res.status(400).json({ error: "Only YouTube URLs are supported." });
      return;
    }

    // Cache hit
    const cached = infoCache.get(videoUrl);
    if (cached && cached.expiry > Date.now()) {
      res.json(cached.data);
      return;
    }

    const videoId = getVideoId(videoUrl);

    // Try YouTube Data API v3 first (fast, reliable)
    if (YOUTUBE_API_KEY && videoId) {
      try {
        const { data } = await axios.get(
          "https://www.googleapis.com/youtube/v3/videos",
          { params: { part: "snippet,contentDetails", id: videoId, key: YOUTUBE_API_KEY }, timeout: 5000 }
        );
        if (data.items?.length > 0) {
          const { snippet, contentDetails } = data.items[0];
          const durMatch = contentDetails.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
          const duration =
            (parseInt(durMatch?.[1] || "0") * 3600) +
            (parseInt(durMatch?.[2] || "0") * 60) +
            parseInt(durMatch?.[3] || "0");

          const responseData = {
            title: snippet.title,
            thumbnail:
              snippet.thumbnails.maxres?.url ||
              snippet.thumbnails.high?.url ||
              snippet.thumbnails.default?.url,
            duration: duration.toString(),
            author: snippet.channelTitle,
            url: videoUrl,
          };
          infoCache.set(videoUrl, { data: responseData, expiry: Date.now() + CACHE_TTL });
          res.json(responseData);
          return;
        }
      } catch (e) {
        console.warn("YouTube API failed, falling back to yt-dlp:", (e as Error).message);
      }
    }

    // Fallback: yt-dlp scrape with 2 retries
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const info = await youtubedl(videoUrl, getDlOpts()) as Record<string, unknown>;
        const responseData = {
          title: info.title,
          thumbnail: info.thumbnail,
          duration: String(info.duration),
          author: info.uploader || info.channel,
          url: videoUrl,
        };
        infoCache.set(videoUrl, { data: responseData, expiry: Date.now() + CACHE_TTL });
        res.json(responseData);
        return;
      } catch (err) {
        console.warn(`yt-dlp attempt ${attempt} failed:`, (err as Error).message);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
      }
    }

    res.status(500).json({ error: "Could not fetch video info. The video may be private, age-restricted, or unavailable." });
  });

  // ── /api/download ─────────────────────────────────────────────────────────
  app.get("/api/download", sessionRateLimiter, async (req, res) => {
    const videoUrl = req.query.url     as string;
    const quality  = req.query.quality as string || "highestaudio";
    const type     = req.query.type    as string || "audio";

    if (!videoUrl) { res.status(400).send("URL is required."); return; }
    if (!isAllowedUrl(videoUrl)) { res.status(400).send("Only YouTube URLs are supported."); return; }

    const isVideo = type === "video";

    // ── Format string ────────────────────────────────────────────────────────
    let formatStr: string;
    if (!isVideo) {
      if (quality === "low")    formatStr = "worstaudio[ext=m4a]/worstaudio/worst";
      else if (quality === "medium") formatStr = "bestaudio[ext=m4a][abr<=192]/bestaudio[abr<=192]/bestaudio[ext=m4a]/bestaudio";
      else                      formatStr = "bestaudio[ext=m4a]/bestaudio/best";
    } else {
      if (quality === "1080p")  formatStr = "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[ext=mp4]/best";
      else if (quality === "360p") formatStr = "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[ext=mp4][height<=360]/best";
      else                      formatStr = "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[ext=mp4]/best";
    }

    // ── Get title for filename (use cache if available) ───────────────────
    let title = "download";
    const cached = infoCache.get(videoUrl);
    if (cached) {
      title = (cached.data as Record<string, string>).title || title;
    } else {
      try {
        const info = await youtubedl(videoUrl, getDlOpts()) as Record<string, unknown>;
        title = (info.title as string) || title;
      } catch { /* use default */ }
    }

    const safeTitle = title
      .replace(/[^\x00-\x7F]/g, "")
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim() || "download";

    const ext      = isVideo ? "mp4"      : "m4a";
    const mimeType = isVideo ? "video/mp4" : "audio/mp4";

    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.${ext}"`);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    // ── Stream yt-dlp output directly to response ─────────────────────────
    const dlOpts = getDlOpts();
    delete dlOpts.dumpJson;

    const subprocess = youtubedl.exec(videoUrl, {
      ...dlOpts,
      format: formatStr,
      output: "-",
      concurrentFragments: 4,
    } as any);

    // Prevent UnhandledPromiseRejection if yt-dlp exits with non-zero
    subprocess.catch((err: any) => {
      console.warn("yt-dlp download process exited with error:", err.message);
    });

    subprocess.stdout?.pipe(res);

    subprocess.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes("ERROR")) console.error("yt-dlp:", msg.trim());
    });

    subprocess.on("error", (err: Error) => {
      console.error("Subprocess error:", err.message);
      if (!res.headersSent) res.status(500).send("Stream error.");
    });

    subprocess.on("close", (code: number) => {
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({ error: "Download failed. Video may be unavailable." });
      }
    });

    // If client disconnects, kill the subprocess
    req.on("close", () => subprocess.kill?.());
  });

  // ── Static / Vite middleware ───────────────────────────────────────────────
  if (process.env.NODE_ENV === "production" && !process.env.API_ONLY) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  } else if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 EchoTube running on port ${PORT}`);
  });
}

startServer().catch(console.error);
