const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PROFILES } = require("../src/main/discordVoice");

test("Discord setup and release retain the noise, echo, and sensitivity profiles", () => {
  assert.deepEqual(PROFILES.setup, { noise: "none", echo: false, thresholdDb: -95 });
  assert.deepEqual(PROFILES.release, { noise: "krisp", echo: true, thresholdDb: -55 });
});

test("Discord retry logic waits for delayed updates, retries failures, and requires stable reads", { skip: process.platform !== "win32" }, () => {
  // Only load the pure wait helpers. Never run discordVoice.ps1 or touch a real window.
  const helper = fs.readFileSync(path.join(__dirname, "../src/main/discordWait.ps1"), "utf8");
  const checks = `
$ErrorActionPreference = 'Stop'
$script:deadline = [DateTime]::UtcNow.AddSeconds(30)
$script:readsBeforeApply = 0
$script:quickApplied = $false
Invoke-DiscordSetting -Label 'fast mismatch' -Test {
  if (!$script:quickApplied) { $script:readsBeforeApply++ }
  $script:quickApplied
} -Apply { $script:quickApplied = $true }
if ($script:readsBeforeApply -ne 1) { throw 'Waited idly before applying a known mismatch' }
$script:stableReads = 0
Invoke-DiscordSetting -Label 'already correct' -Test { $script:stableReads++; $true } -Apply { throw 'Changed an already-correct setting' }
if ($script:stableReads -ne 2) { throw 'Already-set value skipped stable confirmation' }
$script:applies = 0
$script:readyAt = [DateTime]::MaxValue
Invoke-DiscordSetting -Label 'delayed' -TimeoutMs 2500 -Test {
  [DateTime]::UtcNow -gt $script:readyAt
} -Apply {
  $script:applies++
  $script:readyAt = [DateTime]::UtcNow.AddMilliseconds(900)
}
if ($script:applies -ne 1) { throw 'Retoggled before the delayed result arrived' }
$script:applies = 0
Invoke-DiscordSetting -Label 'retry' -TimeoutMs 300 -Test { $script:applies -ge 2 } -Apply { $script:applies++ }
if ($script:applies -ne 2) { throw 'Did not retry the missed action' }
$script:applies = 0
$failed = $false
try {
  Invoke-DiscordSetting -Label 'exhausted' -TimeoutMs 30 -Test { $false } -Apply { $script:applies++ }
} catch { $failed = $true }
if (!$failed -or $script:applies -ne 3) { throw 'Lost three-attempt failure protection' }
$script:reads = 0
$stable = Wait-DiscordCondition -TimeoutMs 1200 -IntervalMs 30 -Probe {
  $script:reads++
  if ($script:reads -eq 1) { throw 'Stale UI element' }
  $script:reads -eq 2 -or $script:reads -ge 4
}
if (!$stable -or $script:reads -ne 5) { throw 'Accepted a transient state' }
if (Wait-DiscordCondition -TimeoutMs 50 -IntervalMs 10 -Probe { $false }) { throw 'Missing control accepted' }
$script:deadline = [DateTime]::UtcNow.AddSeconds(-1)
$timedOut = $false
try { Wait-DiscordCondition -Probe { $true } | Out-Null } catch { $timedOut = $true }
if (!$timedOut) { throw 'Overall deadline ignored' }
Write-Output 'DISCORD_WAIT_OK'
`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "& ([scriptblock]::Create($env:VOICEBOARD_WAIT_TEST))"], {
    env: { ...process.env, VOICEBOARD_WAIT_TEST: `${helper}\n${checks}` },
    windowsHide: true, timeout: 20000, encoding: "utf8"
  });
  assert.match(output, /DISCORD_WAIT_OK/);
});
