param([int]$OwnPid = 0)

. (Join-Path $PSScriptRoot 'common.ps1')
$ErrorActionPreference = 'Continue'

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

$prev = $false
while ($true) {
  $down = ([int][XpNative]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
  if ($down -and -not $prev) {
    try {
      $el = Get-CursorElement
      if ($null -ne $el -and ($OwnPid -eq 0 -or $el.Current.ProcessId -ne $OwnPid)) {
        $top = Get-TopLevel $el
        $loc = New-Locator $el $top
        [Console]::Out.WriteLine((ConvertTo-Json -InputObject $loc -Compress))
        [Console]::Out.Flush()
      }
    } catch {}
  }
  $prev = $down
  Start-Sleep -Milliseconds 15
}
