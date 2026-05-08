const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const ROLE_KEYS = ["console", "multimedia", "communications"];

const WINDOWS_AUDIO_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace VoiceboardAudio {
  public enum EDataFlow {
    eRender = 0,
    eCapture = 1,
    eAll = 2
  }

  public enum ERole {
    eConsole = 0,
    eMultimedia = 1,
    eCommunications = 2
  }

  [Flags]
  public enum DeviceState {
    Active = 0x00000001,
    Disabled = 0x00000002,
    NotPresent = 0x00000004,
    Unplugged = 0x00000008,
    All = 0x0000000F
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PropertyKey {
    public Guid fmtid;
    public int pid;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PropVariant {
    public ushort vt;
    public ushort wReserved1;
    public ushort wReserved2;
    public ushort wReserved3;
    public IntPtr p;
    public int p2;

    public string StringValue {
      get {
        if (vt == 31 && p != IntPtr.Zero) {
          return Marshal.PtrToStringUni(p);
        }
        return "";
      }
    }
  }

  [ComImport]
  [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  internal class MMDeviceEnumeratorComObject {
  }

  [ComImport]
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDeviceEnumerator {
    [PreserveSig]
    int EnumAudioEndpoints(EDataFlow dataFlow, DeviceState dwStateMask, out IMMDeviceCollection ppDevices);
    [PreserveSig]
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
    [PreserveSig]
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
    [PreserveSig]
    int RegisterEndpointNotificationCallback(IntPtr pClient);
    [PreserveSig]
    int UnregisterEndpointNotificationCallback(IntPtr pClient);
  }

  [ComImport]
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDeviceCollection {
    [PreserveSig]
    int GetCount(out uint pcDevices);
    [PreserveSig]
    int Item(uint nDevice, out IMMDevice ppDevice);
  }

  [ComImport]
  [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDevice {
    [PreserveSig]
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IntPtr ppInterface);
    [PreserveSig]
    int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
    [PreserveSig]
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    [PreserveSig]
    int GetState(out DeviceState pdwState);
  }

  [ComImport]
  [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPropertyStore {
    [PreserveSig]
    int GetCount(out uint cProps);
    [PreserveSig]
    int GetAt(uint iProp, out PropertyKey pkey);
    [PreserveSig]
    int GetValue(ref PropertyKey key, out PropVariant pv);
    [PreserveSig]
    int SetValue(ref PropertyKey key, ref PropVariant propvar);
    [PreserveSig]
    int Commit();
  }

  [ComImport]
  [Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
  internal class PolicyConfigClient {
  }

  [ComImport]
  [Guid("F8679F50-850A-41CF-9C72-430F290290C8")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPolicyConfig {
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr ppFormat);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr ppFormat);
    [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pEndpointFormat, IntPtr mixFormat);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr pmftDefaultPeriod, IntPtr pmftMinimumPeriod);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pmftPeriod);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr mode);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ref PropertyKey key, out PropVariant pv);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ref PropertyKey key, ref PropVariant pv);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string wszDeviceId, ERole role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bVisible);
  }

  public class EndpointInfo {
    public string id { get; set; }
    public string name { get; set; }
    public string state { get; set; }
  }

  public static class AudioDeviceTool {
    static PropertyKey PKEY_Device_FriendlyName = new PropertyKey {
      fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),
      pid = 14
    };

    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PropVariant pvar);

    static IMMDeviceEnumerator Enumerator() {
      return (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    }

    static string DeviceName(IMMDevice device) {
      IPropertyStore store;
      int hr = device.OpenPropertyStore(0, out store);
      if (hr != 0 || store == null) {
        return "";
      }

      PropVariant value;
      PropertyKey friendlyNameKey = PKEY_Device_FriendlyName;
      hr = store.GetValue(ref friendlyNameKey, out value);
      if (hr != 0) {
        return "";
      }

      string result = value.StringValue;
      PropVariantClear(ref value);
      return result;
    }

    public static List<EndpointInfo> GetCaptureDevices() {
      IMMDeviceCollection collection;
      int hr = Enumerator().EnumAudioEndpoints(EDataFlow.eCapture, DeviceState.Active, out collection);
      if (hr != 0) {
        Marshal.ThrowExceptionForHR(hr);
      }

      uint count;
      collection.GetCount(out count);
      var result = new List<EndpointInfo>();

      for (uint index = 0; index < count; index++) {
        IMMDevice device;
        collection.Item(index, out device);
        string id;
        device.GetId(out id);
        DeviceState state;
        device.GetState(out state);
        result.Add(new EndpointInfo { id = id, name = DeviceName(device), state = state.ToString() });
      }

      return result;
    }

    public static string GetDefaultCaptureId(int role) {
      IMMDevice device;
      int hr = Enumerator().GetDefaultAudioEndpoint(EDataFlow.eCapture, (ERole)role, out device);
      if (hr != 0 || device == null) {
        return "";
      }

      string id;
      device.GetId(out id);
      return id;
    }

    public static void SetDefaultCaptureId(string id, int role) {
      if (String.IsNullOrWhiteSpace(id)) {
        return;
      }

      var policy = (IPolicyConfig)(new PolicyConfigClient());
      int hr = policy.SetDefaultEndpoint(id, (ERole)role);
      if (hr != 0) {
        Marshal.ThrowExceptionForHR(hr);
      }
    }
  }
}
'@

function Get-DefaultMap {
  @{
    console = [VoiceboardAudio.AudioDeviceTool]::GetDefaultCaptureId(0)
    multimedia = [VoiceboardAudio.AudioDeviceTool]::GetDefaultCaptureId(1)
    communications = [VoiceboardAudio.AudioDeviceTool]::GetDefaultCaptureId(2)
  }
}

function Set-DefaultMap($roles) {
  if ($roles.console) {
    [VoiceboardAudio.AudioDeviceTool]::SetDefaultCaptureId([string]$roles.console, 0)
  }
  if ($roles.multimedia) {
    [VoiceboardAudio.AudioDeviceTool]::SetDefaultCaptureId([string]$roles.multimedia, 1)
  }
  if ($roles.communications) {
    [VoiceboardAudio.AudioDeviceTool]::SetDefaultCaptureId([string]$roles.communications, 2)
  }
}

$action = $env:VOICEBOARD_AUDIO_ACTION
if ($action -eq 'set') {
  $roles = $env:VOICEBOARD_AUDIO_ROLES | ConvertFrom-Json
  Set-DefaultMap $roles
}

@{
  ok = $true
  defaults = Get-DefaultMap
  captureDevices = [VoiceboardAudio.AudioDeviceTool]::GetCaptureDevices()
} | ConvertTo-Json -Compress -Depth 5
`;

function hasCaptureBackup(backup = {}) {
  if (!backup || typeof backup !== "object") {
    return false;
  }

  return ROLE_KEYS.some((key) => typeof backup[key] === "string" && backup[key].trim());
}

function findCableCaptureDevice(devices = []) {
  return devices.find((device) => {
    const label = String(device.name || "").toLowerCase();
    return (
      label.includes("cable output") ||
      label.includes("vb-audio virtual cable") ||
      label.includes("vb-cable")
    );
  });
}

async function runAudioScript(action, roles = null) {
  if (process.platform !== "win32") {
    throw new Error("Windows audio routing is only available on Windows.");
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_AUDIO_SCRIPT],
    {
      env: {
        ...process.env,
        VOICEBOARD_AUDIO_ACTION: action,
        VOICEBOARD_AUDIO_ROLES: roles ? JSON.stringify(roles) : ""
      },
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 4,
      timeout: 30000,
      windowsHide: true
    }
  );

  const jsonLine = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith("{"));

  if (!jsonLine) {
    throw new Error("Windows audio tool returned no JSON output.");
  }

  return JSON.parse(jsonLine);
}

async function getCaptureSnapshot() {
  return runAudioScript("snapshot");
}

async function setupCableCaptureDefaults(existingBackup) {
  const snapshot = await getCaptureSnapshot();
  const target = findCableCaptureDevice(snapshot.captureDevices);

  if (!target) {
    throw new Error("VB-CABLE capture device was not found. Expected CABLE Output.");
  }

  const backup = hasCaptureBackup(existingBackup) ? existingBackup : snapshot.defaults;
  const targetRoles = Object.fromEntries(ROLE_KEYS.map((key) => [key, target.id]));
  const after = await runAudioScript("set", targetRoles);

  return {
    target,
    backup,
    defaults: after.defaults
  };
}

async function restoreCaptureDefaults(backup) {
  if (!hasCaptureBackup(backup)) {
    return {
      restored: false,
      defaults: (await getCaptureSnapshot()).defaults
    };
  }

  const after = await runAudioScript("set", backup);
  return {
    restored: true,
    defaults: after.defaults
  };
}

module.exports = {
  findCableCaptureDevice,
  getCaptureSnapshot,
  hasCaptureBackup,
  restoreCaptureDefaults,
  setupCableCaptureDefaults
};
