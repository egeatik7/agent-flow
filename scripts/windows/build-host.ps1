param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ClickTestHost.cs') -Raw -Encoding UTF8
$directory = Split-Path -Parent $Output
[void][IO.Directory]::CreateDirectory($directory)
if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
$framework = [Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$references = @('System.Windows.Forms','System.Drawing','System.Web.Extensions',
  (Join-Path $framework 'WPF\PresentationFramework.dll'),
  (Join-Path $framework 'WPF\PresentationCore.dll'),
  (Join-Path $framework 'WPF\WindowsBase.dll'))
Add-Type -TypeDefinition $source -ReferencedAssemblies $references -OutputAssembly $Output -OutputType WindowsApplication
@'
<?xml version="1.0" encoding="utf-8"?>
<configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup></configuration>
'@ | Set-Content -LiteralPath ($Output + '.config') -Encoding UTF8
Write-Output "Built visible WPF test fixture: $Output"
