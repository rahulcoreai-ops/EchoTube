import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Download, Youtube, Music, Loader2, CheckCircle2, AlertCircle,
  Clock, User, ArrowRight, X, History, ExternalLink, Trash2,
  Sparkles, Sun, Moon, Video, Headphones, ThumbsUp, Heart,
  Shield, FileText, Activity, Wifi, WifiOff,
} from 'lucide-react';
import { DottedSurface } from './components/ui/dotted-surface';
import { ConcentricLoader } from './components/ui/loader';

// ─── Types ───────────────────────────────────────────────────────────────────
interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: string;
  author: string;
  url: string;
  timestamp?: number;
}

type Theme        = 'light' | 'dark';
type MediaType    = 'audio' | 'video';
type DownloadState = 'idle' | 'downloading' | 'done';
type LegalPage    = 'privacy' | 'terms' | 'status' | null;

// ─── Constants ────────────────────────────────────────────────────────────────
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const AUDIO_QUALITIES = [
  { label: '128kbps', value: 'low',          desc: 'Standard' },
  { label: '256kbps', value: 'medium',       desc: 'High' },
  { label: '320kbps', value: 'highestaudio', desc: 'Premium', recommended: true },
] as const;

const VIDEO_QUALITIES = [
  { label: '360p',  value: '360p', desc: 'Data Saver' },
  { label: '720p',  value: '720p', desc: 'HD',   recommended: true },
  { label: '1080p', value: '1080p', desc: 'Full HD' },
] as const;

const MAX_HISTORY = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const apiUrl = (path: string) => `${API_BASE}${path}`;

const getOrCreateSessionId = (): string => {
  let id = localStorage.getItem('echo_session_id');
  if (!id) {
    id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    localStorage.setItem('echo_session_id', id);
  }
  return id;
};

const formatDuration = (seconds: string): string => {
  const s = parseInt(seconds) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const isYouTubeUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'].includes(u.hostname);
  } catch { return false; }
};

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [url,           setUrl]           = useState('');
  const [loading,       setLoading]       = useState(false);
  const [videoInfo,     setVideoInfo]     = useState<VideoInfo | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [history,       setHistory]       = useState<VideoInfo[]>([]);
  const [showHistory,   setShowHistory]   = useState(false);
  const [theme,         setTheme]         = useState<Theme>('light');
  const [mediaType,     setMediaType]     = useState<MediaType>('audio');
  const [audioQuality,  setAudioQuality]  = useState('highestaudio');
  const [videoQuality,  setVideoQuality]  = useState('720p');
  const [dlState,       setDlState]       = useState<DownloadState>('idle');
  const [dlPercent,     setDlPercent]     = useState(0);
  const [legalPage,     setLegalPage]     = useState<LegalPage>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    getOrCreateSessionId();
    const saved = localStorage.getItem('echo_history');
    if (saved) { try { setHistory(JSON.parse(saved)); } catch { /**/ } }
    const savedTheme = localStorage.getItem('echo_theme') as Theme | null;
    setTheme(savedTheme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

    // Ping backend health — retry up to 3x to handle Render cold-start spin-up
    const checkHealth = async (attempt = 1) => {
      try {
        const r = await fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(8000) });
        setBackendOnline(r.ok);
      } catch {
        if (attempt < 3) {
          setTimeout(() => checkHealth(attempt + 1), 4000 * attempt);
        } else {
          setBackendOnline(false);
        }
      }
    };
    checkHealth();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('echo_theme', theme);
  }, [theme]);

  // ── History helpers ────────────────────────────────────────────────────────
  const addToHistory = useCallback((info: VideoInfo) => {
    setHistory(prev => {
      const updated = [
        { ...info, timestamp: Date.now() },
        ...prev.filter(i => i.url !== info.url),
      ].slice(0, MAX_HISTORY);
      localStorage.setItem('echo_history', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('echo_history');
  };

  // ── Reset ──────────────────────────────────────────────────────────────────
  const resetAll = () => {
    abortRef.current?.abort();
    setVideoInfo(null);
    setUrl('');
    setError(null);
    setDlState('idle');
    setDlPercent(0);
  };

  // ── Fetch video info ───────────────────────────────────────────────────────
  const fetchInfo = async (e?: React.FormEvent, targetUrl?: string) => {
    if (e) e.preventDefault();
    const finalUrl = (targetUrl ?? url).trim();
    if (!finalUrl) return;

    if (!isYouTubeUrl(finalUrl)) {
      setError('Please enter a valid YouTube URL.');
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    setVideoInfo(null);
    setDlState('idle');
    setDlPercent(0);

    try {
      const res = await fetch(apiUrl(`/api/info?url=${encodeURIComponent(finalUrl)}`), {
        headers: { 'x-session-id': getOrCreateSessionId() },
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch video info.');
      const info: VideoInfo = { ...data, url: finalUrl };
      setVideoInfo(info);
      addToHistory(info);
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Download ───────────────────────────────────────────────────────────────
  const executeDownload = async () => {
    if (!videoInfo || dlState === 'downloading') return;

    // Guard: surface a clear message if backend is known offline
    if (backendOnline === false) {
      setError('The EchoTube backend is currently offline. Please try again in a few minutes.');
      return;
    }

    const qualityParam = mediaType === 'audio' ? audioQuality : videoQuality;
    const endpoint = apiUrl(
      `/api/download?url=${encodeURIComponent(videoInfo.url)}&quality=${qualityParam}&type=${mediaType}`
    );

    setDlState('downloading');
    setDlPercent(0);
    setError(null);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    // Simulated progress: fast ramp-up, slows near 90%
    let sim = 0;
    const simTimer = setInterval(() => {
      sim = Math.min(90, sim + Math.max(0.4, (90 - sim) * 0.045));
      setDlPercent(Math.round(sim));
    }, 350);

    try {
      const response = await fetch(endpoint, {
        headers: { 'x-session-id': getOrCreateSessionId() },
        signal: ac.signal,
      });

      if (!response.ok) {
        // Server sends JSON { error, detail } — parse it cleanly
        const raw = await response.text().catch(() => '');
        let msg = `Server error ${response.status}`;
        try {
          const parsed = JSON.parse(raw);
          msg = parsed.error || parsed.message || msg;
        } catch {
          msg = raw || msg;
        }
        throw new Error(msg);
      }

      // Extract filename from Content-Disposition
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const fnMatch = disposition.match(/filename="(.+?)"/);
      const filename = fnMatch?.[1] ?? `echoutube.${mediaType === 'audio' ? 'm4a' : 'mp4'}`;

      // Stream to blob — show real progress if Content-Length available
      const contentLength = Number(response.headers.get('Content-Length') ?? 0);
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          clearInterval(simTimer);
          setDlPercent(Math.min(99, Math.round((received / contentLength) * 100)));
        }
      }

      clearInterval(simTimer);
      setDlPercent(100);
      setDlState('done');

      // Trigger browser save
      const blob = new Blob(chunks as BlobPart[]);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);

      // Auto-reset after 3s so user can download again without full reload
      setTimeout(resetAll, 3000);

    } catch (err: unknown) {
      clearInterval(simTimer);
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || 'Download failed. Please try again.');
      }
      setDlState('idle');
      setDlPercent(0);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen text-slate-800 dark:text-neutral-100 font-sans selection:bg-cyan-500/30 relative overflow-hidden transition-colors duration-300">

      {/* 3D background */}
      <DottedSurface theme={theme} className="opacity-60 dark:opacity-80 transition-opacity duration-1000" />
      <div className="absolute inset-0 bg-gradient-to-t from-white/40 via-transparent to-transparent dark:from-black/60 pointer-events-none z-[1]" />

      {/* ── Navbar ──────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 w-full solid-card border-b border-slate-200/50 dark:border-neutral-900 z-50 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <button
            onClick={resetAll}
            className="flex items-center gap-3 group"
          >
            <img src="/logo.png" alt="EchoTube" className="w-10 h-10 rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.3)] group-hover:scale-105 transition-transform duration-300 object-contain" />
            <span className="font-bold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-500 dark:from-white dark:to-neutral-400">EchoTube</span>
          </button>

          <div className="flex items-center gap-4 text-sm font-semibold text-slate-600 dark:text-neutral-400">
            {/* Backend status indicator */}
            {backendOnline !== null && (
              <div className={`hidden sm:flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${
                backendOnline
                  ? 'text-green-600 dark:text-green-400 border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30'
                  : 'text-red-500 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30'
              }`}>
                {backendOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {backendOnline ? 'Online' : 'Backend Offline'}
              </div>
            )}
            <button
              onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
              className="p-2 hover:bg-slate-100 dark:hover:bg-neutral-800 rounded-full transition-all"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setShowHistory(s => !s)}
              className="flex items-center gap-2 hover:text-slate-900 dark:hover:text-white transition-colors group px-2 py-1.5"
            >
              <History className="w-5 h-5 group-hover:-rotate-[30deg] transition-transform duration-300" />
              <span className="hidden sm:inline">History</span>
              {history.length > 0 && (
                <span className="bg-cyan-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {history.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* ── History sidebar ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[60]"
            />
            <motion.div
              key="sidebar"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full max-w-sm glass-card border-l border-slate-200 dark:border-neutral-900 z-[70] p-8 overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-10">
                <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-900 dark:text-white">
                  <History className="w-6 h-6 text-cyan-500" /> Your History
                </h2>
                <button onClick={() => setShowHistory(false)} className="p-2.5 hover:bg-slate-100 dark:hover:bg-neutral-800 rounded-full transition-all">
                  <X className="w-6 h-6" />
                </button>
              </div>

              {history.length === 0 ? (
                <div className="text-center py-20 text-slate-400 dark:text-neutral-500">
                  <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="font-medium">No recent conversions yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((item, i) => (
                    <motion.div
                      key={item.url}
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => { fetchInfo(undefined, item.url); setShowHistory(false); setUrl(item.url); }}
                      className="group flex gap-4 p-4 rounded-2xl glass-input border-slate-200 dark:border-neutral-800 hover:border-cyan-400 dark:hover:border-cyan-900 transition-all cursor-pointer hover:shadow-[0_4px_20px_rgba(6,182,212,0.15)]"
                    >
                      <div className="w-24 h-14 rounded-xl overflow-hidden flex-shrink-0 shadow-sm">
                        <img src={item.thumbnail} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" referrerPolicy="no-referrer" alt={item.title} />
                      </div>
                      <div className="flex-1 min-w-0 py-0.5">
                        <p className="font-bold text-sm truncate mb-1 text-slate-800 dark:text-neutral-200 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">{item.title}</p>
                        <p className="text-xs text-slate-500 dark:text-neutral-400 font-medium truncate">{item.author}</p>
                      </div>
                    </motion.div>
                  ))}
                  <button
                    onClick={clearHistory}
                    className="w-full py-4 mt-4 text-sm font-bold text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-neutral-900 rounded-xl flex items-center justify-center gap-2 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Clear History
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="pt-32 sm:pt-40 pb-28 px-4 sm:px-6 relative z-10 min-h-[calc(100vh-100px)]">
        <div className="max-w-4xl mx-auto">

          {/* Hero */}
          <div className="text-center mb-16">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, type: 'spring' }}>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-input border border-cyan-300 dark:border-cyan-900 text-cyan-600 dark:text-cyan-400 text-sm font-bold mb-8 backdrop-blur-md shadow-sm">
                <Sparkles className="w-4 h-4" />
                Premium Audio & Video Extractor
              </div>
              <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight mb-6 leading-tight text-slate-900 dark:text-white drop-shadow-sm">
                Turn YouTube into{' '}
                <br />
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 via-blue-600 to-purple-600 dark:from-cyan-400 dark:via-blue-500 dark:to-purple-500 pb-2">
                  Pure Media.
                </span>
              </h1>
              <p className="text-lg sm:text-xl text-slate-600 dark:text-neutral-400 max-w-2xl mx-auto font-medium leading-relaxed">
                High-fidelity MP3 and MP4 conversions, directly to your device.
                No ads, no limits.
              </p>
            </motion.div>
          </div>

          {/* Search bar */}
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="relative mb-16">
            <form onSubmit={fetchInfo} className="relative group">
              <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center glass-input rounded-3xl p-2 sm:p-2.5 shadow-[0_15px_40px_rgba(0,0,0,0.06)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] focus-within:shadow-[0_20px_50px_rgba(6,182,212,0.15)] dark:focus-within:shadow-[0_0_40px_rgba(6,182,212,0.1)] focus-within:border-cyan-400 dark:focus-within:border-cyan-800 transition-all duration-500 border border-slate-200 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700">
                <div className="flex items-center flex-1 px-4 sm:px-6">
                  <Youtube className="w-7 h-7 text-slate-400 dark:text-neutral-500 group-focus-within:text-cyan-500 transition-colors duration-300 flex-shrink-0" />
                  <input
                    type="text"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="Paste a YouTube link..."
                    className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-base sm:text-lg py-4 sm:py-5 placeholder:text-slate-400 dark:placeholder:text-neutral-600 font-semibold min-w-0 ml-4 sm:ml-5 text-slate-900 dark:text-white"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <AnimatePresence>
                    {url && (
                      <motion.button
                        key="clear"
                        initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }}
                        type="button"
                        onClick={() => { setUrl(''); setError(null); }}
                        className="p-2.5 hover:bg-slate-100 dark:hover:bg-neutral-800 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white transition-all mr-2"
                      >
                        <X className="w-5 h-5" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
                <button
                  type="submit"
                  disabled={loading || !url}
                  className="relative overflow-hidden bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 sm:px-10 py-5 rounded-2xl font-bold text-base hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 mt-2 sm:mt-0 group/btn shadow-[0_8px_20px_rgba(59,130,246,0.25)] active:scale-[0.98]"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span className="tracking-wide">Analyze</span>
                      <ArrowRight className="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>

          {/* Results area */}
          <AnimatePresence mode="wait">

            {/* Error */}
            {error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 p-5 rounded-2xl flex items-start gap-4 text-red-600 dark:text-red-400 mb-8 glass-card"
              >
                <AlertCircle className="w-6 h-6 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold">Error</h3>
                  <p className="text-sm mt-1 font-medium">{error}</p>
                </div>
                <button onClick={() => setError(null)} className="ml-auto p-1 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* Video card */}
            {videoInfo && (
              <motion.div
                key="card"
                initial={{ opacity: 0, scale: 0.97, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -20 }}
                className="glass-card rounded-[2.5rem] p-6 sm:p-10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.08)] dark:shadow-[0_40px_100px_-20px_rgba(0,0,0,0.7)] border border-slate-200/60 dark:border-neutral-800 relative z-20"
              >
                <div className="flex flex-col lg:flex-row gap-8 sm:gap-10">

                  {/* Thumbnail */}
                  <div className="w-full lg:w-96 flex-shrink-0">
                    <div className="relative aspect-video rounded-[1.5rem] overflow-hidden group shadow-[0_15px_30px_-10px_rgba(0,0,0,0.2)] dark:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.6)] border border-slate-200 dark:border-neutral-900">
                      <img
                        src={videoInfo.thumbnail} alt={videoInfo.title}
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 dark:from-black via-transparent to-transparent opacity-60 dark:opacity-80" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-16 h-16 bg-white/30 dark:bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center border border-white/40 dark:border-white/10 shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100">
                          {mediaType === 'audio'
                            ? <Music className="w-8 h-8 text-cyan-500 dark:text-cyan-400" />
                            : <Video className="w-8 h-8 text-purple-500 dark:text-purple-400" />}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Info + controls */}
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <h2 className="text-2xl sm:text-3xl font-extrabold leading-tight mb-5 line-clamp-2 text-slate-900 dark:text-white tracking-tight">
                        {videoInfo.title}
                      </h2>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <div className="flex items-center gap-2 bg-slate-100/50 dark:bg-neutral-900/50 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-neutral-800">
                          <User className="w-4 h-4 text-cyan-600 dark:text-cyan-500" />
                          <span className="font-semibold text-slate-700 dark:text-neutral-300">{videoInfo.author}</span>
                        </div>
                        <div className="flex items-center gap-2 bg-slate-100/50 dark:bg-neutral-900/50 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-neutral-800">
                          <Clock className="w-4 h-4 text-purple-600 dark:text-purple-500" />
                          <span className="font-semibold text-slate-700 dark:text-neutral-300">{formatDuration(videoInfo.duration)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Format & quality */}
                    <div className="mt-8">
                      {/* Toggle */}
                      <div className="flex bg-slate-100 dark:bg-neutral-900 p-1.5 rounded-2xl mb-6 border border-slate-200 dark:border-neutral-800">
                        {(['audio', 'video'] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => { setMediaType(m); setDlState('idle'); setDlPercent(0); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all duration-300 ${
                              mediaType === m
                                ? `bg-white dark:bg-black shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.5)] ${m === 'audio' ? 'text-cyan-600 dark:text-cyan-400' : 'text-purple-600 dark:text-purple-400'}`
                                : 'text-slate-500 dark:text-neutral-500 hover:text-slate-700 dark:hover:text-neutral-300'
                            }`}
                          >
                            {m === 'audio' ? <Headphones className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                            {m === 'audio' ? 'Audio M4A' : 'Video MP4'}
                          </button>
                        ))}
                      </div>

                      {/* Quality grid */}
                      <p className="text-[11px] font-bold text-slate-500 dark:text-neutral-500 uppercase tracking-widest mb-3 px-1">
                        {mediaType === 'audio' ? 'Bitrate' : 'Resolution'}
                      </p>
                      <div className="grid grid-cols-3 gap-3">
                        {(mediaType === 'audio' ? AUDIO_QUALITIES : VIDEO_QUALITIES).map(q => {
                          const isSelected = mediaType === 'audio' ? audioQuality === q.value : videoQuality === q.value;
                          const select = () => {
                            if (mediaType === 'audio') setAudioQuality(q.value);
                            else setVideoQuality(q.value);
                            setDlState('idle');
                          };
                          const accent = mediaType === 'audio' ? 'cyan' : 'purple';
                          return (
                            <button
                              key={q.value}
                              onClick={select}
                              className={`relative flex flex-col items-center p-3 sm:p-4 rounded-xl border-2 transition-all duration-300 ${
                                isSelected
                                  ? `bg-white dark:bg-neutral-900 border-${accent}-500 shadow-[0_10px_20px_rgba(6,182,212,0.15)] -translate-y-1`
                                  : 'bg-slate-50/50 dark:bg-neutral-900/40 border-transparent text-slate-500 dark:text-neutral-600 hover:border-slate-300 dark:hover:border-neutral-700 hover:bg-white dark:hover:bg-neutral-900'
                              }`}
                            >
                              {'recommended' in q && q.recommended && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-md whitespace-nowrap flex items-center gap-1">
                                  <ThumbsUp className="w-2.5 h-2.5" /> Best
                                </div>
                              )}
                              <span className={`text-sm sm:text-base font-extrabold ${isSelected ? `text-${accent}-600 dark:text-${accent}-400` : 'text-slate-500 dark:text-neutral-400'}`}>{q.label}</span>
                              <span className="text-[10px] sm:text-xs font-semibold mt-1 opacity-70">{q.desc}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Download button */}
                    <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">

                      {dlState === 'idle' && (
                        <button
                          onClick={executeDownload}
                          className={`flex-1 bg-gradient-to-r ${mediaType === 'audio' ? 'from-cyan-500 to-blue-600' : 'from-purple-500 to-pink-600'} text-white px-8 py-4 rounded-xl font-bold uppercase tracking-wider hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-[0_10px_20px_rgba(6,182,212,0.25)] group/dl`}
                        >
                          <Download className="w-5 h-5 sm:w-6 sm:h-6 group-hover/dl:-translate-y-1 transition-transform" />
                          Convert & Download
                        </button>
                      )}

                      {dlState === 'downloading' && (
                        <div className="flex-1 bg-gradient-to-r from-slate-800 to-slate-700 dark:from-neutral-900 dark:to-black text-cyan-400 border border-slate-700 dark:border-neutral-700 px-6 py-5 rounded-xl font-bold flex items-center gap-5 shadow-xl overflow-hidden relative">
                          <div className="absolute inset-0 bg-cyan-500/10 transition-all duration-500 ease-out" style={{ width: `${dlPercent}%` }} />
                          <div className="relative z-10 flex-shrink-0"><ConcentricLoader size="sm" /></div>
                          <div className="relative z-10 flex flex-col flex-1 min-w-0">
                            <span className="tracking-widest text-sm text-cyan-400 uppercase">Converting & Downloading…</span>
                            <span className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium mt-0.5">File will save automatically</span>
                          </div>
                          <span className="relative z-10 text-2xl font-extrabold tabular-nums text-cyan-300 flex-shrink-0">{dlPercent}%</span>
                        </div>
                      )}

                      {dlState === 'done' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                          className="flex-1 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 text-green-700 dark:text-green-400 px-6 py-5 rounded-xl font-bold flex items-center gap-4"
                        >
                          <CheckCircle2 className="w-6 h-6 flex-shrink-0" />
                          <span>Downloaded! Resetting in a moment…</span>
                        </motion.div>
                      )}

                      <a
                        href={videoInfo.url} target="_blank" rel="noopener noreferrer"
                        className="px-6 py-4 bg-white dark:bg-black border-2 border-slate-200 dark:border-neutral-800 rounded-xl flex items-center justify-center text-slate-500 dark:text-neutral-500 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-neutral-600 transition-all group shadow-sm hover:shadow-md"
                        title="Open on YouTube"
                      >
                        <ExternalLink className="w-6 h-6 group-hover:scale-110 transition-transform" />
                      </a>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Feature cards */}
          {!videoInfo && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-10 mt-20 relative z-10"
            >
              {[
                { icon: Music,        color: 'text-cyan-600 dark:text-cyan-400',   bg: 'bg-cyan-50 dark:bg-cyan-950/30',   border: 'border-cyan-100 dark:border-cyan-900/50',   title: 'Lossless Grade',  desc: 'Crystal-clear native audio extracted directly from the source server.' },
                { icon: Video,        color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-100 dark:border-purple-900/50', title: 'HD Video MP4',   desc: 'Download high-definition video tracks cleanly up to 1080p.' },
                { icon: CheckCircle2, color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-950/30',   border: 'border-blue-100 dark:border-blue-900/50',   title: 'Free Forever',   desc: 'No subscriptions, no rate limits. Your favourite content, on demand.' },
              ].map(({ icon: Icon, color, bg, border, title, desc }, i) => (
                <div key={i} className="text-center group glass-card p-8 rounded-3xl border-slate-200/60 dark:border-neutral-900 hover:border-slate-300 dark:hover:border-neutral-700 transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] dark:hover:shadow-2xl bg-white/70 dark:bg-neutral-900/40">
                  <div className={`w-16 h-16 ${bg} ${border} border rounded-2xl flex items-center justify-center mx-auto mb-6 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3`}>
                    <Icon className={`w-8 h-8 ${color}`} />
                  </div>
                  <h3 className="font-bold text-xl mb-3 text-slate-900 dark:text-white tracking-tight">{title}</h3>
                  <p className="text-sm text-slate-500 dark:text-neutral-400 leading-relaxed font-medium">{desc}</p>
                </div>
              ))}
            </motion.div>
          )}
        </div>
      </main>

      {/* ── Legal modal ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {legalPage && (
          <motion.div
            key="legal"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/95 dark:bg-black/95 backdrop-blur-xl z-[80] overflow-y-auto"
          >
            <div className="max-w-3xl mx-auto px-6 py-20">
              <button onClick={() => setLegalPage(null)} className="mb-10 flex items-center gap-2 text-slate-500 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white font-bold text-sm transition-colors">
                <ArrowRight className="w-4 h-4 rotate-180" /> Back to EchoTube
              </button>

              {legalPage === 'privacy' && (
                <div>
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-14 h-14 bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-100 dark:border-cyan-900/50 rounded-2xl flex items-center justify-center">
                      <Shield className="w-7 h-7 text-cyan-600 dark:text-cyan-400" />
                    </div>
                    <div>
                      <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">Privacy Policy</h1>
                      <p className="text-sm text-slate-500 mt-1">Last updated: April 2026</p>
                    </div>
                  </div>
                  <div className="space-y-8 text-slate-600 dark:text-neutral-300 leading-relaxed">
                    {[
                      { title: 'Data We Collect', body: 'EchoTube does not collect or store any personal information. No accounts, no email addresses, no registration required. Session IDs are generated locally in your browser and are never sent to external analytics services.' },
                      { title: 'Local Storage', body: 'We use browser localStorage solely to persist your theme preference and recent conversion history on your own device. This data never leaves your browser.' },
                      { title: 'Third-Party Services', body: 'Video metadata is fetched from YouTube\'s public API. Downloaded media is streamed directly from source servers through our backend proxy and is never stored on our infrastructure.' },
                      { title: 'Your Rights', body: 'Since we collect no data, there is nothing to delete. Clear your browser localStorage at any time to remove all EchoTube preferences.' },
                    ].map(s => (
                      <section key={s.title}>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">{s.title}</h2>
                        <p>{s.body}</p>
                      </section>
                    ))}
                  </div>
                </div>
              )}

              {legalPage === 'terms' && (
                <div>
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-14 h-14 bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900/50 rounded-2xl flex items-center justify-center">
                      <FileText className="w-7 h-7 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">Terms of Service</h1>
                      <p className="text-sm text-slate-500 mt-1">Last updated: April 2026</p>
                    </div>
                  </div>
                  <div className="space-y-8 text-slate-600 dark:text-neutral-300 leading-relaxed">
                    {[
                      { title: 'Acceptable Use', body: 'EchoTube is provided for personal, non-commercial archival use only. You are solely responsible for ensuring your use complies with applicable copyright laws and YouTube\'s Terms of Service in your jurisdiction.' },
                      { title: 'No Warranty', body: 'This service is provided "as is" without any warranties, express or implied. We do not guarantee uninterrupted access, download speeds, or compatibility with all video formats.' },
                      { title: 'Limitation of Liability', body: 'EchoTube and its creators shall not be liable for any direct, indirect, incidental, or consequential damages arising from your use of this service.' },
                      { title: 'Modifications', body: 'We reserve the right to modify these terms at any time. Continued use of EchoTube constitutes acceptance of the updated terms.' },
                    ].map(s => (
                      <section key={s.title}>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">{s.title}</h2>
                        <p>{s.body}</p>
                      </section>
                    ))}
                  </div>
                </div>
              )}

              {legalPage === 'status' && (
                <div>
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-14 h-14 bg-green-50 dark:bg-green-950/40 border border-green-100 dark:border-green-900/50 rounded-2xl flex items-center justify-center">
                      <Activity className="w-7 h-7 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">System Status</h1>
                      <p className="text-sm text-slate-500 mt-1">
                        Backend: {backendOnline === null ? 'Checking…' : backendOnline ? '✅ Online' : '❌ Offline'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {[
                      'API Server', 'YouTube Data API', 'Audio Extraction Engine',
                      'Video Extraction Engine', 'CDN / Static Assets',
                    ].map(name => (
                      <div key={name} className="flex items-center justify-between p-5 rounded-2xl glass-card border border-slate-200 dark:border-neutral-800">
                        <span className="font-bold text-slate-800 dark:text-white">{name}</span>
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)] ${backendOnline ? 'bg-green-500' : 'bg-yellow-500'}`} />
                          <span className={`text-sm font-semibold ${backendOnline ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                            {backendOnline ? 'Operational' : 'Checking…'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="fixed bottom-0 left-0 right-0 border-t border-slate-200 dark:border-neutral-900 z-40 solid-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 opacity-70 dark:opacity-50">
            <img src="/logo.png" alt="EchoTube" className="w-5 h-5 rounded object-contain" />
            <span className="font-bold text-xs tracking-widest uppercase text-slate-600 dark:text-neutral-400">EchoTube</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-neutral-400 text-center font-medium flex items-center gap-1.5 flex-wrap justify-center">
            Made with <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500 animate-pulse" /> by
            <span className="font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 to-purple-500">Chitra</span>
            <span className="text-slate-400 dark:text-neutral-600">—</span>
            <span className="w-6 h-6 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full inline-flex items-center justify-center text-white font-extrabold text-[10px] shadow-md">CM</span>
          </p>
          <div className="flex gap-6 text-xs text-slate-500 dark:text-neutral-500 font-bold">
            <button onClick={() => setLegalPage('privacy')} className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">Privacy</button>
            <button onClick={() => setLegalPage('terms')}   className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">Terms</button>
            <button onClick={() => setLegalPage('status')}  className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">Status</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
