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

// ─── yt-dlp binary resolver ───────────────────────────────────────────────────
// Prefer system yt-dlp (more up-to-date on Render/Nixpacks) over the bundled one
const resolveYtDlpBinary = (): string | undefined => {
  const candidates = [
    "/usr/local/bin/yt-dlp",   // Dockerfile installs here
    "/usr/bin/yt-dlp",         // nixpacks / system apt
    process.env.YTDLP_PATH,    // user override via env var
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      console.log(`[yt-dlp] Using binary: ${p}`);
      return p;
    }
  }
  // Fall back to whatever youtube-dl-exec resolves (bundled downloader)
  console.log("[yt-dlp] No system binary found — using youtube-dl-exec default");
  return undefined;
};
const YTDLP_BINARY = resolveYtDlpBinary();

// ─── yt-dlp options ──────────────────────────────────────────────────────────
const getDlOpts = () => {
  const opts: Record<string, unknown> = {
    dumpJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    referer: "https://www.youtube.com/",
    noPlaylist: true,
    noPart: true,
    noCacheDir: true,
    bufferSize: "16K",
    // Use android client — most reliable bypass for bot-detection without curl_cffi
    // NOTE: "impersonate" removed — it requires curl_cffi which is not installed
    //       in the Docker/Nixpacks environment and causes yt-dlp to crash.
    extractorArgs: "youtube:player_client=android,web",
    // Add a realistic user-agent instead of impersonate
    addHeader: [
      "User-Agent:Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    ],
  };

  // Override binary path if a system yt-dlp was found
  if (YTDLP_BINARY) {
    opts.binaryPath = YTDLP_BINARY;
  }

  // Cookie lookup: env-written file > local files
  const cookieCandidates = [
    ENV_COOKIE_PATH,
    path.join(process.cwd(), "cookies.txt"),
    path.join(process.cwd(), "www.youtube.com_cookies.txt"),
  ];
  for (const p of cookieCandidates) {
    if (p && fs.existsSync(p)) {
      opts.cookies = p;
      console.log(`[yt-dlp] Using cookies: ${p}`);
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
const RATE_WINDOW = 60_000;
const RATE_MAX    = 20;

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
        if (!origin) return cb(null, true);
        if (
          allowedOrigins.length === 0 || 
          allowedOrigins.includes(origin) ||
          origin.endsWith(".vercel.app")
        ) {
          return cb(null, true);
        }
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

    if (!videoUrl) { res.status(400).json({ error: "URL is required." }); return; }
    if (!isAllowedUrl(videoUrl)) { res.status(400).json({ error: "Only YouTube URLs are supported." }); return; }

    const cached = infoCache.get(videoUrl);
    if (cached && cached.expiry > Date.now()) {
      res.json(cached.data);
      return;
    }

    const videoId = getVideoId(videoUrl);

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
      // FIX: "highestaudio" is NOT a valid yt-dlp format selector — it was
      // treated as the else-branch before, which was correct, but we now make
      // the logic explicit and also add an opus fallback for broader compat.
      if (quality === "low")
        formatStr = "worstaudio[ext=m4a]/worstaudio[ext=webm]/worstaudio/worst";
      else if (quality === "medium")
        formatStr = "bestaudio[ext=m4a][abr<=192]/bestaudio[abr<=192]/bestaudio[ext=m4a]/bestaudio";
      else
        // highestaudio / default: best audio, prefer m4a, fallback to any
        formatStr = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best";
    } else {
      if (quality === "1080p")
        formatStr = "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[ext=mp4]/best";
      else if (quality === "360p")
        formatStr = "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[ext=mp4][height<=360]/best";
      else
        formatStr = "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[ext=mp4]/best";
    }

    // ── Get title for filename ────────────────────────────────────────────
    let title = "download";
    const cached = infoCache.get(videoUrl);
    if (cached) {
      title = (cached.data as Record<string, string>).title || title;
    } else {
      try {
        const info = await youtubedl(videoUrl, getDlOpts()) as Record<string, unknown>;
        title = (info.title as string) || title;
        // Cache it while we have it
        infoCache.set(videoUrl, {
          data: { title: info.title, thumbnail: info.thumbnail, duration: String(info.duration), author: info.uploader || info.channel, url: videoUrl },
          expiry: Date.now() + CACHE_TTL,
        });
      } catch (e) {
        console.warn("Could not fetch title before download:", (e as Error).message);
      }
    }

    const safeTitle = title
      .replace(/[^\x00-\x7F]/g, "")
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim() || "download";

    const ext      = isVideo ? "mp4"       : "m4a";
    const mimeType = isVideo ? "video/mp4" : "audio/mp4";

    // ── Build download options ────────────────────────────────────────────
    const dlOpts = getDlOpts();
    delete dlOpts.dumpJson; // Must NOT dump JSON during actual download

    const spawnOpts = {
      ...dlOpts,
      format: formatStr,
      output: "-",            // stream to stdout
      concurrentFragments: 4,
    } as any;

    console.log(`[download] Starting: ${videoUrl} | format: ${formatStr}`);

    // ── FIX: Use a two-phase approach ─────────────────────────────────────
    // Phase 1: Spawn the process and wait briefly to detect immediate failures
    // before committing headers. This prevents the "headers sent but 500"
    // race condition that was causing the download to fail silently.
    let headersSentFlag = false;

    const subprocess = youtubedl.exec(videoUrl, spawnOpts);

    // Capture early stderr to detect errors before piping
    const stderrChunks: string[] = [];
    let processExitedEarly = false;
    let exitCode: number | null = null;

    subprocess.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString();
      stderrChunks.push(msg);
      if (msg.includes("ERROR") || msg.includes("error")) {
        console.error("[yt-dlp stderr]", msg.trim());
      }
    });

    // Prevent unhandled promise rejection
    subprocess.catch((err: any) => {
      console.warn("[yt-dlp] Process promise rejected:", err?.message ?? err);
    });

    // Set a short detection window: if yt-dlp errors out in the first
    // 2 seconds we can still send a proper JSON 500 back.
    const EARLY_DETECT_MS = 2000;
    let earlyDetected = false;

    const earlyFailTimer = setTimeout(() => {
      earlyDetected = true;
      // yt-dlp hasn't died yet → safe to commit headers and start piping
      if (!processExitedEarly) {
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.${ext}"`);
        res.setHeader("Content-Type", mimeType);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
        headersSentFlag = true;
        subprocess.stdout?.pipe(res);

        subprocess.on("close", (code: number) => {
          exitCode = code;
          if (code !== 0) {
            console.error(`[yt-dlp] Exited with code ${code} after streaming started`);
            // Can no longer send a clean error — stream is already open
            // Best we can do is destroy the response to signal failure
            if (!res.writableEnded) res.destroy();
          } else {
            console.log("[yt-dlp] Download complete");
            if (!res.writableEnded) res.end();
          }
        });
      }
    }, EARLY_DETECT_MS);

    // Watch for early process exit (within the detection window)
    subprocess.on("close", (code: number) => {
      exitCode = code;
      if (!earlyDetected) {
        // Closed before our detection window elapsed → early failure
        clearTimeout(earlyFailTimer);
        processExitedEarly = true;
        const errSummary = stderrChunks.join("").slice(0, 500);
        console.error(`[yt-dlp] Early exit (code ${code}):`, errSummary);

        if (!headersSentFlag && !res.headersSent) {
          const userMsg = errSummary.includes("unavailable") || errSummary.includes("private")
            ? "This video is unavailable or private."
            : errSummary.includes("Sign in") || errSummary.includes("age")
            ? "This video requires sign-in or is age-restricted."
            : "Download failed. Please try again or use a different video.";
          res.status(500).json({ error: userMsg, detail: errSummary });
        }
      }
    });

    subprocess.on("error", (err: Error) => {
      clearTimeout(earlyFailTimer);
      console.error("[yt-dlp] Subprocess spawn error:", err.message);
      if (!headersSentFlag && !res.headersSent) {
        res.status(500).json({ error: "Failed to start download process.", detail: err.message });
      }
    });

    // If client disconnects, kill the subprocess to free resources
    req.on("close", () => {
      clearTimeout(earlyFailTimer);
      subprocess.kill?.();
    });
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
