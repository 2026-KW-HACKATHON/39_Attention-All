# 폰·워치 Data Layer 진단: 페어링 문제인지, 앱(코드·설치·서명) 문제인지 가른다. 앱 데이터는 지우지 않는다.
# 1) 두 기기의 우이런 패키지·서명 인증서 2) Google Play 서비스(GMS) 기준 노드·연결·우이런 capability 항목
# 3) 워치 앱을 다시 열어 앱 안 진단 로그(logcat UirunDiag: capability 조회, 직접 ping, 폰 ACK)를 모아 판정한다.
# 예) .\scripts\diagnose-datalayer.ps1 -PhoneSerial emulator-5556 -WatchSerial emulator-5554
param(
    [Parameter(Mandatory = $true)][string]$PhoneSerial,
    [Parameter(Mandatory = $true)][string]$WatchSerial,
    [int]$WaitSeconds = 15
)
$ErrorActionPreference = 'Continue' # adb는 진행 상황을 stderr로 쓴다(PowerShell 5.1에서 오류로 바뀌지 않게)
$pkg = 'com.attentionall.uirun'
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
$buildTools = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') | Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } | Select-Object -Last 1
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
# 매개변수 이름을 target으로: adb 옵션(-s·-d·-v·-c)이 PowerShell 매개변수로 잡히지 않게
function A([string]$target) { & $adb -s $target @args }

function Cert([string]$serial) {
    $path = ((A $serial shell pm path $pkg) | Select-String '^package:' | Select-Object -First 1)
    if (-not $path) { return $null }
    $local = Join-Path $env:TEMP "uirun-diag-$($serial -replace '[^a-zA-Z0-9]', '_').apk"
    A $serial pull $path.ToString().Substring(8).Trim() $local 2>$null | Out-Null
    $line = (& $apksigner verify --print-certs $local 2>$null) | Select-String 'SHA-1 digest: (.+)$' | Select-Object -First 1
    return $line.Matches[0].Groups[1].Value
}

function Gms([string]$serial) {
    $dump = A $serial shell dumpsys activity service com.google.android.gms/.wearable.service.WearableService
    $local = ($dump | Select-String "localNode: NodeInternal\{id='([^']+)', name='([^']*)'" | Select-Object -First 1).Matches[0].Groups
    $reach = @()
    $in = $false
    foreach ($l in $dump) {
        if ($l -match 'Reachable Nodes:') { $in = $true; continue }
        if ($in) {
            if ($l -match '^\s*(\S.*?)\s*:\s*(\S+)\s*:\s*(\d+)\s*:\s*(true|false)\s*:\s*(true|false)') { if ($Matches[2] -ne 'cloud' -and $Matches[2] -ne 'id') { $reach += "$($Matches[2])($($Matches[1]), nearby=$($Matches[4]))" } }
            elseif ($l.Trim() -eq '' -or $l -match '#####') { $in = $false }
        }
    }
    $caps = $dump | Select-String "^\s+(\S+), \d+, \d+, ([^,]+), \S+, /capabilities/$([regex]::Escape($pkg))/([0-9a-f]+)/(\S+)," | ForEach-Object { "$($_.Matches[0].Groups[4].Value) (노드 $($_.Matches[0].Groups[1].Value), 서명 SHA-1 $($_.Matches[0].Groups[3].Value), $($_.Matches[0].Groups[2].Value))" }
    [pscustomobject]@{ Local = "$($local[1].Value)($($local[2].Value))"; LocalId = $local[1].Value; Reachable = $reach; Caps = $caps }
}

Write-Host "== 1. 기기·패키지·서명"
if (((A $WatchSerial shell pm list features) -join "`n") -notmatch 'android.hardware.type.watch') { throw "$WatchSerial 은(는) Wear OS 기기가 아닙니다." }
$pc = Cert $PhoneSerial; $wc = Cert $WatchSerial
"phone $PhoneSerial : $pkg 서명 SHA-1 $(if ($pc) { $pc } else { '설치 안 됨' })"
"watch $WatchSerial : $pkg 서명 SHA-1 $(if ($wc) { $wc } else { '설치 안 됨' })"

Write-Host "`n== 2. GMS(Data Layer) 상태"
$p = Gms $PhoneSerial; $w = Gms $WatchSerial
"phone localNode=$($p.Local) reachable=[$($p.Reachable -join ', ')]"
"phone가 가진 우이런 capability 항목: $(if ($p.Caps) { $p.Caps -join '; ' } else { '없음' })"
"watch localNode=$($w.Local) reachable=[$($w.Reachable -join ', ')]"
"watch가 가진 우이런 capability 항목: $(if ($w.Caps) { $w.Caps -join '; ' } else { '없음' })"

Write-Host "`n== 3. 앱 안 진단 로그(워치 앱 다시 열기, ${WaitSeconds}초)"
A $PhoneSerial logcat -c; A $WatchSerial logcat -c
A $WatchSerial shell am force-stop $pkg
A $WatchSerial shell am start -n "$pkg/$pkg.watch.MainActivity" | Out-Null
Start-Sleep -Seconds $WaitSeconds
$wl = A $WatchSerial logcat -d -v time -s UirunDiag:I
$pl = A $PhoneSerial logcat -d -v time -s UirunDiag:I ReactNativeJS:I | Select-String 'UirunDiag|\[wear\]'
"--- watch UirunDiag"; $wl
"--- phone UirunDiag / [wear]"; $pl

Write-Host "`n== 4. 판정"
$phoneId = $p.LocalId
$capOnWatch = $w.Caps | Where-Object { $_ -match "^uirun_phone_bridge \(노드 $phoneId" }
$queryHit = $wl | Select-String "getCapability\('uirun_phone_bridge', REACHABLE\).*$phoneId"
$ack = $wl | Select-String "ack from $phoneId"
$phoneGotMsg = $pl | Select-String 'message from'
if (-not $pc -or -not $wc) { '앱 설치 문제: 한쪽에 우이런이 없습니다.' }
elseif ($pc -ne $wc) { '서명 문제: 폰·워치 서명 인증서가 다릅니다(Data Layer가 서로를 못 봄).' }
elseif (-not ($w.Reachable | Where-Object { $_ -like "$phoneId*" })) { '페어링·연결 문제: 워치 GMS가 폰 노드에 닿지 못합니다(앱 코드와 무관).' }
elseif (-not $capOnWatch) { '폰 capability 미전파: 폰 GMS의 uirun_phone_bridge 항목이 워치에 없습니다(폰 앱 설치·리소스·동기화 확인).' }
elseif ($queryHit) { 'capability 조회 정상: 워치 앱이 getCapability로 폰 노드를 찾았습니다.' }
elseif ($ack -and ($wl | Select-String -SimpleMatch "phoneNode=$phoneId, CONNECTED")) { "페어링·전송·서명·폰 브리지 정상(직접 ping에 폰 ACK). GMS에는 capability 항목이 있으나 앱의 getCapability가 빈 목록 → 직접 ping ACK 보완으로 CONNECTED(phoneNode=$phoneId)." }
elseif ($ack) { '앱 조회 문제: GMS에는 capability가 있고 직접 ping에 폰 ACK도 오지만, 워치 앱의 getCapability 결과가 비었습니다(보완 코드가 없는 빌드).' }
elseif ($phoneGotMsg) { '폰 수신은 됨, ACK가 워치에 안 옴: ACK 전송 경로 확인.' }
else { '판정 보류: 진단 로그가 없습니다(진단 로그가 들어간 debug 빌드인지 확인).' }
