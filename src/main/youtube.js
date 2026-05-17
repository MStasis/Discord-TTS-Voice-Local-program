const fs = require("node:fs");
const fsp = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");
const ffmpegStaticPath = require("ffmpeg-static");

const execFileAsync = promisify(execFile);
const YT_DLP_DOWNLOAD_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const YOUTUBE_CACHE_LIMIT = 20;

function isSupportedYoutubeUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    return (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host === "music.youtube.com" ||
      host.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

async function downloadFile(url, destination, redirects = 5) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });

  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "Voiceboard"
        }
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location && redirects > 0) {
          response.resume();
          const nextUrl = new URL(location, url).toString();
          downloadFile(nextUrl, destination, redirects - 1).then(resolve, reject);
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`yt-dlp 다운로드 실패: HTTP ${statusCode}`));
          return;
        }

        const output = fs.createWriteStream(destination);
        pipeline(response, output).then(resolve, reject);
      }
    );

    request.on("error", reject);
    request.setTimeout(60000, () => {
      request.destroy(new Error("yt-dlp 다운로드 시간이 초과되었습니다."));
    });
  });
}

async function ensureYtDlpBinary(binDir) {
  const binaryPath = path.join(binDir, "yt-dlp.exe");
  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  const tempPath = `${binaryPath}.download`;
  await fsp.rm(tempPath, { force: true }).catch(() => {});
  await downloadFile(YT_DLP_DOWNLOAD_URL, tempPath);
  await fsp.rename(tempPath, binaryPath);
  return binaryPath;
}

function parseYtDlpOutput(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const filePath = lines[lines.length - 1] || "";
  const title = lines.length > 1 ? lines[0] : path.parse(filePath).name;

  return { title, filePath };
}

function resolveFfmpegPath() {
  if (!ffmpegStaticPath) {
    throw new Error("ffmpeg 실행 파일을 찾지 못했습니다.");
  }

  const unpackedPath = ffmpegStaticPath.replace("app.asar", "app.asar.unpacked");
  return fs.existsSync(unpackedPath) ? unpackedPath : ffmpegStaticPath;
}

async function resolveYoutubeAudio({ sourceUrl, binDir, outputDir }) {
  const url = typeof sourceUrl === "string" ? sourceUrl.trim() : "";
  if (!isSupportedYoutubeUrl(url)) {
    throw new Error("올바른 YouTube 링크가 아닙니다.");
  }

  await fsp.mkdir(outputDir, { recursive: true });
  const binaryPath = await ensureYtDlpBinary(binDir);
  const ffmpegPath = resolveFfmpegPath();
  const outputTemplate = path.join(outputDir, `${Date.now()}-%(id)s.%(ext)s`);
  const { stdout } = await execFileAsync(
    binaryPath,
    [
      "--no-playlist",
      "--no-warnings",
      "-f",
      "bestaudio/best",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--ffmpeg-location",
      path.dirname(ffmpegPath),
      "-o",
      outputTemplate,
      "--print",
      "before_dl:title",
      "--print",
      "after_move:filepath",
      url
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 4,
      timeout: 180000,
      windowsHide: true
    }
  );

  const result = parseYtDlpOutput(stdout);
  if (!result.filePath || !fs.existsSync(result.filePath)) {
    throw new Error("YouTube 오디오 파일을 만들지 못했습니다.");
  }

  return {
    title: result.title || "YouTube",
    sourceUrl: url,
    filePath: result.filePath
  };
}

async function trimOldYoutubeFiles(outputDir, keep = YOUTUBE_CACHE_LIMIT) {
  try {
    const entries = await fsp.readdir(outputDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(outputDir, entry.name);
          const stat = await fsp.stat(filePath);
          return { filePath, mtimeMs: stat.mtimeMs };
        })
    );

    const oldFiles = files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(keep);
    await Promise.allSettled(oldFiles.map((file) => fsp.unlink(file.filePath)));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Failed to trim old YouTube files:", error);
    }
  }
}

module.exports = {
  ensureYtDlpBinary,
  isSupportedYoutubeUrl,
  parseYtDlpOutput,
  resolveFfmpegPath,
  resolveYoutubeAudio,
  trimOldYoutubeFiles
};
