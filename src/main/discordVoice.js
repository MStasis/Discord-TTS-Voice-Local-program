const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const PROFILES = Object.freeze({
  setup: { noise: "none", echo: false, thresholdDb: -95 },
  release: { noise: "krisp", echo: true, thresholdDb: -55 }
});
let applying = false;

async function applyDiscordVoiceProfile(mode) {
  if (!Object.hasOwn(PROFILES, mode)) throw new Error("Unknown Discord voice profile.");
  if (process.platform !== "win32") {
    return { applied: false, message: "Discord 자동 설정은 Windows에서 지원됩니다" };
  }
  if (applying) return { applied: false, message: "Discord 설정 변경이 이미 진행 중입니다" };
  applying = true;
  try {
    const script = await fs.readFile(path.join(__dirname, "discordVoice.ps1"), "utf8");
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-Command", "& ([scriptblock]::Create($env:VOICEBOARD_DISCORD_SCRIPT))"
    ], {
      env: {
        ...process.env,
        VOICEBOARD_DISCORD_SCRIPT: script,
        VOICEBOARD_DISCORD_PROFILE: JSON.stringify(PROFILES[mode])
      },
      encoding: "utf8", timeout: 45000, maxBuffer: 1024 * 1024, windowsHide: true
    });
    const result = JSON.parse(stdout.trim());
    return result;
  } catch (error) {
    console.warn("Discord voice profile could not be verified:", error.message);
    return { applied: false, message: "Discord 자동 설정 실패 · 음성 설정을 확인하세요" };
  } finally {
    applying = false;
  }
}

module.exports = { applyDiscordVoiceProfile, PROFILES };
