import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import youtubedl from "youtube-dl-exec";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Pre-setup for environment cookies to avoid sync writes on every request
const setupEnvironmentCookies = () => {
  if (process.env.YOUTUBE_COOKIES) {
    const tempCookies = path.join(process.cwd(), 'temp_cookies.txt');
    try {
      fs.writeFileSync(tempCookies, process.env.YOUTUBE_COOKIES);
      return tempCookies;
    } catch (e) {
      console.error("Failed to write env cookies:", e);
    }
  }
  return '';
};

const ENV_COOKIE_PATH = setupEnvironmentCookies();

// Build universal options for yt-dlp to bypass bot detection
const getDlOpts = () => {
  const opts: any = {
    dumpJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    referer: 'https://www.youtube.com/',
    // Standard User-Agent to help with bypass
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  };

  // Support for cookies (Essential for server environments)
  const COOKIE_NAMES = ['cookies.txt', 'www.youtube.com_cookies.txt'];
  let cookiePath = ENV_COOKIE_PATH;
  
  for (const name of COOKIE_NAMES) {
    const fullPath = path.join(process.cwd(), name);
    if (fs.existsSync(fullPath)) {
      cookiePath = fullPath;
      break;
    }
  }

  if (cookiePath) {
    opts.cookies = cookiePath;
  }

  return opts;
};

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000');

  app.use(cors());
  app.use(express.json());

  // Helper to extract video ID from URL
  const getVideoId = (url: string) => {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
  };

  // Session-based Rate Limiting
  const sessionLimits = new Map<string, { count: number, resetAt: number }>();
  const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
  const MAX_REQUESTS_PER_WINDOW = 15; // 15 requests per minute per session

  const sessionRateLimiter = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const sessionId = req.headers['x-session-id'] as string || req.ip || 'anonymous';
    const now = Date.now();

    let limitData = sessionLimits.get(sessionId);

    // If no limit data or the window has expired, reset
    if (!limitData || now > limitData.resetAt) {
      limitData = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    }

    limitData.count++;
    sessionLimits.set(sessionId, limitData);

    if (limitData.count > MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({ error: "Too many requests from this session. Please try again in a minute." });
    }

    next();
  };

  // Clean up old sessions periodically to prevent memory leaks
  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, limitData] of sessionLimits.entries()) {
      if (now > limitData.resetAt) {
        sessionLimits.delete(sessionId);
      }
    }
  }, RATE_LIMIT_WINDOW_MS);

  // API Routes
  app.get("/api/info", sessionRateLimiter, async (req, res) => {
    const videoUrl = req.query.url as string;
    if (!videoUrl) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Check cache first
    const cached = infoCache.get(videoUrl);
    if (cached && cached.expiry > Date.now()) {
      return res.json(cached.data);
    }

    const videoId = getVideoId(videoUrl);

    // Try YouTube Data API v3 if key is available
    if (YOUTUBE_API_KEY && videoId) {
      try {
        const response = await axios.get(`https://www.googleapis.com/youtube/v3/videos`, {
          params: {
            part: 'snippet,contentDetails',
            id: videoId,
            key: YOUTUBE_API_KEY
          }
        });

        if (response.data.items && response.data.items.length > 0) {
          const item = response.data.items[0];
          const snippet = item.snippet;
          const contentDetails = item.contentDetails;

          // Convert ISO 8601 duration to seconds
          const durationMatch = contentDetails.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
          const hours = parseInt(durationMatch[1] || '0');
          const minutes = parseInt(durationMatch[2] || '0');
          const seconds = parseInt(durationMatch[3] || '0');
          const durationSeconds = (hours * 3600) + (minutes * 60) + seconds;

          const responseData = {
            title: snippet.title,
            thumbnail: snippet.thumbnails.maxres?.url || snippet.thumbnails.high?.url || snippet.thumbnails.default?.url,
            duration: durationSeconds.toString(),
            author: snippet.channelTitle,
            url: videoUrl
          };

          infoCache.set(videoUrl, {
            data: responseData,
            expiry: Date.now() + CACHE_DURATION
          });

          return res.json(responseData);
        }
      } catch (apiError) {
        console.warn("YouTube API failed, falling back to scraper:", apiError);
      }
    }

    // Fallback to youtube-dl-exec scraper
    let retries = 2;
    let lastError: any = null;

    while (retries > 0) {
      try {
        const info = await youtubedl(videoUrl, getDlOpts()) as any;
        
        const responseData = {
          title: info.title,
          thumbnail: info.thumbnail,
          duration: info.duration.toString(),
          author: info.uploader,
          url: videoUrl
        };

        infoCache.set(videoUrl, {
          data: responseData,
          expiry: Date.now() + CACHE_DURATION
        });

        return res.json(responseData);
      } catch (error: any) {
        lastError = error;
        console.warn(`youtube-dl-exec failed. Retries left: ${retries - 1}`);
        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        break;
      }
    }

    console.error("Error fetching info:", lastError);
    const message = lastError?.message || "Failed to fetch video info";
    
    res.status(500).json({ error: message });
  });

  // Download endpoint - streams media directly
  app.get("/api/download", sessionRateLimiter, async (req, res) => {
    const videoUrl = req.query.url as string;
    const quality = req.query.quality as string || "highestaudio";
    const mediaType = req.query.type as string || "audio";
    
    if (!videoUrl) {
      return res.status(400).send("URL is required");
    }

    try {
      // Get info first to set headers
      const info = await youtubedl(videoUrl, getDlOpts()) as any;

      // Sanitize title for filename
      const title = info.title
        .replace(/[^\x00-\x7F]/g, "") // Remove non-ASCII
        .replace(/[\/\\?%*:|"><]/g, "_") // Remove invalid filename chars
        .trim() || "download";
      
      const isVideo = mediaType === "video";
      const fileExt = isVideo ? "mp4" : "m4a";
      const mimeType = isVideo ? "video/mp4" : "audio/mp4";
      
      res.setHeader("Content-Disposition", `attachment; filename="${title}.${fileExt}"`);
      res.setHeader("Content-Type", mimeType);
      
      // Build a robust format string with multiple fallback chains
      let formatStr: string;
      
      if (!isVideo) {
        // Audio: try m4a first, then any audio, then best overall
        if (quality === 'low') {
          formatStr = 'worstaudio[ext=m4a]/worstaudio/worst';
        } else if (quality === 'medium') {
          formatStr = 'bestaudio[ext=m4a][abr<=192]/bestaudio[abr<=192]/bestaudio[ext=m4a]/bestaudio';
        } else {
          formatStr = 'bestaudio[ext=m4a]/bestaudio/best';
        }
      } else {
        // Video: try mp4 container first with audio, then fallback to best available
        if (quality === '1080p') {
          formatStr = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[ext=mp4]/best';
        } else if (quality === '360p') {
          formatStr = 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[ext=mp4][height<=360]/best';
        } else {
          // Default 720p
          formatStr = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[ext=mp4]/best';
        }
      }
      
      const subprocess = youtubedl.exec(videoUrl, {
        ...getDlOpts(),
        format: formatStr,
        output: '-',
        dumpJson: false // Don't dump json for the actual stream
      });

      // Handle errors on the subprocess streams
      subprocess.stdout.on("error", (err) => {
        console.error("stdout stream error:", err);
        if (!res.headersSent) {
          res.status(500).send("Stream error occurred");
        }
      });

      let stderrOutput = "";
      subprocess.stderr.on("data", (data: Buffer) => {
        const msg = data.toString();
        stderrOutput += msg;
        // yt-dlp prints progress to stderr - only log actual errors
        if (msg.includes('ERROR')) {
          console.error("yt-dlp error:", msg);
        }
      });

      subprocess.on("error", (err) => {
        console.error("Subprocess error:", err);
        if (!res.headersSent) {
          res.status(500).send(`Process error: ${err.message}`);
        }
      });

      subprocess.on("close", (code) => {
        if (code !== 0 && !res.headersSent) {
          console.error(`yt-dlp exited with code ${code}. Error: ${stderrOutput}`);
          res.status(500).json({ 
            error: "Download process failed", 
            details: stderrOutput.split('\n').filter(l => l.includes('ERROR')).join(' ') || "No error message provided"
          });
        }
      });

      // Pipe the output to the response
      subprocess.stdout.pipe(res);

    } catch (error: any) {
      console.error("Download error:", error);
      if (!res.headersSent) {
        res.status(500).send(error.message || "Failed to download");
      }
    }
  });

  // Production-only static asset serving (only if backend is serving Frontend)
  if (process.env.NODE_ENV === "production" && !process.env.API_ONLY) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 EchoTube Server Running on Port: ${PORT}`);
  });
}

startServer();
