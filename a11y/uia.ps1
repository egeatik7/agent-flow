param(
  [Parameter(Mandatory = $true)][string]$Op,
  [string]$Payload = ''
)

. (Join-Path $PSScriptRoot 'common.ps1')

$P = New-Object psobject
if ($Payload) {
  $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
  $P = $json | ConvertFrom-Json
}

function Write-Result($data) {
  $o = [pscustomobject]@{ ok = $true; data = $data }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 99))
}

function Get-TargetElement {
  $win = Find-Window ([string]$P.windowTitle)
  Enter-Window $win
  $el = Find-ByLocator $win $P.locator
  if ($null -eq $el) { throw "ELEMENT_NOT_FOUND: $($P.locator.name) [$($P.locator.path)]" }
  return @($win, $el)
}

function Invoke-PhysicalClick($el) {
  $r = $el.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -le 0 -or $r.Height -le 0 -or [double]::IsInfinity($r.X)) { return $false }
  $x = [int]($r.X + $r.Width / 2)
  $y = [int]($r.Y + $r.Height / 2)
  [void][XpNative]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 40
  [XpNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 30
  [XpNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  return $true
}

function Invoke-ByPattern($el) {
  $pat = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $pat.Invoke(); return 'invoke' }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pat)) { $pat.Select(); return 'select' }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) { $pat.Toggle(); return 'toggle' }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) { $pat.Expand(); return 'expand' }
  return $null
}

function ConvertTo-SendKeysText([string]$t) {
  return ($t -replace '([\+\^%~\(\)\{\}\[\]])', '{$1}')
}

function Build-Tree($el, [string]$path, [int]$depth, [int]$maxDepth) {
  $script:count++
  $node = [ordered]@{
    id           = $path
    name         = [string]$el.Current.Name
    controlType  = (Get-CT $el)
    automationId = [string]$el.Current.AutomationId
    path         = $path
    children     = New-Object System.Collections.ArrayList
  }
  if ($depth -lt $maxDepth -and $script:count -lt $script:maxNodes) {
    $i = 0
    $c = $script:Walker.GetFirstChild($el)
    while ($null -ne $c -and $script:count -lt $script:maxNodes) {
      try { [void]$node.children.Add((Build-Tree $c "$path/$i" ($depth + 1) $maxDepth)) } catch {}
      $i++
      $c = $script:Walker.GetNextSibling($c)
    }
  }
  return [pscustomobject]$node
}

try {
  switch ($Op) {
    'listWindows' {
      $own = 0
      if ($P.ownPid) { $own = [int]$P.ownPid }
      $out = New-Object System.Collections.ArrayList
      foreach ($w in (Get-TopWindows $own)) {
        [void]$out.Add([pscustomobject]@{
          title  = [string]$w.Current.Name
          handle = [string]$w.Current.NativeWindowHandle
          pid    = [int]$w.Current.ProcessId
        })
      }
      Write-Result $out
    }
    'tree' {
      $win = Find-Window ([string]$P.windowTitle)
      $script:count = 0
      $script:maxNodes = 1500
      if ($P.maxNodes) { $script:maxNodes = [int]$P.maxNodes }
      $depth = 8
      if ($P.maxDepth) { $depth = [Math]::Min(25, [int]$P.maxDepth) }
      Write-Result (Build-Tree $win '0' 0 $depth)
    }
    'click' {
      $pair = Get-TargetElement
      $el = $pair[1]
      $how = 'mouse'
      $off = $true
      try { $off = $el.Current.IsOffscreen } catch {}
      if ($off -or -not (Invoke-PhysicalClick $el)) {
        $how = Invoke-ByPattern $el
        if (-not $how) { throw 'ELEMENT_NOT_CLICKABLE' }
      }
      Write-Result ([pscustomobject]@{ method = $how; name = [string]$el.Current.Name })
    }
    'type' {
      $pair = Get-TargetElement
      $el = $pair[1]
      $text = [string]$P.text
      $done = $false
      try { $el.SetFocus() } catch {}
      $pat = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) {
        if (-not $pat.Current.IsReadOnly) {
          try { $pat.SetValue($text); $done = $true } catch {}
        }
      }
      if (-not $done) {
        [void](Invoke-PhysicalClick $el)
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysText $text))
      }
      if ($P.pressEnter) {
        Start-Sleep -Milliseconds 60
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      }
      Write-Result ([pscustomobject]@{ method = $(if ($done) { 'value' } else { 'keys' }) })
    }
    'keys' {
      if ($P.windowTitle) { Enter-Window (Find-Window ([string]$P.windowTitle)) }
      [System.Windows.Forms.SendKeys]::SendWait([string]$P.keys)
      Write-Result $true
    }
    'exists' {
      $win = Find-Window ([string]$P.windowTitle)
      $needle = [string]$P.text
      $found = $false
      $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($e in $all) {
        try {
          if ($e.Current.Name -like "*$needle*" -and -not $e.Current.IsOffscreen) { $found = $true; break }
        } catch {}
      }
      Write-Result ([pscustomobject]@{ found = $found })
    }
    'capture' {
      $el = Get-CursorElement
      if ($null -eq $el) { Write-Result $null; break }
      $top = Get-TopLevel $el
      Write-Result (New-Locator $el $top)
    }
    default { throw "UNKNOWN_OP: $Op" }
  }
} catch {
  $o = [pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress))
  exit 1
}
