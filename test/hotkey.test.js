const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { SpaceEnterHotkey } = require("../src/main/hotkey");

function fixture(options = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  const calls = [], states = [], presses = [];
  const hotkey = new SpaceEnterHotkey({
    platform: "win32", onState: (ready) => states.push(ready), onTrigger: () => presses.push(true),
    spawnProcess: (...args) => { calls.push(args); return child; }, ...options
  });
  return { hotkey, child, calls, states, presses };
}

test("Space+Enter helper is hidden, waits for READY, and forwards only chord events", async () => {
  const { hotkey, child, calls, presses, states } = fixture();
  const ready = hotkey.start();
  assert.equal(hotkey.start(), ready);
  assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].env.VOICEBOARD_PARENT_PID, String(process.pid));
  child.stdout.write("OPEN\n");
  assert.equal(presses.length, 0);
  child.stdout.write("REA"); child.stdout.write("DY\r\nOPEN\nnoise\n");
  assert.equal(await ready, true);
  assert.equal(presses.length, 1);
  hotkey.dispose();
  child.stdout.write("OPEN\n");
  assert.equal(presses.length, 1);
  assert.equal(child.killed, true);
  assert.deepEqual(states, [true, false]);
});

test("failed, timed out, and exited helpers are stopped without a stuck readiness promise", async () => {
  const failed = fixture();
  const ready = failed.hotkey.start();
  failed.child.emit("error", new Error("blocked"));
  assert.equal(await ready, false);
  const exited = fixture();
  const running = exited.hotkey.start();
  exited.child.stdout.write("READY\n");
  assert.equal(await running, true);
  exited.child.emit("exit", 1);
  assert.equal(exited.hotkey.registered, false);
  const timed = fixture({ timeoutMs: 10 });
  const timeout = timed.hotkey.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(await timeout, false);
  assert.equal(timed.child.killed, true);
});

test("non-Windows and disposed helpers never launch keyboard monitoring", async () => {
  const unsupported = fixture({ platform: "linux" });
  assert.equal(await unsupported.hotkey.start(), false);
  assert.equal(unsupported.calls.length, 0);
  const disposed = fixture();
  disposed.hotkey.dispose();
  assert.equal(await disposed.hotkey.start(), false);
  assert.equal(disposed.calls.length, 0);
});

test("native chord detector passes ordinary keys and suppresses only the shortcut Enter cycle", { skip: process.platform !== "win32" }, () => {
  // Compile the real native helper, but exercise only its pure state machine: never call Run or install a hook.
  const source = fs.readFileSync(path.join(__dirname, "../src/main/spaceEnterHook.cs"), "utf8");
  const checks = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition $env:VOICEBOARD_TEST_SOURCE
function Assert-Result($result, $suppress, $open) {
  if ($result.Suppress -ne $suppress -or $result.Open -ne $open) { throw 'Unexpected chord result' }
}
$c = New-Object SpaceEnterChord
Assert-Result ($c.Handle(32, $true, $false, $false)) $false $false
Assert-Result ($c.Handle(13, $true, $false, $false)) $true $false
Assert-Result ($c.Handle(13, $true, $false, $false)) $true $false
Assert-Result ($c.Handle(32, $true, $false, $false)) $true $false
Assert-Result ($c.Handle(65, $true, $false, $false)) $false $false
Assert-Result ($c.Handle(13, $false, $false, $false)) $true $false
Assert-Result ($c.Handle(32, $false, $false, $false)) $false $true
Assert-Result ($c.Handle(13, $true, $false, $false)) $false $false
Assert-Result ($c.Handle(13, $false, $false, $false)) $false $false
# Reverse release order still emits exactly once.
Assert-Result ($c.Handle(32, $true, $false, $false)) $false $false
Assert-Result ($c.Handle(13, $true, $false, $false)) $true $false
Assert-Result ($c.Handle(32, $false, $false, $false)) $false $false
Assert-Result ($c.Handle(13, $false, $false, $false)) $true $true
# Enter then Space must not activate; modifiers and injected keys must pass through.
Assert-Result ($c.Handle(13, $true, $false, $false)) $false $false
Assert-Result ($c.Handle(32, $true, $false, $false)) $false $false
Assert-Result ($c.Handle(13, $true, $false, $false)) $false $false
Assert-Result ($c.Handle(13, $false, $false, $false)) $false $false
Assert-Result ($c.Handle(13, $true, $false, $true)) $false $false
Assert-Result ($c.Handle(13, $false, $false, $true)) $false $false
Assert-Result ($c.Handle(13, $true, $true, $false)) $false $false
Assert-Result ($c.Handle(13, $false, $true, $false)) $false $false
Assert-Result ($c.Handle(32, $false, $false, $false)) $false $false
Write-Output 'CHORD_TEST_OK_NO_HOOK'
`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "& ([scriptblock]::Create($env:VOICEBOARD_TEST_CHECKS))"], {
    env: { ...process.env, VOICEBOARD_TEST_SOURCE: source, VOICEBOARD_TEST_CHECKS: checks },
    windowsHide: true, encoding: "utf8", timeout: 20000
  });
  assert.match(output, /CHORD_TEST_OK_NO_HOOK/);
});
