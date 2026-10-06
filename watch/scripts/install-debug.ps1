# 우이런 워치 debug APK를 지정한 워치 한 대에만 설치한다(여러 기기가 연결돼 있어도 다른 기기에 설치하지 않는다).
# 예) .\scripts\install-debug.ps1 -Serial emulator-5560
#     .\scripts\install-debug.ps1 -Serial 192.168.0.12:5555 -Demo run   # 개발 빌드 DEMO 화면으로 실행
param(
    [Parameter(Mandatory = $true)][string]$Serial,
    [string]$Apk,
    [string]$Demo
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
if (-not $Apk) { $Apk = Join-Path $root 'app\build\outputs\apk\debug\app-debug.apk' }
if (-not (Test-Path $Apk)) { throw "APK가 없습니다: $Apk (먼저 .\scripts\build-debug.ps1)" }

$state = (& $adb -s $Serial get-state 2>$null)
if ($state -ne 'device') { throw "기기 $Serial 이(가) 연결돼 있지 않습니다. adb devices로 serial을 확인하세요." }
$features = (& $adb -s $Serial shell pm list features) -join "`n"
if ($features -notmatch 'android.hardware.type.watch') { throw "$Serial 은(는) Wear OS 기기가 아닙니다. 폰에는 워치 APK를 설치하지 않습니다." }

& $adb -s $Serial install -r $Apk
if ($LASTEXITCODE -ne 0) { throw '설치 실패(서명이 다른 같은 패키지가 이미 있으면 먼저 워치에서 우이런을 지우세요).' }

$activity = 'com.attentionall.uirun/com.attentionall.uirun.watch.MainActivity'
if ($Demo) { & $adb -s $Serial shell am start -n $activity --es demo $Demo } else { & $adb -s $Serial shell am start -n $activity }
