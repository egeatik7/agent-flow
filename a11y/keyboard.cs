using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Kept separate so the very same policy can be tested with a deterministic backend.
public interface IXpKeyboardPlatform {
  bool DesktopAvailable();
  int[] Down();
  int Release(int[] keys);
  void Wait(int ms);
}

public sealed class XpKeyboardSafety {
  readonly IXpKeyboardPlatform platform;
  public string Repaired { get; private set; }
  public XpKeyboardSafety(IXpKeyboardPlatform platform) { this.platform = platform; Repaired = ""; }
  void Desktop() {
    if (!platform.DesktopAvailable()) throw new InvalidOperationException("INPUT_DESKTOP_UNAVAILABLE: Keyboard state cannot be checked on this desktop");
  }
  public void Before() {
    Repaired = "";
    Desktop();
    // Let an ordinary key-up (including a remote key-up) arrive before repairing a residue.
    for (int i = 0; i < 6 && platform.Down().Length > 0; i++) platform.Wait(25);
    Repair();
  }
  public void After() { Desktop(); Repair(); }
  void Repair() {
    var repaired = new HashSet<int>();
    for (int attempt = 0; attempt < 3; attempt++) {
      Desktop();
      int[] down = platform.Down();
      if (down.Length == 0) { Repaired = string.Join(",", repaired); return; }
      foreach (int key in down) repaired.Add(key);
      int sent = platform.Release(down);
      // SendInput's accepted count is evidence of insertion, not an application acknowledgement.
      if (sent < 0 || sent > down.Length) throw new InvalidOperationException("KEY_RELEASE_FAILED: Invalid native input count");
      for (int i = 0; i < 5; i++) {
        platform.Wait(10);
        Desktop();
        if (platform.Down().Length == 0) { Repaired = string.Join(",", repaired); return; }
      }
    }
    throw new InvalidOperationException("INPUT_MODIFIERS_HELD: Ctrl/Alt/Shift/Win could not be released; next input is blocked");
  }
}

public sealed class XpKeyboardNative : IXpKeyboardPlatform {
  // Individual sides matter: generic VK_CONTROL alone cannot diagnose a right Ctrl residue.
  static readonly int[] Modifiers = { 0xA2, 0xA3, 0xA4, 0xA5, 0xA0, 0xA1, 0x5B, 0x5C };
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder value, uint size, out uint needed);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] input, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int x, y; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public KEYBDINPUT keyboard; [FieldOffset(0)] public MOUSEINPUT mouse; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
  static string DesktopName(IntPtr handle) {
    var text = new StringBuilder(256); uint needed;
    return handle != IntPtr.Zero && GetUserObjectInformation(handle, 2, text, 512, out needed) ? text.ToString() : null;
  }
  public bool DesktopAvailable() {
    var input = OpenInputDesktop(0, false, 1);
    if (input == IntPtr.Zero) return false;
    try {
      string current = DesktopName(GetThreadDesktop(GetCurrentThreadId()));
      string active = DesktopName(input);
      return current != null && active != null && current == active;
    } finally { CloseDesktop(input); }
  }
  public int[] Down() {
    var down = new List<int>();
    foreach (int key in Modifiers) if ((GetAsyncKeyState(key) & 0x8000) != 0) down.Add(key);
    return down.ToArray();
  }
  public int Release(int[] keys) {
    var input = new INPUT[keys.Length];
    for (int i = 0; i < keys.Length; i++) {
      input[i].type = 1;
      input[i].data.keyboard.vk = (ushort)keys[i];
      input[i].data.keyboard.flags = 2u | (keys[i] == 0xA3 || keys[i] == 0xA5 || keys[i] == 0x5B || keys[i] == 0x5C ? 1u : 0u);
    }
    return input.Length == 0 ? 0 : (int)SendInput((uint)input.Length, input, Marshal.SizeOf(typeof(INPUT)));
  }
  public void Wait(int ms) { Thread.Sleep(ms); }
  public static string Context() {
    uint pid; IntPtr window = GetForegroundWindow();
    uint thread = GetWindowThreadProcessId(window, out pid);
    return "hwnd=" + window.ToInt64() + " pid=" + pid + " layout=" + GetKeyboardLayout(0).ToInt64().ToString("X") + " target-layout=" + GetKeyboardLayout(thread).ToInt64().ToString("X");
  }
}

public static class XpKeyboardGuard {
  static readonly XpKeyboardNative native = new XpKeyboardNative();
  static readonly XpKeyboardSafety safety = new XpKeyboardSafety(native);
  public static void Before() { safety.Before(); }
  public static void After() { safety.After(); }
  public static string Repaired { get { return safety.Repaired; } }
  public static int[] Down() { return native.Down(); }
  public static bool Available() { return native.DesktopAvailable(); }
}
