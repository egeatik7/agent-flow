param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ClickTestHost.cs') -Raw
$directory = Split-Path -Parent $Output
[void][IO.Directory]::CreateDirectory($directory)
if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
Add-Type -TypeDefinition $source -ReferencedAssemblies @('System.Windows.Forms','System.Drawing','System.Web.Extensions') -OutputAssembly $Output -OutputType WindowsApplication
Write-Output "Built visible test fixture: $Output"
