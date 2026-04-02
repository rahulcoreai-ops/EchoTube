import youtubedl from "youtube-dl-exec";

const opts = {
  noWarnings: true,
  noCheckCertificates: true,
  preferFreeFormats: true,
  referer: "https://www.youtube.com/",
  extractorArgs: "youtube:player_client=android,web",
  noPlaylist: true,
  noPart: true,
  noCacheDir: true,
  addHeader: [
    '"User-Agent:Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"',
  ],
  format: "bestaudio",
  output: "-",
  concurrentFragments: 4,
};

const subprocess = youtubedl.exec("https://youtu.be/7NsURBp3lMA", opts as any);
subprocess.stderr?.on("data", (d) => process.stdout.write(d));
subprocess.catch((err) => console.log("\nERROR:", err.message));
