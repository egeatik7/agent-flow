param([int]$OwnPid = 0)

. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'screen.ps1')
$ErrorActionPreference = 'Continue'
[void](Initialize-Ocr)

function Write-Line([string]$json) {
  $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  [Console]::Out.WriteLine($b64)
  [Console]::Out.Flush()
}

Write-Line '{"ready":true}'

$prev = $false
while ($true) {
  $down = ([int][XpNative]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
  if ($down -and -not $prev) {
    try {
      $pt = Get-CursorPoint
      $el = $script:AE::FromPoint((New-Object System.Windows.Point($pt.X, $pt.Y)))
      if ($null -ne $el -and ($OwnPid -eq 0 -or $el.Current.ProcessId -ne $OwnPid)) {
        $top = Get-TopLevel $el
        $loc = New-Locator $el $top $pt.X $pt.Y
        Write-Line (ConvertTo-Json -InputObject $loc -Compress)
      }
    } catch {}
  }
  $prev = $down
  Start-Sleep -Milliseconds 15
}
