# Executes the production Invoke-Scan route with bitmap/OS test doubles.
# Verifies frame ownership: marker on model copy, never OCR/ONNX/signature/raw.
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../a11y/screen.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Invoke-Scan','Get-ScreenBitmap')) {
 $fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if (-not $fn) { throw "Missing production function $name" }
 Invoke-Expression $fn.Extent.Text
}
Add-Type -TypeDefinition @'
public class FakeBitmap {
 public bool Marked;
 public void Dispose() {}
}
public static class XpImage {
 public static byte[] Signature(FakeBitmap b) { return new byte[] { (byte)(b.Marked ? 1 : 0) }; }
}
public static class XpTurn {
 public static void CompressValue(FakeBitmap b,double lo,double hi) {}
}
'@
function Get-CaptureRect { return [pscustomobject]@{x=-100;y=0;w=1000;h=700} }
function Capture-Raw { $script:raw=New-Object FakeBitmap; return $script:raw }
function Copy-Screen { return (New-Object FakeBitmap) }
function Set-BitmapOpaque { }
function Copy-Bitmap32 { return (New-Object FakeBitmap) }
function Initialize-Ocr { return $true }
function Get-OcrPhrases($bmp,$x,$y) {
 if ($bmp.Marked -or -not [Object]::ReferenceEquals($bmp,$script:raw)) { throw 'OCR frame altered' }
 $script:ocrRead=$true
 return (New-Object System.Collections.ArrayList)
}
function Save-OnnxShot($bmp) {
 if ($bmp.Marked -or -not [Object]::ReferenceEquals($bmp,$script:raw)) { throw 'ONNX frame altered' }
 $script:onnxRead=$true; return ''
}
function Merge-Items { return @() }
function Get-TaskbarRegions { return @() }
function Add-CursorMarker($bmp,$rect) {
 if ([Object]::ReferenceEquals($bmp,$script:raw)) { throw 'Marker drawn on raw frame' }
 $bmp.Marked=$true; $script:markerCalls++
}
function ConvertTo-JpegBase64($bmp,$items,$rect,$marks,$maxW,$snap,$fit) { return [pscustomobject]@{marked=$bmp.Marked} }
$script:markerCalls=0; $script:ocrRead=$false; $script:onnxRead=$false
$r=Invoke-Scan ([pscustomobject]@{fresh=$true;uia=$false;ocr=$true;image='plain';sig=$true;cursorMarker=$true})
if (-not $r.image.marked) { throw 'Model did not receive cursor marker' }
if ($script:markerCalls -ne 1 -or $script:raw.Marked) { throw 'Marker ownership invalid' }
if (-not $script:ocrRead -or -not $script:onnxRead -or $r.sig -ne 'AA==') { throw 'Raw processing changed' }
$r=Invoke-Scan ([pscustomobject]@{fresh=$true;uia=$false;ocr=$true;image='plain';sig=$true})
if ($r.image.marked -or $script:markerCalls -ne 1) { throw 'Ordinary scanner image was marked' }
$raw=Get-ScreenBitmap ([pscustomobject]@{x=0;y=0;w=1000;h=700})
if ($raw.Marked -or $script:markerCalls -ne 1) { throw 'Template/crop capture was marked' }
Write-Output 'PASS: real scan route marks only requested model copy; OCR, ONNX, signature, ordinary scan and template/crop frames stay clean. OS and bitmap drawing mocked.'
