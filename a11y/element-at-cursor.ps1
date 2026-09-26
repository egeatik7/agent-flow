Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$pt = [System.Windows.Forms.Cursor]::Position
$point = New-Object System.Windows.Point($pt.X, $pt.Y)
$el = [System.Windows.Automation.AutomationElement]::FromPoint($point)
if ($null -eq $el) { Write-Output ""; exit 0 }

function Get-ControlTypeName($e) {
  try { return $e.Current.ControlType.ProgrammaticName.Replace("ControlType.", "") }
  catch { return "Unknown" }
}

function Get-PathFromRoot($e) {
  $segments = New-Object System.Collections.Generic.List[string]
  $cur = $e
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  while ($null -ne $cur) {
    $parent = $walker.GetParent($cur)
    if ($null -eq $parent) { $segments.Insert(0, "0"); break }
    $siblings = $parent.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    $idx = 0
    $found = 0
    foreach ($s in $siblings) {
      if ($s.Current.RuntimeId -join "," -eq ($cur.Current.RuntimeId -join ",")) {
        $found = $idx; break
      }
      $idx++
    }
    $segments.Insert(0, "$found")
    $cur = $parent
  }
  return ($segments -join "/")
}

$obj = [ordered]@{
  id           = [guid]::NewGuid().ToString()
  name         = $el.Current.Name
  controlType  = (Get-ControlTypeName $el)
  automationId = $el.Current.AutomationId
  path         = (Get-PathFromRoot $el)
}
$obj | ConvertTo-Json -Compress
