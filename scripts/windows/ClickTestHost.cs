// A visible, independent oracle. Commands arrange the fixture; only actual UI events
// count as input. Expected control rectangles are never a targeting API for Nubbo.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Add-Type does not emit the target-framework assembly metadata that a normal
// WinForms project supplies. Declare it explicitly alongside the app.config.
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]

public sealed class ClickTestHost : Form {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);

  readonly string dir;
  readonly JavaScriptSerializer json = new JavaScriptSerializer();
  readonly Dictionary<string, Control> controls = new Dictionary<string, Control>();
  readonly List<object> events = new List<object>();
  readonly Timer timer = new Timer();
  readonly Panel canvas = new Panel();
  Form other, cover;
  long commandSeq, eventSeq;
  string error = "";
  Rectangle painted = new Rectangle(48, 28, 230, 64);
  bool showPainted = true;

  ClickTestHost(string directory) {
    dir = directory;
    Directory.CreateDirectory(dir);
    Text = "Nubbo Click Test Host";
    Name = "NubboClickTestHost";
    StartPosition = FormStartPosition.Manual;
    Bounds = new Rectangle(60, 60, 760, 590);
    AutoScaleMode = AutoScaleMode.None;
    Font = new Font("Segoe UI", 12);
    KeyPreview = true;
    AddButton("continue", "Devam", 30, 28);
    AddButton("save-left", "Kaydet", 30, 94);
    AddButton("save-right", "Kaydet", 240, 94);
    var disabled = AddButton("disabled", "Pasif", 450, 94);
    disabled.Enabled = false;
    AddField("source", "Kaynak klasör", 210);
    AddField("search", "Ara", 290);
    canvas.Name = "painted-panel";
    canvas.AccessibleName = "Custom canvas";
    canvas.Bounds = new Rectangle(30, 370, 660, 150);
    canvas.BackColor = Color.FromArgb(45, 45, 45);
    canvas.Paint += delegate(object sender, PaintEventArgs e) {
      if (!showPainted) return;
      e.Graphics.FillRectangle(Brushes.White, painted);
      using (var f = new Font("Arial", 20, FontStyle.Bold))
        e.Graphics.DrawString("RUN REMESH", f, Brushes.Black, painted.X + 12, painted.Y + 17);
    };
    canvas.MouseDown += delegate(object sender, MouseEventArgs e) {
      var p = canvas.PointToScreen(e.Location);
      Record("mouse", showPainted && painted.Contains(e.Location) ? "painted-remesh" : "canvas-background",
        new { x = p.X, y = p.Y, button = e.Button.ToString() });
    };
    Controls.Add(canvas);
    KeyDown += delegate(object sender, KeyEventArgs e) { Record("key", "main", new { key = e.KeyCode.ToString(), modifiers = e.Modifiers.ToString() }); };
    timer.Interval = 100;
    timer.Tick += delegate { Tick(); };
    Shown += delegate { timer.Start(); Tick(); };
    FormClosed += delegate { timer.Stop(); if (other != null) other.Dispose(); if (cover != null) cover.Dispose(); };
  }

  Button AddButton(string id, string text, int x, int y) {
    var b = new Button { Name = id, Text = text, AccessibleName = text, Bounds = new Rectangle(x, y, 180, 46) };
    b.MouseDown += delegate(object sender, MouseEventArgs e) {
      var p = b.PointToScreen(e.Location);
      Record("mouse", id, new { x = p.X, y = p.Y, button = e.Button.ToString() });
    };
    b.Click += delegate { Record("click", id, null); };
    Controls.Add(b); controls.Add(id, b); return b;
  }

  void AddField(string id, string text, int y) {
    var label = new Label { Text = text, Name = id + "-label", AccessibleName = text, Bounds = new Rectangle(30, y, 180, 30) };
    var input = new TextBox { Name = id, AccessibleName = text, Text = id + "-initial", Bounds = new Rectangle(230, y, 440, 38) };
    input.TextChanged += delegate { Record("text", id, new { value = input.Text }); };
    input.MouseDown += delegate(object sender, MouseEventArgs e) {
      var p = input.PointToScreen(e.Location);
      Record("mouse", id, new { x = p.X, y = p.Y, button = e.Button.ToString() });
    };
    Controls.Add(label); Controls.Add(input);
    controls.Add(id + "-label", label); controls.Add(id, input);
  }

  void Record(string kind, string id, object data) {
    events.Add(new { seq = ++eventSeq, at = DateTime.UtcNow.ToString("o"), kind = kind, id = id, data = data });
    if (events.Count > 1000) events.RemoveAt(0);
  }

  object Box(Rectangle r) { return new { x = r.X, y = r.Y, w = r.Width, h = r.Height }; }
  int Number(Dictionary<string, object> c, string key, int fallback) { return c.ContainsKey(key) ? Convert.ToInt32(c[key]) : fallback; }

  void Apply(Dictionary<string, object> c) {
    string kind = Convert.ToString(c["kind"]);
    switch(kind) {
      case "move": Bounds = new Rectangle(Number(c,"x",Left), Number(c,"y",Top), Number(c,"w",Width), Number(c,"h",Height)); break;
      case "layout":
        float scale = Number(c,"percent",100) / 100f;
        var b = controls["continue"];
        b.Bounds = new Rectangle(30,28,(int)(180 * scale),(int)(46 * scale));
        b.Font = new Font("Segoe UI", 12 * scale);
        break;
      case "focus-main": Show(); Activate(); SetForegroundWindow(Handle); break;
      case "focus-other":
        if (other == null) {
          other = new Form { Text = "Nubbo Other Window", StartPosition = FormStartPosition.Manual,
            Bounds = new Rectangle(860, 60, 300, 250) };
          var b2 = new Button { Text = "Kaydet", AccessibleName = "Kaydet", Bounds = new Rectangle(25,25,180,55) };
          b2.Click += delegate { Record("click", "other-save", null); };
          other.Controls.Add(b2);
        }
        other.Show(); other.Activate(); SetForegroundWindow(other.Handle); break;
      case "cover":
        if (cover != null) cover.Dispose();
        cover = new Form { Text = "Nubbo Cover Window", TopMost = true, StartPosition = FormStartPosition.Manual,
          Bounds = Bounds };
        cover.MouseDown += delegate { Record("mouse", "cover", null); };
        cover.Show(); cover.Activate(); break;
      case "uncover": if (cover != null) { cover.Dispose(); cover = null; } break;
      case "painted": showPainted = Convert.ToBoolean(c["visible"]); canvas.Invalidate(); break;
      case "reset": events.Clear(); break;
      case "close": Close(); return;
      default: throw new InvalidOperationException("Unknown fixture command: " + kind);
    }
  }

  void AtomicWrite(string file, string value) {
    string tmp = file + ".tmp";
    File.WriteAllText(tmp, value);
    if (File.Exists(file)) File.Replace(tmp, file, null); else File.Move(tmp, file);
  }

  void Tick() {
    try {
      string commandFile = Path.Combine(dir, "command.json");
      if (File.Exists(commandFile)) {
        var c = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(commandFile));
        long seq = Convert.ToInt64(c["seq"]);
        if (seq > commandSeq) {
          error = "";
          try { Apply(c); } catch (Exception ex) { error = ex.ToString(); }
          commandSeq = seq;
        }
      }
      if (IsDisposed) return;
      var boxes = new Dictionary<string, object>();
      foreach (var p in controls) {
        boxes.Add(p.Key, new { rect = Box(p.Value.RectangleToScreen(p.Value.ClientRectangle)),
          text = p.Value.Text, enabled = p.Value.Enabled, focused = p.Value.Focused });
      }
      boxes.Add("painted-remesh", new { rect = Box(canvas.RectangleToScreen(painted)), visible = showPainted });
      uint dpi = 0; try { dpi = GetDpiForWindow(Handle); } catch { }
      IntPtr desktop = OpenInputDesktop(0, false, 0x0100);
      bool interactive = desktop != IntPtr.Zero;
      if (interactive) CloseDesktop(desktop);
      var monitors = new List<object>();
      foreach (var s in Screen.AllScreens) monitors.Add(Box(s.Bounds));
      var state = new { commandSeq = commandSeq, eventSeq = eventSeq, error = error,
        hwnd = Handle.ToInt64().ToString(), pid = System.Diagnostics.Process.GetCurrentProcess().Id,
        foreground = GetForegroundWindow().ToInt64().ToString(), title = Text, rect = Box(Bounds),
        dpi = dpi, interactive = interactive, minimized = IsIconic(Handle),
        controls = boxes, events = events.ToArray(), monitors = monitors };
      AtomicWrite(Path.Combine(dir, "state.json"), json.Serialize(state));
    } catch (IOException) { /* Reader/writer race: retry on next tick. */ }
  }

  [STAThread] public static void Main(string[] args) {
    if (args.Length != 1) throw new ArgumentException("One artifact directory is required");
    SetProcessDPIAware();
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new ClickTestHost(args[0]));
  }
}
