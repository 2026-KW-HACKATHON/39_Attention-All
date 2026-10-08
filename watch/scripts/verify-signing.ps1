# 폰·워치 APK가 같은 서명 인증서인지 확인한다(Data Layer 연결 조건: 같은 applicationId + 같은 서명).
# 폰 APK는 파일 경로(-PhoneApk) 또는 설치된 폰의 serial(-PhoneSerial, 설치된 APK를 받아 비교)로 지정한다.
# 예) .\scripts\verify-signing.ps1 -PhoneApk ..\mobile\android\app\build\outputs\apk\debug\app-debug.apk
#     .\scripts\verify-signing.ps1 -PhoneSerial R3CN30XXXXX
param([string]$PhoneApk, [string]$PhoneSerial, [string]$WatchApk)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not $WatchApk) { $WatchApk = Join-Path $root 'app\build\outputs\apk\debug\app-debug.apk' }
$buildTools = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') | Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } | Select-Object -Last 1
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$aapt = Join-Path $buildTools.FullName 'aapt.exe'

if ($PhoneSerial) {
    $adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
    $path = ((& $adb -s $PhoneSerial shell pm path com.attentionall.uirun) | Select-String '^package:' | Select-Object -First 1).ToString().Substring(8).Trim()
    $PhoneApk = Join-Path $env:TEMP 'uirun-phone-installed.apk'
    & $adb -s $PhoneSerial pull $path $PhoneApk | Out-Null
}
if (-not $PhoneApk -or -not (Test-Path $PhoneApk)) { throw '-PhoneApk 또는 -PhoneSerial을 지정하세요.' }

function Info($apk) {
    $certs = & $apksigner verify --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw "서명 확인 실패: $apk" }
    $pkg = ((& $aapt dump badging $apk) | Select-String "^package: name='([^']+)'").Matches[0].Groups[1].Value
    [pscustomobject]@{ Package = $pkg; Sha256 = (($certs | Select-String 'SHA-256 digest: (.+)$').Matches[0].Groups[1].Value) }
}
$p = Info $PhoneApk
$w = Info $WatchApk
"phone  $($p.Package)  $($p.Sha256)"
"watch  $($w.Package)  $($w.Sha256)"
if ($p.Package -ne $w.Package) { throw 'applicationId가 다릅니다. Data Layer가 연결되지 않습니다.' }
if ($p.Sha256 -ne $w.Sha256) { throw '서명 인증서가 다릅니다. 워치를 폰의 실제 debug 키로 다시 빌드하세요(-PhoneKeystore).' }
'OK: applicationId와 서명 인증서가 같습니다.'
