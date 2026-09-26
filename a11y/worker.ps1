# Long-running automation worker.
# Request line:  <id>\t<op>\t<base64 utf8 json payload>
# Response line: <id>\t<base64 utf8 json {ok,data|error}>

. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'screen.ps1')

function ConvertTo-SendKeysText([string]$t) {
  return ($t -replace '([\+\^%~\(\)\{\}\[\]])', '{$1}')
}

function Invoke-Op([string]$op, $P) {
  switch ($op) {
    'ping' {
      return [pscustomobject]@{ ocr = (Initialize-Ocr); ps = $PSVersionTable.PSVersion.ToString() }
    }
    'listWindows' {
      $own = 0
      if ($P.ownPid) { $own = [int]$P.ownPid }
      $out = New-Object System.Collections.ArrayList
      foreach ($w in (Get-TopWindows $own)) {
        try {
          $h = [IntPtr]$w.Current.NativeWindowHandle
          if ($h -ne [IntPtr]::Zero -and ([XpNative]::IsCloaked($h) -or -not [XpNative]::IsWindowVisible($h))) { continue }
          [void]$out.Add([pscustomobject]@{ title = [string]$w.Current.Name; handle = [string]$w.Current.NativeWindowHandle })
        } catch {}
      }
      return , $out
    }
    'scan' {
      return (Invoke-Scan $P)
    }
    'clickAt' {
      Invoke-MouseAt ([int]$P.x) ([int]$P.y) ([string]$P.button)
      return $true
    }
    'locate' {
      $win = Find-WindowOrNull ([string]$P.windowTitle)
      if ($null -eq $win) { return $null }
      Enter-Window $win
      $el = Find-ByLocator $win $P.locator
      if ($null -eq $el) { return $null }
      $off = $false
      try { $off = $el.Current.IsOffscreen } catch {}
      $r = $el.Current.BoundingRectangle
      if ($off -or $r.IsEmpty -or $r.Width -le 0 -or [double]::IsInfinity($r.X)) { return $null }
      return [pscustomobject]@{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; name = [string]$el.Current.Name }
    }
    'windowRect' {
      $win = Find-Window ([string]$P.windowTitle)
      Enter-Window $win
      $r = $win.Current.BoundingRectangle
      return [pscustomobject]@{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
    }
    'typeText' {
      if ($P.clearFirst) {
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        Start-Sleep -Milliseconds 40
      }
      $text = [string]$P.text
      if ($text.Length -gt 0) { [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysText $text)) }
      if ($P.pressEnter) {
        Start-Sleep -Milliseconds 60
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      }
      return $true
    }
    'keys' {
      if ($P.windowTitle) {
        $win = Find-WindowOrNull ([string]$P.windowTitle)
        if ($null -ne $win) { Enter-Window $win }
      }
      [System.Windows.Forms.SendKeys]::SendWait([string]$P.keys)
      return $true
    }
    'capture' {
      $pt = Get-CursorPoint
      $el = $script:AE::FromPoint((New-Object System.Windows.Point($pt.X, $pt.Y)))
      if ($null -eq $el) { return $null }
      $top = Get-TopLevel $el
      return (New-Locator $el $top $pt.X $pt.Y)
    }
    default { throw "UNKNOWN_OP: $op" }
  }
}

function Send-Response([string]$id, $obj) {
  $json = ConvertTo-Json -InputObject $obj -Compress -Depth 12
  $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  [Console]::Out.WriteLine("$id`t$b64")
  [Console]::Out.Flush()
}

[void](Initialize-Ocr)
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line.Length -eq 0) { continue }
  $parts = $line.Split("`t")
  $id = $parts[0]
  try {
    $P = New-Object psobject
    if ($parts.Length -gt 2 -and $parts[2].Length -gt 0) {
      $P = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[2])) | ConvertFrom-Json
    }
    $data = Invoke-Op $parts[1] $P
    Send-Response $id ([pscustomobject]@{ ok = $true; data = $data })
  } catch {
    Send-Response $id ([pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message })
  }
}
