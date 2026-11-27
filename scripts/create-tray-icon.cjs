const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

if (process.platform !== "win32") throw new Error("Taskbar icon extraction requires Windows.");
const packaged = path.join(__dirname, "../dist/win-unpacked/Voiceboard.exe");
const electron = require("electron");
const source = fs.existsSync(packaged) ? packaged : typeof electron === "string" ? electron : process.execPath;
const output = path.join(__dirname, "../src/assets/app-icon.png");
fs.mkdirSync(path.dirname(output), { recursive: true });
// Extract the existing executable icon without launching any windows.
execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:VOICEBOARD_ICON_SOURCE)
try {
  $bitmap = $icon.ToBitmap()
  try { $bitmap.Save($env:VOICEBOARD_ICON_OUTPUT, [System.Drawing.Imaging.ImageFormat]::Png) }
  finally { $bitmap.Dispose() }
} finally { $icon.Dispose() }
`], {
  env: { ...process.env, VOICEBOARD_ICON_SOURCE: source, VOICEBOARD_ICON_OUTPUT: output },
  windowsHide: true, timeout: 15000, stdio: "pipe"
});
console.log("APP_ICON_OK " + output);
