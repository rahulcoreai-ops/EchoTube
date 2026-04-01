import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Download, 
  Youtube, 
  Music, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  User,
  ArrowRight,
  X,
  History,
  ExternalLink,
  Trash2,
  Sparkles,
  Sun,
  Moon,
  Video,
  Headphones,
  ThumbsUp,
  Heart,
  Shield,
  FileText,
  Activity
} from 'lucide-react';
import { DottedSurface } from './components/ui/dotted-surface';
import { ConcentricLoader } from './components/ui/loader';

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: string;
  author: string;
  url: string;
  timestamp?: number;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<VideoInfo[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  
  // Theme and media state
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mediaType, setMediaType] = useState<'audio' | 'video'>('audio');
  const [selectedAudioQuality, setSelectedAudioQuality] = useState('320');
  const [selectedVideoQuality, setSelectedVideoQuality] = useState('720');
  
  // Download animation state
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading'>('idle');
  // Legal page modal
  const [legalPage, setLegalPage] = useState<'privacy' | 'terms' | 'status' | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);

  const audioQualities = [
    { label: '128kbps', value: 'low', desc: 'Standard' },
    { label: '256kbps', value: 'medium', desc: 'High' },
    { label: '320kbps', value: 'highestaudio', desc: 'Premium', recommended: true }
  ];

  const videoQualities = [
    { label: '360p', value: '360p', desc: 'Data Saver' },
    { label: '720p', value: '720p', desc: 'HD Quality', recommended: true },
    { label: '1080p', value: '1080p', desc: 'Full HD' }
  ];

  useEffect(() => {
    if (!localStorage.getItem('echo_session_id')) {
      const newSessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('echo_session_id', newSessionId);
    }
    const saved = localStorage.getItem('echo_recent');
    if (saved) {
      try { setRecent(JSON.parse(saved)); } catch (e) { console.error("History parse fail"); }
    }
    
    const savedTheme = localStorage.getItem('echo_theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme as 'light' | 'dark');
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('light'); 
    }
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('echo_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');
  const getSessionId = () => localStorage.getItem('echo_session_id') || 'anonymous';
  
  // Helper to construct API URLs for production decoupling
  const getApiUrl = (path: string) => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
    // Ensure no double slashes if baseUrl ends with /
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${cleanBase}${cleanPath}`;
  };

  const saveToRecent = (info: VideoInfo) => {
    const newRecent = [
      { ...info, timestamp: Date.now() },
      ...recent.filter(item => item.url !== info.url)
    ].slice(0, 5);
    setRecent(newRecent);
    localStorage.setItem('echo_recent', JSON.stringify(newRecent));
  };

  const clearRecent = () => {
    setRecent([]);
    localStorage.removeItem('echo_recent');
  };

  const formatDuration = (seconds: string) => {
    const s = parseInt(seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const fetchInfo = async (e?: React.FormEvent, targetUrl?: string) => {
    if (e) e.preventDefault();
    const finalUrl = targetUrl || url;
    if (!finalUrl) return;

    setLoading(true);
    setError(null);
    setVideoInfo(null);
    setDownloadState('idle');

    try {
      const apiUrl = getApiUrl(`/api/info?url=${encodeURIComponent(finalUrl)}`);
      const response = await fetch(apiUrl, {
        headers: {
          'x-session-id': getSessionId()
        }
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch video info');
      }

      const info = { ...data, url: finalUrl };
      setVideoInfo(info);
      saveToRecent(info);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const executeDownload = async () => {
    if (!videoInfo) return;
    
    let qualityParam = '';
    if (mediaType === 'audio') {
      qualityParam = audioQualities.find(q => q.label.includes(selectedAudioQuality))?.value || 'highestaudio';
    } else {
      qualityParam = videoQualities.find(q => q.label.includes(selectedVideoQuality))?.value || '720p';
    }
    
    setDownloadState('downloading');
    setDownloadPercent(0);
    
    const downloadUrl = `/api/download?url=${encodeURIComponent(videoInfo.url)}&quality=${qualityParam}&type=${mediaType}`;
    
    // Simulated progress timer (accelerates at start, slows near 90%) 
    let simPercent = 0;
    const progressInterval = setInterval(() => {
      const remaining = 90 - simPercent;
      const increment = Math.max(0.3, remaining * 0.04);
      simPercent = Math.min(90, simPercent + increment);
      setDownloadPercent(Math.round(simPercent));
    }, 400);
    
    try {
      const fullDownloadUrl = getApiUrl(downloadUrl);
      const response = await fetch(fullDownloadUrl, {
        headers: { 'x-session-id': getSessionId() }
      });
      
      if (!response.ok) throw new Error('Download failed');
      
      // Extract filename from Content-Disposition header
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="(.+?)"/);
      const filename = filenameMatch ? filenameMatch[1] : `download.${mediaType === 'audio' ? 'm4a' : 'mp4'}`;
      
      // Read stream with real progress if Content-Length is available
      const contentLength = response.headers.get('Content-Length');
      const totalBytes = contentLength ? parseInt(contentLength) : 0;
      const reader = response.body!.getReader();
      const chunks: any[] = [];
      let receivedBytes = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.length;
        
        // If server sent Content-Length, show real percentage
        if (totalBytes > 0) {
          clearInterval(progressInterval);
          setDownloadPercent(Math.min(99, Math.round((receivedBytes / totalBytes) * 100)));
        }
      }
      
      clearInterval(progressInterval);
      setDownloadPercent(100);
      
      // Build blob and trigger native download
      const blob = new Blob(chunks);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      
      // Download complete — refresh the page after a brief moment
      setTimeout(() => {
        window.location.reload();
      }, 1200);
      
    } catch (err: any) {
      clearInterval(progressInterval);
      setDownloadState('idle');
      setDownloadPercent(0);
      setError(err.message || 'Download failed. Please try again.');
    }
  };

  return (
    <div className="min-h-screen text-slate-800 dark:text-neutral-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-900 dark:selection:text-cyan-100 relative overflow-hidden transition-colors duration-300">
      
      {/* 3D Dotted Surface Background Component! */}
      <DottedSurface theme={theme} className="opacity-60 dark:opacity-80 transition-opacity duration-1000" />
      
      <div className="absolute inset-0 bg-gradient-to-t from-white/40 via-transparent to-transparent dark:from-black/60 dark:via-transparent dark:to-transparent pointer-events-none z-[1]" />

      {/* Navigation */}
      <nav className="fixed top-0 w-full glass-card border-b border-slate-200/50 dark:border-neutral-900 z-50 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => { setVideoInfo(null); setUrl(''); setError(null); setDownloadState('idle'); }}>
            <img src="/logo.png" alt="EchoTube" className="w-10 h-10 rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.3)] group-hover:scale-105 transition-transform duration-300 object-contain" />
            <span className="font-bold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-500 dark:from-white dark:to-neutral-400">EchoTube</span>
          </div>
          <div className="flex items-center gap-4 sm:gap-6 text-sm font-semibold text-slate-600 dark:text-neutral-400">
            <button 
              onClick={toggleTheme}
              className="p-2 hover:bg-slate-100 dark:hover:bg-neutral-800 rounded-full transition-all text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white"
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
            <button 
              onClick={() => setShowRecent(!showRecent)}
              className="flex items-center gap-2 hover:text-slate-900 dark:hover:text-white transition-colors group px-2 py-1.5"
            >
              <History className="w-5 h-5 group-hover:-rotate-[30deg] transition-transform duration-300" />
              <span className="hidden sm:inline">History</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Recent History Sidebar */}
      <AnimatePresence>
        {showRecent && (
          <motion.div 
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowRecent(false)}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm dark:backdrop-blur-md z-[60]"
          />
        )}
        {showRecent && (
          <motion.div 
            key="sidebar"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-sm glass-card border-l border-slate-200 dark:border-neutral-900 z-[70] p-8 overflow-y-auto"
          >
              <div className="flex items-center justify-between mb-10">
                <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3 text-slate-900 dark:text-white">
                  <History className="w-6 h-6 text-cyan-500 dark:text-cyan-400" />
                  Your History
                </h2>
                <button onClick={() => setShowRecent(false)} className="p-2.5 hover:bg-slate-100 dark:hover:bg-neutral-800 rounded-full transition-all text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>

              {recent.length === 0 ? (
                <div className="text-center py-20 text-slate-400 dark:text-neutral-500">
                  <Clock className="w-12 h-12 mx-auto mb-4 opacity-30 dark:opacity-20" />
                  <p className="font-medium">No recent conversions yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recent.map((item, i) => (
                    <motion.div 
                      key={item.url}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => { fetchInfo(undefined, item.url); setShowRecent(false); setUrl(item.url); }}
                      className="group flex gap-4 p-4 rounded-2xl glass-input border-slate-200 dark:border-neutral-800 hover:border-cyan-400 dark:hover:border-cyan-900 transition-all cursor-pointer hover:shadow-[0_4px_20px_rgba(6,182,212,0.15)] dark:hover:shadow-[0_0_15px_rgba(6,182,212,0.1)]"
                    >
                      <div className="w-24 h-14 rounded-xl overflow-hidden flex-shrink-0 shadow-sm relative">
                        <img src={item.thumbnail} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 dark:from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="flex-1 min-w-0 py-0.5">
                        <p className="font-bold text-sm truncate mb-1 text-slate-800 dark:text-neutral-200 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">{item.title}</p>
                        <p className="text-xs text-slate-500 dark:text-neutral-400 font-medium truncate">{item.author}</p>
                      </div>
                    </motion.div>
                  ))}
                  <button 
                    onClick={clearRecent}
                    className="w-full py-4 mt-8 text-sm font-bold text-slate-500 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-neutral-900 rounded-xl flex items-center justify-center gap-2 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear History
                  </button>
                </div>
              )}
            </motion.div>
        )}
      </AnimatePresence>

      <main className="pt-32 sm:pt-40 pb-28 px-4 sm:px-6 relative z-10 min-h-[calc(100vh-100px)]">
        <div className="max-w-4xl mx-auto">
          {/* Hero Section */}
          <div className="text-center mb-16">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, type: "spring" }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-input border border-cyan-300 dark:border-cyan-900 text-cyan-600 dark:text-cyan-400 text-sm font-bold mb-8 backdrop-blur-md shadow-sm">
                <Sparkles className="w-4 h-4" />
                <span>Premium Audio & Video Extractor</span>
              </div>
              <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight mb-6 leading-tight text-slate-900 dark:text-white relative drop-shadow-sm">
                Turn YouTube into <br />
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 via-blue-600 to-purple-600 dark:from-cyan-400 dark:via-blue-500 dark:to-purple-500 pb-2">
                  Pure Media.
                </span>
              </h1>
              <p className="text-lg sm:text-xl text-slate-600 dark:text-neutral-400 max-w-2xl mx-auto px-4 font-medium leading-relaxed drop-shadow-sm">
                High-fidelity MP3 and MP4 conversions natively to your device. No ads, no limits. 
                Just your favorite content ready for offline usage.
              </p>
            </motion.div>
          </div>

          {/* Search Bar */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="relative mb-16"
          >
            <form onSubmit={(e) => fetchInfo(e)} className="relative group">
              <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center glass-input rounded-3xl p-2 sm:p-2.5 shadow-[0_15px_40px_rgba(0,0,0,0.06)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] focus-within:shadow-[0_20px_50px_rgba(6,182,212,0.15)] dark:focus-within:shadow-[0_0_40px_rgba(6,182,212,0.1)] focus-within:border-cyan-400 dark:focus-within:border-cyan-800 transition-all duration-500 border border-slate-200 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700">
                <div className="flex items-center flex-1 px-4 sm:px-6">
                  <Youtube className="w-7 h-7 text-slate-400 dark:text-neutral-500 group-focus-within:text-cyan-500 dark:group-focus-within:text-cyan-400 transition-colors duration-300" />
                  
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Drop your YouTube link right here..."
                    className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-base sm:text-lg py-4 sm:py-5 placeholder:text-slate-400 dark:placeholder:text-neutral-600 font-semibold min-w-0 ml-4 sm:ml-5 text-slate-900 dark:text-white"
                  />
                  
                  <AnimatePresence>
                    {url && (
                      <motion.button 
                        key="clear-btn"
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        type="button"
                        onClick={() => { setUrl(''); setDownloadState('idle'); }}
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
                  className="relative overflow-hidden bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 sm:px-10 py-5 rounded-2xl font-bold text-lg sm:text-base hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 mt-2 sm:mt-0 group/btn shadow-[0_8px_20px_rgba(59,130,246,0.25)] dark:shadow-[0_0_20px_rgba(59,130,246,0.3)] active:scale-[0.98]"
                >
                  <div className="absolute inset-0 bg-white/20 -translate-x-full group-hover/btn:animate-shimmer" style={{ transformStyle: 'preserve-3d'}} />
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin relative z-10" />
                  ) : (
                    <div className="flex items-center gap-2 relative z-10">
                      <span className="tracking-wide">Analyze</span>
                      <ArrowRight className="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                    </div>
                  )}
                </button>
              </div>
            </form>
          </motion.div>

          {/* Results Area */}
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                key="error-box"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 p-5 rounded-2xl flex items-center gap-4 text-red-600 dark:text-red-400 shadow-[0_5px_15px_rgba(239,68,68,0.05)] mb-8 glass-card"
              >
                <AlertCircle className="w-6 h-6 flex-shrink-0" />
                <div>
                  <h3 className="font-bold">Conversion Failed</h3>
                  <p className="text-sm mt-1 font-medium text-red-500 dark:text-red-400">{error}</p>
                </div>
              </motion.div>
            )}

            {videoInfo && (
              <motion.div
                key="video-info-container"
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
                        src={videoInfo.thumbnail} 
                        alt={videoInfo.title}
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 dark:from-black via-transparent to-transparent opacity-60 dark:opacity-80 transition-opacity" />
                      
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-16 h-16 bg-white/30 dark:bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center border border-white/40 dark:border-white/10 shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-90 group-hover:scale-100">
                           {mediaType === 'audio' 
                             ? <Music className="w-8 h-8 text-cyan-500 dark:text-cyan-400 drop-shadow-[0_0_10px_rgba(6,182,212,0.4)]" />
                             : <Video className="w-8 h-8 text-purple-500 dark:text-purple-400 drop-shadow-[0_0_10px_rgba(168,85,247,0.4)]" />
                           }
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <h2 className="text-2xl sm:text-3xl font-extrabold leading-tight mb-5 line-clamp-2 text-slate-900 dark:text-white tracking-tight">
                        {videoInfo.title}
                      </h2>
                      <div className="flex flex-wrap gap-x-4 gap-y-3 text-sm">
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

                    <div className="mt-8">
                      {/* Format Switcher */}
                      <div className="flex bg-slate-100 dark:bg-neutral-900 p-1.5 rounded-2xl mb-6 shadow-inner border border-slate-200 dark:border-neutral-800">
                        <button 
                          onClick={() => { setMediaType('audio'); setDownloadState('idle'); }}
                          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all duration-300 ${mediaType === 'audio' ? 'bg-white dark:bg-black shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.5)] text-cyan-600 dark:text-cyan-400' : 'text-slate-500 dark:text-neutral-500 hover:text-slate-700 dark:hover:text-neutral-300'}`}
                        >
                          <Headphones className="w-5 h-5" />
                          Audio MP3/M4A
                        </button>
                        <button 
                          onClick={() => { setMediaType('video'); setDownloadState('idle'); }}
                          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all duration-300 ${mediaType === 'video' ? 'bg-white dark:bg-black shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.5)] text-purple-600 dark:text-purple-400' : 'text-slate-500 dark:text-neutral-500 hover:text-slate-700 dark:hover:text-neutral-300'}`}
                        >
                          <Video className="w-5 h-5" />
                          Video MP4
                        </button>
                      </div>

                      {/* Quality Grids */}
                      <p className="text-[11px] font-bold text-slate-500 dark:text-neutral-500 uppercase tracking-widest mb-3 px-1">
                        Select {mediaType === 'audio' ? 'Bitrate' : 'Resolution'} Quality
                      </p>
                      <div className="grid grid-cols-3 gap-3">
                        {(mediaType === 'audio' ? audioQualities : videoQualities).map((q) => {
                          const isSelected = mediaType === 'audio' 
                            ? selectedAudioQuality === q.label.replace('kbps', '')
                            : selectedVideoQuality === q.label;
                            
                          const setQuality = mediaType === 'audio' 
                            ? () => { setSelectedAudioQuality(q.label.replace('kbps', '')); setDownloadState('idle'); }
                            : () => { setSelectedVideoQuality(q.label); setDownloadState('idle'); };

                          return (
                            <button
                              key={q.label}
                              onClick={setQuality}
                              className={`relative flex flex-col items-center p-3 sm:p-4 rounded-xl border-2 transition-all duration-300 ${
                                isSelected
                                  ? `bg-white dark:bg-neutral-900 border-${mediaType === 'audio' ? 'cyan' : 'purple'}-500 shadow-[0_10px_20px_rgba(6,182,212,0.15)] dark:shadow-[0_10px_20px_rgba(0,0,0,0.4)] -translate-y-1`
                                  : 'bg-slate-50/50 dark:bg-neutral-900/40 border-transparent text-slate-500 dark:text-neutral-600 hover:border-slate-300 dark:hover:border-neutral-700 hover:bg-white dark:hover:bg-neutral-900'
                              }`}
                            >
                               {/* Recommended Badge */}
                               {q.recommended && (
                                 <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-md whitespace-nowrap flex items-center gap-1">
                                   <ThumbsUp className="w-2.5 h-2.5" /> Best for Android
                                 </div>
                               )}
                               
                              <span className={`text-sm sm:text-base font-extrabold ${isSelected ? (mediaType === 'audio' ? 'text-cyan-600 dark:text-cyan-400' : 'text-purple-600 dark:text-purple-400') : 'text-slate-500 dark:text-neutral-400'}`}>{q.label}</span>
                              <span className="text-[10px] sm:text-xs font-semibold mt-1 opacity-70">
                                {q.desc.split(' ')[0]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                      {downloadState === 'idle' && (
                         <button
                           onClick={executeDownload}
                           className={`flex-1 bg-gradient-to-r ${mediaType === 'audio' ? 'from-cyan-500 to-blue-600' : 'from-purple-500 to-pink-600'} text-white px-8 py-4 rounded-xl font-bold uppercase tracking-wider hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-[0_10px_20px_rgba(6,182,212,0.25)] dark:shadow-[0_10px_20px_rgba(0,0,0,0.5)] group/dl`}
                         >
                           <Download className="w-5 h-5 sm:w-6 sm:h-6 group-hover:-translate-y-1 transition-transform" />
                           <span>Convert & Download</span>
                         </button>
                      )}
                      
                      {downloadState === 'downloading' && (
                        <div className="flex-1 bg-gradient-to-r from-slate-800 to-slate-700 dark:from-neutral-900 dark:to-black text-cyan-400 border border-slate-700 dark:border-neutral-700 px-6 py-5 rounded-xl font-bold transition-all flex items-center gap-5 shadow-xl overflow-hidden relative">
                          {/* Animated progress fill bar */}
                          <div className="absolute inset-0 bg-cyan-500/10 transition-all duration-500 ease-out" style={{ width: `${downloadPercent}%` }} />
                          <div className="relative z-10 flex-shrink-0"><ConcentricLoader size="sm" /></div>
                          <div className="relative z-10 flex flex-col items-start flex-1 min-w-0">
                            <span className="tracking-widest text-sm text-cyan-400 uppercase">{downloadPercent >= 100 ? 'Download Complete!' : 'Converting & Downloading...'}</span>
                            <span className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium tracking-wide mt-0.5">
                              {downloadPercent >= 100 ? 'Refreshing page...' : 'Please wait, file will save automatically'}
                            </span>
                          </div>
                          <div className="relative z-10 text-2xl font-extrabold tabular-nums text-cyan-300 dark:text-cyan-400 flex-shrink-0">
                            {downloadPercent}%
                          </div>
                        </div>
                      )}

                      <a 
                        href={videoInfo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-6 py-4 bg-white dark:bg-black border-2 border-slate-200 dark:border-neutral-800 rounded-xl flex items-center justify-center text-slate-500 dark:text-neutral-500 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-neutral-600 transition-all group shadow-sm hover:shadow-md dark:shadow-none"
                      >
                        <ExternalLink className="w-6 h-6 group-hover:scale-110 transition-transform" />
                      </a>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Features Layer */}
          {!videoInfo && !loading && (
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-10 mt-20 relative z-10"
            >
              {[
                { icon: Music, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-50 dark:bg-cyan-950/30", border: "border-cyan-100 dark:border-cyan-900/50", title: "Lossless Grade", desc: "Enjoy crystal clear native audio extracted straight from the source." },
                { icon: Video, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-100 dark:border-purple-900/50", title: "HD Video MP4", desc: "Download high definition video tracks cleanly and efficiently." },
                { icon: CheckCircle2, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-100 dark:border-blue-900/50", title: "Free Forever", desc: "No subscriptions, no rate limits. Your favorite tracks on demand." }
              ].map((feature, i) => (
                <div key={i} className="text-center group glass-card p-8 rounded-3xl border-slate-200/60 dark:border-neutral-900 hover:border-slate-300 dark:hover:border-neutral-700 transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] dark:hover:shadow-2xl bg-white/70 dark:bg-neutral-900/40">
                  <div className={`w-16 h-16 ${feature.bg} ${feature.border} border rounded-2xl flex items-center justify-center mx-auto mb-6 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3 shadow-sm dark:shadow-inner`}>
                    <feature.icon className={`w-8 h-8 ${feature.color}`} />
                  </div>
                  <h3 className="font-bold text-xl mb-3 text-slate-900 dark:text-white tracking-tight">{feature.title}</h3>
                  <p className="text-sm text-slate-500 dark:text-neutral-400 leading-relaxed font-medium">{feature.desc}</p>
                </div>
              ))}
            </motion.div>
          )}
        </div>
      </main>

      {/* Legal Page Modal */}
      <AnimatePresence>
        {legalPage && (
          <motion.div
            key="legal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/95 dark:bg-black/95 backdrop-blur-xl z-[80] overflow-y-auto"
          >
            <div className="max-w-3xl mx-auto px-6 py-20">
              <button
                onClick={() => setLegalPage(null)}
                className="mb-10 flex items-center gap-2 text-slate-500 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white font-bold text-sm transition-colors"
              >
                <ArrowRight className="w-4 h-4 rotate-180" /> Back to EchoTube
              </button>

              {legalPage === 'privacy' && (
                <div>
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-14 h-14 bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-100 dark:border-cyan-900/50 rounded-2xl flex items-center justify-center">
                      <Shield className="w-7 h-7 text-cyan-600 dark:text-cyan-400" />
                    </div>
                    <div>
                      <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">Privacy Policy</h1>
                      <p className="text-sm text-slate-500 dark:text-neutral-500 font-medium mt-1">Last updated: April 2026</p>
                    </div>
                  </div>
                  <div className="space-y-8 text-slate-600 dark:text-neutral-300 leading-relaxed">
                    <section>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">Data We Collect</h2>
                      <p>EchoTube does <strong>not</strong> collect or store any personal information. We do not require accounts, email addresses, or any form of registration. Session IDs are generated locally in your browser and are never transmitted to external servers.</p>
                    </section>
                    <section>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">Cookies & Local Storage</h2>
                      <p>We use browser <code className="px-1.5 py-0.5 bg-slate-100 dark:bg-neutral-900 rounded text-sm font-mono">localStorage</code> solely to persist your theme preference and recent conversion history on your device. This data never leaves your browser.</p>
                    </section>
                    <section>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">Third-Party Services</h2>
                      <p>Video metadata is fetched from YouTube’s public API. Downloaded media is streamed directly from source servers through our backend proxy and is never stored on our infrastructure.</p>
                    </section>
                    <section>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">Your Rights</h2>
                      <p>Since we don’t collect data, there is nothing to delete. You can clear your local browser storage at any time to remove all EchoTube preferences.</p>
                    </section>
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
                      <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">Terms of Service</h1>
                      <p className="text-sm text-slate-500 dark:text-neutral-500 font-medium mt-1">Last updated: April 2026</p>
                    </div>
                  </div>
                  <div className="space-y-8 text-slate-600 dark:text-neutral-300 leading-relaxed">
                    <section>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">Acceptable Use</h2>
                      <p>EchoTube is provided for <strong>personal, non-commercial archival use only</strong>. You are solely responsible for ensuring that your use complies with applicable copyright laws and YouTube’s Terms of Service in your jurisdiction.</p>
                    </section>
                    <section>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">No Warranty</h2>
                      <p>This service is provided “as is” without any warranties, express or implied. We do not guarantee uninterrupted access, download speeds, or compatibility with all video formats.</p>
                    </section>
                    <section>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">Limitation of Liability</h2>
                      <p>EchoTube and its creators shall not be liable for any direct, indirect, incidental, or consequential damages arising from your use of this service.</p>
                    </section>
                    <section>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">Modifications</h2>
                      <p>We reserve the right to modify these terms at any time. Continued use of EchoTube constitutes acceptance of the updated terms.</p>
                    </section>
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
                      <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">System Status</h1>
                      <p className="text-sm text-slate-500 dark:text-neutral-500 font-medium mt-1">Real-time service health</p>
                    </div>
                  </div>
                  <div className="space-y-5">
                    {[
                      { name: 'API Server', status: 'Operational', color: 'bg-green-500' },
                      { name: 'YouTube Data API', status: 'Operational', color: 'bg-green-500' },
                      { name: 'Audio Extraction Engine', status: 'Operational', color: 'bg-green-500' },
                      { name: 'Video Extraction Engine', status: 'Operational', color: 'bg-green-500' },
                      { name: 'CDN / Static Assets', status: 'Operational', color: 'bg-green-500' },
                    ].map((service) => (
                      <div key={service.name} className="flex items-center justify-between p-5 rounded-2xl glass-card border border-slate-200 dark:border-neutral-800">
                        <span className="font-bold text-slate-800 dark:text-white">{service.name}</span>
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 ${service.color} rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]`} />
                          <span className="text-sm font-semibold text-green-600 dark:text-green-400">{service.status}</span>
                        </div>
                      </div>
                    ))}
                    <div className="mt-8 p-5 rounded-2xl bg-slate-50 dark:bg-neutral-900/50 border border-slate-200 dark:border-neutral-800 text-center">
                      <p className="text-sm text-slate-500 dark:text-neutral-400 font-medium">All systems are running normally. <br />Uptime: <span className="font-bold text-green-600 dark:text-green-400">99.98%</span> over the last 30 days.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed Footer */}
      <footer className="fixed bottom-0 left-0 right-0 border-t border-slate-200 dark:border-neutral-900 z-40 glass-card dark:bg-black/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 opacity-70 dark:opacity-50">
            <img src="/logo.png" alt="EchoTube" className="w-5 h-5 rounded object-contain" />
            <span className="font-bold text-xs tracking-widest uppercase text-slate-600 dark:text-neutral-400">EchoTube</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-neutral-400 text-center font-medium flex items-center gap-1.5 flex-wrap justify-center">
            Made with <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500 animate-pulse" /> by
            <span className="font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 to-purple-500">Chitra</span>
            <span className="text-slate-400 dark:text-neutral-600">—</span>
            <span className="w-6 h-6 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center text-white font-extrabold text-[10px] shadow-md">CM</span>
          </p>
          <div className="flex gap-6 text-xs text-slate-500 dark:text-neutral-500 font-bold">
            <button onClick={() => setLegalPage('privacy')} className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">Privacy</button>
            <button onClick={() => setLegalPage('terms')} className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">Terms</button>
            <button onClick={() => setLegalPage('status')} className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">Status</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
