# List top-level windows for targeting
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window
)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$result = @()
foreach ($w in $windows) {
  $name = $w.Current.Name
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $result += [PSCustomObject]@{
    title  = $name
    handle = $w.Current.NativeWindowHandle.ToString()
  }
}
$result | ConvertTo-Json -Compress -Depth 4
