# Bir dosyayı hangi süreçlerin kilitlediğini söyler (Windows Restart Manager API'si ile).
#
# Neden: başlatıcı, exe'yi masaüstüne kopyalarken EBUSY alıyor ve kilit 20 saniyede bırakılmıyor.
# Tahmin etmek yerine kilidi tutan süreç(ler) adlarıyla söylenir; kapatma kararını çağıran verir.
param([Parameter(Mandatory = $true)][string]$Path)

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Rm {
  [StructLayout(LayoutKind.Sequential)] public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
  const int CCH_RM_MAX_APP_NAME = 255, CCH_RM_MAX_SVC_NAME = 63;
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)] public string strServiceShortName;
    public int ApplicationType; public uint AppStatus; public uint TSSessionId; [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint pSessionHandle);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

  public static List<string> Who(string path) {
    var sonuc = new List<string>();
    uint session; string key = Guid.NewGuid().ToString();
    if (RmStartSession(out session, 0, key) != 0) return sonuc;
    try {
      string[] files = new[] { path };
      if (RmRegisterResources(session, 1, files, 0, null, 0, null) != 0) return sonuc;
      uint needed = 0, count = 0, reasons = 0;
      int r = RmGetList(session, out needed, ref count, null, ref reasons);
      if (r == 234 && needed > 0) {
        var info = new RM_PROCESS_INFO[needed];
        count = needed;
        if (RmGetList(session, out needed, ref count, info, ref reasons) == 0) {
          for (int i = 0; i < count; i++) sonuc.Add(info[i].Process.dwProcessId + "|" + info[i].strAppName);
        }
      }
    } finally { RmEndSession(session); }
    return sonuc;
  }
}
"@

if (-not (Test-Path -LiteralPath $Path)) { Write-Output "yol yok: $Path"; exit 1 }
$liste = [Rm]::Who((Resolve-Path -LiteralPath $Path).Path)
if (-not $liste -or $liste.Count -eq 0) { Write-Output 'kilidi tutan süreç bulunamadı'; exit 0 }
foreach ($satir in $liste) {
  $p = $satir.Split('|')
  $pidDegeri = [int]$p[0]
  $pr = Get-Process -Id $pidDegeri -ErrorAction SilentlyContinue
  $yol = if ($pr) { $pr.Path } else { '' }
  $bas = if ($pr) { $pr.MainWindowTitle } else { '' }
  Write-Output "$pidDegeri|$($p[1])|$yol|$bas"
}
