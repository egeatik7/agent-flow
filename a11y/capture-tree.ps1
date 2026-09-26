param(
  [string]$WindowTitle = "",
  [int]$MaxDepth = 8
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-ControlTypeName($el) {
  try { return $el.Current.ControlType.ProgrammaticName.Replace("ControlType.", "") }
  catch { return "Unknown" }
}

function Build-Node($el, [string]$path, [int]$depth, [int]$maxDepth) {
  $node = [ordered]@{
    id           = $path
    name         = $el.Current.Name
    controlType  = (Get-ControlTypeName $el)
    automationId = $el.Current.AutomationId
    path         = $path
    children     = @()
  }
  if ($depth -ge $maxDepth) { return $node }

  $children = $el.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $i = 0
  foreach ($c in $children) {
    if ($null -eq $c) { continue }
    $childPath = "$path/$i"
    $node.children += (Build-Node $c $childPath ($depth + 1) $maxDepth)
    $i++
  }
  return $node
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$target = $null

if (-not [string]::IsNullOrWhiteSpace($WindowTitle)) {
  $nameCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    $WindowTitle
  )
  $typeCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
  )
  $and = New-Object System.Windows.Automation.AndCondition($nameCond, $typeCond)
  $target = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $and)
  if ($null -eq $target) {
    # partial match fallback
    $wins = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window
      ))
    )
    foreach ($w in $wins) {
      if ($w.Current.Name -like "*$WindowTitle*") { $target = $w; break }
    }
  }
}

if ($null -eq $target) {
  $target = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $target) { $target = $root }
}

$tree = Build-Node $target "0" 0 $MaxDepth
$tree | ConvertTo-Json -Compress -Depth 40
