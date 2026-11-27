using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public struct ChordResult {
  public bool Suppress;
  public bool Open;
  public ChordResult(bool suppress, bool open) { Suppress = suppress; Open = open; }
}

// Only the two chord keys are retained; no typed characters are collected.
public sealed class SpaceEnterChord {
  private bool space;
  private bool enter;
  private bool chord;
  public ChordResult Handle(int key, bool down, bool injected, bool modified) {
    if (injected || (key != 0x20 && key != 0x0D)) return new ChordResult(false, false);
    bool suppress = false;
    if (key == 0x20) {
      suppress = down && space && chord;
      space = down;
    } else {
      if (down && !enter && space && !modified) chord = true;
      suppress = chord;
      enter = down;
    }
    // Open after both releases so Enter cannot send immediately, and Space-up reaches the game.
    bool open = chord && !space && !enter;
    if (open) chord = false;
    return new ChordResult(suppress, open);
  }
}

public static class VoiceboardHotkey {
  private const uint WM_OPEN = 0x8001;
  private const uint WM_TIMER = 0x0113;
  private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  private static readonly HookProc callback = Keyboard;
  private static readonly SpaceEnterChord chord = new SpaceEnterChord();
  private static readonly bool[] modifiers = new bool[256];
  private static readonly int[] modifierKeys = { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C };
  private static IntPtr hook;
  private static uint threadId;
  [StructLayout(LayoutKind.Sequential)] private struct KeyData {
    public uint vkCode, scanCode, flags, time;
    public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] private struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] private struct Message {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public Point point;
    public uint lPrivate;
  }
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int type, HookProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr value);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr value, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint first, uint last);
  [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint first, uint last, uint remove);
  [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint interval, IntPtr proc);
  [DllImport("user32.dll")] private static extern bool KillTimer(IntPtr window, UIntPtr id);
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetModuleHandle(string module);

  private static IntPtr Keyboard(int code, IntPtr wParam, IntPtr lParam) {
    if (code < 0) return CallNextHookEx(hook, code, wParam, lParam);
    try {
      KeyData data = (KeyData)Marshal.PtrToStructure(lParam, typeof(KeyData));
      int message = wParam.ToInt32();
      bool down = message == 0x0100 || message == 0x0104;
      bool up = message == 0x0101 || message == 0x0105;
      bool injected = (data.flags & 0x10) != 0;
      if (!down && !up) return CallNextHookEx(hook, code, wParam, lParam);
      if (!injected) {
        foreach (int key in modifierKeys) if (data.vkCode == key) modifiers[key] = down;
      }
      bool modified = false;
      foreach (int key in modifierKeys) modified |= modifiers[key];
      ChordResult result = chord.Handle((int)data.vkCode, down, injected, modified);
      // Never do IPC or window work in the low-level callback.
      if (result.Open) PostThreadMessage(threadId, WM_OPEN, UIntPtr.Zero, IntPtr.Zero);
      if (result.Suppress) return new IntPtr(1);
    } catch { }
    return CallNextHookEx(hook, code, wParam, lParam);
  }

  public static void Run(int parentId) {
    using (Process parent = Process.GetProcessById(parentId)) {
      if (parent.HasExited) return;
      threadId = GetCurrentThreadId();
      Message message;
      PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
      foreach (int key in modifierKeys) modifiers[key] = (GetAsyncKeyState(key) & 0x8000) != 0;
      UIntPtr timer = SetTimer(IntPtr.Zero, UIntPtr.Zero, 1000, IntPtr.Zero);
      if (timer == UIntPtr.Zero) throw new InvalidOperationException("Hotkey watchdog could not start.");
      try {
        hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        Console.WriteLine("READY");
        Console.Out.Flush();
        int received;
        while ((received = GetMessage(out message, IntPtr.Zero, 0, 0)) > 0) {
          if (message.message == WM_TIMER && parent.HasExited) break;
          if (message.message == WM_OPEN && !parent.HasExited) {
            Console.WriteLine("OPEN");
            Console.Out.Flush();
          }
        }
        if (received < 0) throw new InvalidOperationException("Hotkey message loop failed.");
      } finally {
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        KillTimer(IntPtr.Zero, timer);
      }
    }
  }
}
