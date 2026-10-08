# 우이런 워치 debug APK 빌드(Windows PowerShell).
# 폰 개발 빌드와 같은 debug 키(mobile/android/app/debug.keystore)로 서명한다. 다른 위치면 -PhoneKeystore로 지정한다.
# 예) .\scripts\build-debug.ps1
#     .\scripts\build-debug.ps1 -PhoneKeystore D:\keys\phone-debug.keystore
param([string]$PhoneKeystore)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw 'JAVA_HOME을 JDK 17 경로로 지정하세요(예: C:\Program Files\Java\jdk-17).' }
$javaVersion = cmd /c "`"$env:JAVA_HOME\bin\java.exe`" -version 2>&1" | Select-Object -First 1
if ($javaVersion -notmatch '"17\.') { throw "JDK 17이 필요합니다. 지금 JAVA_HOME: $javaVersion" }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $env:ANDROID_HOME)) { throw "Android SDK를 찾지 못했습니다: $env:ANDROID_HOME" }

$gradleArgs = @(':app:assembleDebug', '--console=plain')
if ($PhoneKeystore) { $gradleArgs += "-PuirunDebugKeystore=$((Resolve-Path $PhoneKeystore).Path)" }
Push-Location $root
try {
    & .\gradlew.bat @gradleArgs
    if ($LASTEXITCODE -ne 0) { throw 'Gradle 빌드 실패' }
} finally { Pop-Location }

$apk = Join-Path $root 'app\build\outputs\apk\debug\app-debug.apk'
$buildTools = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') | Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } | Select-Object -Last 1
Write-Host "APK: $apk"
& (Join-Path $buildTools.FullName 'apksigner.bat') verify --print-certs $apk | Select-String 'SHA-256|SHA-1'
