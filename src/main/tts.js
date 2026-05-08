const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { WebSocket } = require("ws");
const { toEdgePercent, toEdgePitch } = require("../shared/library.cjs");

const execFileAsync = promisify(execFile);
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const WEBSOCKET_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const EDGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 ` +
  `Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`;

function requestId() {
  return crypto.randomUUID().replaceAll("-", "");
}

function generateMuid() {
  return crypto.randomBytes(16).toString("hex").toUpperCase();
}

function generateSecMsGec() {
  const windowsEpochOffsetSeconds = 11644473600n;
  const seconds = BigInt(Math.floor(Date.now() / 1000));
  const roundedSeconds = seconds - (seconds % 300n);
  const windowsFileTimeTicks = (roundedSeconds + windowsEpochOffsetSeconds) * 10000000n;
  const valueToHash = `${windowsFileTimeTicks}${TRUSTED_CLIENT_TOKEN}`;

  return crypto.createHash("sha256").update(valueToHash, "ascii").digest("hex").toUpperCase();
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function localeFromVoice(voice) {
  const match = String(voice || "").match(/^([a-z]{2}-[A-Z]{2})-/);
  return match ? match[1] : "ko-KR";
}

function edgeDateString() {
  const date = new Date();
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (value) => String(value).padStart(2, "0");

  return (
    `${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${pad(date.getUTCDate())} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

function parseHeaders(headerBuffer) {
  const headers = new Map();
  const lines = headerBuffer.toString("utf8").split("\r\n");

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    headers.set(line.slice(0, separatorIndex).toLowerCase(), line.slice(separatorIndex + 1));
  }

  return headers;
}

function parseBinaryMessage(data) {
  if (data.length < 2) {
    throw new Error("Received malformed TTS audio frame.");
  }

  const headerLength = data.readUInt16BE(0);
  if (headerLength > data.length - 2) {
    throw new Error("Received TTS frame with invalid header length.");
  }

  const headers = parseHeaders(data.subarray(2, 2 + headerLength));
  const payload = data.subarray(2 + headerLength);
  return { headers, payload };
}

function createSpeechConfigMessage() {
  return [
    `X-Timestamp:${edgeDateString()}`,
    "Content-Type:application/json; charset=utf-8",
    "Path:speech.config",
    "",
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false",' +
      '"wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  ].join("\r\n");
}

function createSsmlMessage(text, settings) {
  const voice = settings.voice || "ko-KR-SunHiNeural";
  const lang = localeFromVoice(voice);
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${escapeXml(voice)}'>` +
    `<prosody pitch='${toEdgePitch(settings.pitch)}' rate='${toEdgePercent(settings.rate)}' ` +
    `volume='${toEdgePercent(settings.ttsVolume)}'>${escapeXml(text)}</prosody>` +
    "</voice></speak>";

  return [
    `X-RequestId:${requestId()}`,
    "Content-Type:application/ssml+xml",
    `X-Timestamp:${edgeDateString()}Z`,
    "Path:ssml",
    "",
    ssml
  ].join("\r\n");
}

function synthesizeMp3Buffer(text, settings) {
  return new Promise((resolve, reject) => {
    const connectionUrl =
      `${WEBSOCKET_URL}&ConnectionId=${requestId()}` +
      `&Sec-MS-GEC=${generateSecMsGec()}` +
      `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const websocket = new WebSocket(connectionUrl, {
      host: "speech.platform.bing.com",
      origin: EDGE_ORIGIN,
      perMessageDeflate: { clientMaxWindowBits: true },
      headers: {
        "User-Agent": EDGE_USER_AGENT,
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Cookie: `muid=${generateMuid()};`,
        Origin: EDGE_ORIGIN,
        Pragma: "no-cache",
        "Sec-WebSocket-Version": "13"
      }
    });

    const timeout = setTimeout(() => {
      websocket.close();
      reject(new Error("TTS request timed out."));
    }, 30000);

    const audioData = [];
    let settled = false;

    function settle(error, buffer) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      websocket.close();

      if (error) {
        reject(error);
        return;
      }

      resolve(buffer);
    }

    websocket.on("open", () => {
      websocket.send(createSpeechConfigMessage(), { compress: true }, (configError) => {
        if (configError) {
          settle(configError);
          return;
        }

        websocket.send(createSsmlMessage(text, settings), { compress: true }, (ssmlError) => {
          if (ssmlError) {
            settle(ssmlError);
          }
        });
      });
    });

    websocket.on("message", (rawData, isBinary) => {
      if (!isBinary) {
        const message = rawData.toString("utf8");
        const headerEnd = message.indexOf("\r\n\r\n");
        const headers = parseHeaders(Buffer.from(headerEnd === -1 ? message : message.slice(0, headerEnd)));
        const messagePath = headers.get("path");

        if (messagePath === "turn.end" || message.includes("turn.end")) {
          const buffer = Buffer.concat(audioData);
          if (buffer.length === 0) {
            settle(new Error("TTS returned no audio data."));
          } else {
            settle(null, buffer);
          }
        }
        return;
      }

      const data = Buffer.from(rawData);
      const parsed = parseBinaryMessage(data);
      if (parsed.headers.get("path") !== "audio") {
        return;
      }

      const contentType = parsed.headers.get("content-type");
      if (!contentType && parsed.payload.length === 0) {
        return;
      }

      if (contentType !== "audio/mpeg" || parsed.payload.length === 0) {
        settle(new Error("Received unexpected TTS audio frame."));
        return;
      }

      audioData.push(parsed.payload);
    });

    websocket.on("error", (error) => settle(error));
    websocket.on("close", () => {
      if (!settled && audioData.length === 0) {
        settle(new Error("TTS connection closed before audio arrived."));
      }
    });
  });
}

async function synthesizeWithEdgeTts({ text, settings, outputDir }) {
  const normalizedText = typeof text === "string" ? text.trim() : "";
  if (!normalizedText) {
    throw new Error("TTS text is empty.");
  }

  await fs.mkdir(outputDir, { recursive: true });

  const audioBuffer = await synthesizeMp3Buffer(normalizedText, settings);

  const fileName = `tts-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`;
  const filePath = path.join(outputDir, fileName);
  await fs.writeFile(filePath, audioBuffer);
  return filePath;
}

async function synthesizeWithWindowsSapi({ text, settings, outputDir }) {
  if (process.platform !== "win32") {
    throw new Error("Windows SAPI TTS is only available on Windows.");
  }

  const normalizedText = typeof text === "string" ? text.trim() : "";
  if (!normalizedText) {
    throw new Error("TTS text is empty.");
  }

  await fs.mkdir(outputDir, { recursive: true });

  const fileName = `tts-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`;
  const filePath = path.join(outputDir, fileName);
  const sapiRate = Math.min(10, Math.max(-10, Math.round(Number(settings.rate || 0) / 10)));
  const sapiVolume = Math.min(100, Math.max(0, Math.round(100 + Number(settings.ttsVolume || 0))));
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Speech",
    "$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()",
    "try {",
    "  $voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Gender -eq [System.Speech.Synthesis.VoiceGender]::Female }",
    "  $selected = $voices | Select-Object -First 1",
    "  if ($selected) { $synth.SelectVoice($selected.VoiceInfo.Name) }",
    "  $synth.Rate = [int]$env:VOICEBOARD_SAPI_RATE",
    "  $synth.Volume = [int]$env:VOICEBOARD_SAPI_VOLUME",
    "  $synth.SetOutputToWaveFile($env:VOICEBOARD_TTS_OUTPUT)",
    "  $synth.Speak($env:VOICEBOARD_TTS_TEXT) | Out-Null",
    "} finally {",
    "  $synth.Dispose()",
    "}"
  ].join("\n");

  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      env: {
        ...process.env,
        VOICEBOARD_SAPI_RATE: String(sapiRate),
        VOICEBOARD_SAPI_VOLUME: String(sapiVolume),
        VOICEBOARD_TTS_OUTPUT: filePath,
        VOICEBOARD_TTS_TEXT: normalizedText
      },
      maxBuffer: 1024 * 1024,
      timeout: 30000,
      windowsHide: true
    }
  );

  return filePath;
}

async function synthesizeTts({ text, settings, outputDir }) {
  if (settings.ttsEngine === "windows") {
    return {
      engine: "windows",
      filePath: await synthesizeWithWindowsSapi({ text, settings, outputDir })
    };
  }

  try {
    return {
      engine: "edge",
      filePath: await synthesizeWithEdgeTts({ text, settings, outputDir })
    };
  } catch (error) {
    if (process.platform !== "win32") {
      throw error;
    }

    console.warn("Edge Neural TTS failed, falling back to Windows SAPI:", error);
    return {
      engine: "windows-fallback",
      filePath: await synthesizeWithWindowsSapi({ text, settings, outputDir })
    };
  }
}

async function trimOldTtsFiles(outputDir, keep = 50) {
  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && (entry.name.endsWith(".mp3") || entry.name.endsWith(".wav")))
        .map(async (entry) => {
          const filePath = path.join(outputDir, entry.name);
          const stat = await fs.stat(filePath);
          return { filePath, mtimeMs: stat.mtimeMs };
        })
    );

    const oldFiles = files
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(keep);

    await Promise.allSettled(oldFiles.map((file) => fs.unlink(file.filePath)));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Failed to trim old TTS files:", error);
    }
  }
}

module.exports = {
  createSsmlMessage,
  generateSecMsGec,
  synthesizeMp3Buffer,
  synthesizeTts,
  synthesizeWithEdgeTts,
  synthesizeWithWindowsSapi,
  trimOldTtsFiles
};
