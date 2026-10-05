// Visible Windows fixture with standard WPF accessibility providers.
// Only actual UI events count as input; rectangles are independent assertions.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]

public sealed class ClickTestHost : Window {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out NativeRect r);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] struct NativeRect { public int Left, Top, Right, Bottom; }

  readonly string dir;
  readonly JavaScriptSerializer json = new JavaScriptSerializer();
  readonly Dictionary<string, FrameworkElement> controls = new Dictionary<string, FrameworkElement>();
  readonly List<object> events = new List<object>();
  readonly DispatcherTimer timer = new DispatcherTimer();
  readonly Canvas layout = new Canvas();
  readonly PaintedCanvas painted = new PaintedCanvas();
  Window other, cover;
  long commandSeq, eventSeq;
  string error = "";
  bool closed;
  IntPtr Handle { get { return new WindowInteropHelper(this).Handle; } }

  ClickTestHost(string directory) {
    dir = directory;
    Directory.CreateDirectory(dir);
    Title = "Nubbo Click Test Host";
    Left = 60; Top = 60; Width = 760; Height = 590;
    FontFamily = new FontFamily("Segoe UI"); FontSize = 16;
    Background = Brushes.WhiteSmoke;
    Content = layout;
    AddButton("continue", "Devam", 30, 28);
    AddButton("save-left", "Kaydet", 30, 94);
    AddButton("save-right", "Kaydet", 240, 94);
    AddButton("disabled", "Pasif", 450, 94).IsEnabled = false;
    AddField("source", "Kaynak klasör", 210);
    AddField("search", "Ara", 290);
    Place(painted, 30, 370, 660, 150);
    painted.PreviewMouseDown += delegate(object sender, MouseButtonEventArgs e) {
      var local = e.GetPosition(painted); var p = painted.PointToScreen(local);
      Record("mouse", painted.ShowText && PaintedCanvas.Target.Contains(local) ? "painted-remesh" : "canvas-background",
        new { x = (int)p.X, y = (int)p.Y, button = e.ChangedButton.ToString() });
    };
    PreviewKeyDown += delegate(object sender, KeyEventArgs e) {
      Record("key", "main", new { key = (e.Key == Key.Return ? "Enter" : e.Key.ToString()), modifiers = Keyboard.Modifiers.ToString() });
    };
    timer.Interval = TimeSpan.FromMilliseconds(100);
    timer.Tick += delegate { Tick(); };
    ContentRendered += delegate { timer.Start(); Tick(); };
    Closed += delegate { closed = true; timer.Stop(); if (other != null) other.Close(); if (cover != null) cover.Close(); };
  }

  void Place(FrameworkElement control, double x, double y, double w, double h) {
    Canvas.SetLeft(control, x); Canvas.SetTop(control, y); control.Width = w; control.Height = h;
    layout.Children.Add(control);
  }
  void MouseEvent(FrameworkElement control, string id) {
    control.PreviewMouseDown += delegate(object sender, MouseButtonEventArgs e) {
      var p = control.PointToScreen(e.GetPosition(control));
      Record("mouse", id, new { x = (int)p.X, y = (int)p.Y, button = e.ChangedButton.ToString() });
    };
  }
  Button AddButton(string id, string text, int x, int y) {
    var b = new Button { Content = text };
    AutomationProperties.SetName(b, text); AutomationProperties.SetAutomationId(b, id);
    MouseEvent(b, id); b.Click += delegate { Record("click", id, null); };
    Place(b, x, y, 180, 46); controls.Add(id, b); return b;
  }
  void AddField(string id, string text, int y) {
    var label = new TextBlock { Text = text };
    AutomationProperties.SetName(label, text);
    var input = new TextBox { Text = id + "-initial", VerticalContentAlignment = VerticalAlignment.Center };
    AutomationProperties.SetName(input, text); AutomationProperties.SetAutomationId(input, id);
    input.TextChanged += delegate { Record("text", id, new { value = input.Text }); };
    MouseEvent(input, id);
    Place(label, 30, y, 180, 30); Place(input, 230, y, 440, 38);
    controls.Add(id + "-label", label); controls.Add(id, input);
  }
  void Record(string kind, string id, object data) {
    events.Add(new { seq = ++eventSeq, at = DateTime.UtcNow.ToString("o"), kind = kind, id = id, data = data });
    if (events.Count > 1000) events.RemoveAt(0);
  }
  object Box(Rect r) { return new { x = (int)r.X, y = (int)r.Y, w = (int)r.Width, h = (int)r.Height }; }
  Rect ScreenBox(FrameworkElement c, Rect r) {
    Point a = c.PointToScreen(r.TopLeft), b = c.PointToScreen(r.BottomRight);
    return new Rect(a, b);
  }
  Rect WindowBox(Window w) {
    NativeRect r; GetWindowRect(new WindowInteropHelper(w).Handle, out r);
    return new Rect(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
  }
  int Number(Dictionary<string, object> c, string key, double fallback) { return c.ContainsKey(key) ? Convert.ToInt32(c[key]) : (int)fallback; }
  void Apply(Dictionary<string, object> c) {
    switch(Convert.ToString(c["kind"])) {
      case "move": Left = Number(c,"x",Left); Top = Number(c,"y",Top); Width = Number(c,"w",Width); Height = Number(c,"h",Height); break;
      case "layout":
        double scale = Number(c,"percent",100) / 100.0;
        var b = (Button)controls["continue"]; b.Width = 180 * scale; b.Height = 46 * scale; b.FontSize = 16 * scale;
        break;
      case "focus-main": Show(); Activate(); SetForegroundWindow(Handle); break;
      case "focus-other":
        if (other == null) {
          other = new Window { Title = "Nubbo Other Window", Left = 860, Top = 60, Width = 300, Height = 250 };
          var b2 = new Button { Content = "Kaydet", Width = 180, Height = 55 };
          AutomationProperties.SetName(b2, "Kaydet");
          b2.Click += delegate { Record("click", "other-save", null); }; other.Content = b2;
        }
        other.Show(); other.Activate(); SetForegroundWindow(new WindowInteropHelper(other).Handle); break;
      case "cover":
        if (cover != null) cover.Close();
        cover = new Window { Title = "Nubbo Cover Window", Topmost = true, Left = Left, Top = Top, Width = Width, Height = Height, Background = Brushes.LightGray };
        cover.PreviewMouseDown += delegate { Record("mouse", "cover", null); };
        cover.Show(); cover.Activate(); break;
      case "uncover": if (cover != null) { cover.Close(); cover = null; } break;
      case "painted": painted.ShowText = Convert.ToBoolean(c["visible"]); painted.InvalidateVisual(); break;
      case "reset": events.Clear(); break;
      case "close": Close(); return;
      default: throw new InvalidOperationException("Unknown fixture command");
    }
    UpdateLayout();
  }
  void AtomicWrite(string file, string value) {
    string tmp = file + ".tmp"; File.WriteAllText(tmp, value);
    if (File.Exists(file)) File.Replace(tmp, file, null); else File.Move(tmp, file);
  }
  void Tick() {
    try {
      string commandFile = Path.Combine(dir, "command.json");
      if (File.Exists(commandFile)) {
        var c = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(commandFile));
        long seq = Convert.ToInt64(c["seq"]);
        if (seq > commandSeq) { error = ""; try { Apply(c); } catch (Exception ex) { error = ex.ToString(); } commandSeq = seq; }
      }
      if (closed) return;
      var boxes = new Dictionary<string, object>();
      foreach (var p in controls) {
        var input = p.Value as TextBox; var button = p.Value as Button; var label = p.Value as TextBlock;
        string text = input != null ? input.Text : button != null ? Convert.ToString(button.Content) : label.Text;
        boxes.Add(p.Key, new { rect = Box(ScreenBox(p.Value, new Rect(0,0,p.Value.ActualWidth,p.Value.ActualHeight))),
          text = text, enabled = p.Value.IsEnabled, focused = p.Value.IsKeyboardFocused });
      }
      boxes.Add("painted-remesh", new { rect = Box(ScreenBox(painted, PaintedCanvas.Target)), visible = painted.ShowText });
      uint dpi = 0; try { dpi = GetDpiForWindow(Handle); } catch { }
      IntPtr desktop = OpenInputDesktop(0, false, 0x0100); bool interactive = desktop != IntPtr.Zero;
      if (interactive) CloseDesktop(desktop);
      var monitors = new List<object>();
      foreach (var s in System.Windows.Forms.Screen.AllScreens) monitors.Add(new { x=s.Bounds.X, y=s.Bounds.Y, w=s.Bounds.Width, h=s.Bounds.Height });
      AtomicWrite(Path.Combine(dir, "state.json"), json.Serialize(new {
        commandSeq=commandSeq, eventSeq=eventSeq, error=error, hwnd=Handle.ToInt64().ToString(), pid=System.Diagnostics.Process.GetCurrentProcess().Id,
        foreground=GetForegroundWindow().ToInt64().ToString(), title=Title, rect=Box(WindowBox(this)), dpi=dpi, interactive=interactive,
        minimized=IsIconic(Handle), controls=boxes, events=events.ToArray(), monitors=monitors }));
    } catch (IOException) { /* Reader/writer race: retry on next tick. */ }
  }
  [STAThread] public static void Main(string[] args) {
    if (args.Length != 1) throw new ArgumentException("One artifact directory is required");
    SetProcessDPIAware(); new Application().Run(new ClickTestHost(args[0]));
  }
}

// No text automation peer: recognition must come from the actual screen pixels.
public sealed class PaintedCanvas : FrameworkElement {
  public static readonly Rect Target = new Rect(48,28,230,64);
  public bool ShowText = true;
  protected override void OnRender(DrawingContext dc) {
    dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(45,45,45)), null, new Rect(0,0,ActualWidth,ActualHeight));
    if (!ShowText) return;
    dc.DrawRectangle(Brushes.White, null, Target);
    var text = new FormattedText("RUN REMESH", CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
      new Typeface(new FontFamily("Arial"),FontStyles.Normal,FontWeights.Bold,FontStretches.Normal), 26.67, Brushes.Black, VisualTreeHelper.GetDpi(this).PixelsPerDip);
    dc.DrawText(text, new Point(Target.X+12,Target.Y+17));
  }
}
