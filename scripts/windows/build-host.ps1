param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ClickTestHost.cs') -Raw -Encoding UTF8
$directory = Split-Path -Parent $Output
[void][IO.Directory]::CreateDirectory($directory)
if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
Add-Type -TypeDefinition $source -ReferencedAssemblies @('System.Windows.Forms','System.Drawing','System.Web.Extensions') -OutputAssembly $Output -OutputType WindowsApplication
# Add-Type does not emit an app.config. Enable the framework's real UIA providers
# for the fixture instead of silently falling back to legacy Pane-only controls.
# https://learn.microsoft.com/en-us/dotnet/framework/whats-new/whats-new-in-accessibility
@'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup>
  <runtime><AppContextSwitchOverrides value="Switch.UseLegacyAccessibilityFeatures=false;Switch.UseLegacyAccessibilityFeatures.2=false;Switch.UseLegacyAccessibilityFeatures.3=false;Switch.UseLegacyAccessibilityFeatures.4=false;Switch.UseLegacyAccessibilityFeatures.5=false" /></runtime>
</configuration>
'@ | Set-Content -LiteralPath ($Output + '.config') -Encoding UTF8
Write-Output "Built visible test fixture: $Output"
