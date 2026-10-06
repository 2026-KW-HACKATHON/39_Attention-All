package com.attentionall.uirun.watch.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyColumnDefaults
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.ScrollIndicator
import androidx.wear.compose.material3.Text
import com.attentionall.uirun.watch.Conn
import com.attentionall.uirun.watch.HOLD_TO_FINISH_MS
import com.attentionall.uirun.watch.Outcome
import com.attentionall.uirun.watch.Screen
import com.attentionall.uirun.watch.Ui
import com.attentionall.uirun.watch.WatchController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// FLOW 03 화면(W0~W7-B, E1~E3, P1)의 배치를 유지한다: 위쪽 정보(작은 라벨 → 제목/숫자 → 짧은 문장), 아래쪽 행동 버튼.
// 원형 가장자리에 맞춰 좌우 여백을 두고, 글자가 커지거나 화면이 작으면 잘라내지 않고 세로로 스크롤한다(회전 입력 포함).
@Composable
fun WatchApp(ui: Ui, c: WatchController) {
    val f = rememberFonts()
    if (ui.screen in BACKABLE) BackHandler { c.back() }
    CompositionLocalProvider(LocalDemo provides ui.demo) {
    Box(Modifier.fillMaxSize().background(Brand.black)) {
        when (ui.screen) {
            Screen.W0 -> Ready(ui, c, f)
            Screen.W1 -> Choose(ui, c, f)
            Screen.W2 -> Running(ui, c, f)
            Screen.W3 -> Checkpoint(ui, c, f)
            Screen.W4B -> PhotoChoice(ui, c, f)
            Screen.W4C -> Face(f, small = "촬영 연결 요청", symbol = "↗", title = "우이런에서 찍어주세요", body = handoffText(ui)) {
                Action("운동으로 돌아가기", f, secondary = true) { c.back() }
            }
            Screen.W5A -> Face(f, small = "참여 처리 중", symbol = "…", title = "확인하고 있어요", body = "결과가 오면 알려드릴게요") {
                Action("운동 계속하기", f, secondary = true) { c.back() }
            }
            Screen.W5B -> Result(ui.result, c, f)
            Screen.W6 -> Paused(ui, c, f)
            Screen.W6C -> Face(f, small = "운동 종료", title = "운동을 끝낼까요?", body = "${km(ui.snap?.session?.distanceM ?: 0.0)}km · ${dur(c.activeMs())}") {
                Action(if (ui.pending == "FINISH") "종료 요청 중…" else "종료하고 저장", f, enabled = ui.pending == null) { c.finish() }
                Action("계속하기", f, secondary = true) { c.back() }
            }
            Screen.W7A -> Face(f, small = "운동 종료 처리", symbol = "…", title = "기록 저장 중", body = "남은 기록을 보내고 있어요\n잠시만 기다려주세요")
            Screen.W7B -> Summary(c, f)
            Screen.E1 -> Disconnected(ui, c, f)
            Screen.E2 -> PhoneHelp(ui, c, f)
            Screen.E3 -> Face(f, small = "아직 저장되지 않았어요", symbol = "!", title = "연결을 확인해주세요", body = "기록을 보관하고 있어요\n연결되면 다시 저장할 수 있어요", notice = noticeText(ui.notice)) {
                Action(if (ui.pending == "RETRY_FINISH") "다시 저장 중…" else "다시 저장", f, enabled = ui.pending == null) { c.retrySave() }
            }
            Screen.P1 -> Face(
                f,
                small = "운동 결과",
                symbol = "↗",
                title = if (ui.openFailed) "폰에서 우이런을 열어주세요" else "폰에서 확인하세요",
                body = if (ui.openFailed) "기록 탭에서 이번 운동을 볼 수 있어요" else "경로 · 상세 기록 · 인증 카드",
            ) {
                Action("처음으로", f, secondary = true) { c.home() }
            }
        }
    }
    }
}

// 개발 빌드 DEMO 데이터일 때 화면 맨 위에 DEMO를 표시한다(내용과 함께 스크롤돼 겹치지 않는다)
private val LocalDemo = staticCompositionLocalOf { false }

private val BACKABLE = setOf(Screen.W1, Screen.W3, Screen.W4B, Screen.W4C, Screen.W5A, Screen.W5B, Screen.W6C, Screen.E2, Screen.P1)

// ---------- 화면 ----------
@Composable
private fun Ready(ui: Ui, c: WatchController, f: Fonts) {
    val s = ui.snap
    val (title, body) = when {
        ui.incompatible -> "앱 버전을 맞춰주세요" to "폰과 워치의 우이런을 최신으로 업데이트해주세요"
        ui.conn == Conn.CHECKING -> "폰 확인 중" to "잠시만 기다려주세요"
        ui.conn == Conn.NO_PHONE -> "폰 연결 안 됨" to "폰과 블루투스 연결을 확인해주세요"
        ui.conn == Conn.NO_APP -> "폰에 우이런이 필요해요" to "폰에 우이런 최신 앱을 설치해주세요"
        s == null -> "폰 상태 확인 중" to "폰에서 우이런을 열면 바로 연결돼요"
        !s.signedIn || "LOGIN" in s.needs -> "로그인이 필요해요" to "폰 우이런에서 로그인해주세요"
        "CONSENT" in s.needs -> "약관 동의가 필요해요" to "폰 우이런에서 동의해주세요"
        "LOCATION_PERMISSION" in s.needs || "PRECISE_LOCATION" in s.needs -> "위치 권한이 필요해요" to "폰에서 정확한 위치를 허용해주세요"
        ui.phoneReady == false -> "폰 앱이 꺼져 있어요" to "시작하면 폰에서 우이런을 열도록 알려요"
        else -> "운동 준비 완료" to "폰 연결됨 · 위치 권한 확인됨"
    }
    val ok = ui.conn == Conn.CONNECTED && s != null && s.signedIn && s.needs.isEmpty() && !ui.incompatible
    Face(f, small = "우이런", title = title, body = body, notice = noticeText(ui.notice)) {
        Action("운동 선택", f, enabled = ok) { c.choose() }
    }
}

@Composable
private fun Choose(ui: Ui, c: WatchController, f: Fonts) {
    val busy = ui.pending == "START"
    Face(f, small = "우이런", title = "오늘도 우이천", body = if (busy) "폰에서 시작하는 중…" else null, notice = noticeText(ui.notice)) {
        Action("달리기", f, enabled = !busy) { c.start("RUN") }
        Action("산책", f, secondary = true, enabled = !busy) { c.start("WALK") }
    }
}

@Composable
private fun Running(ui: Ui, c: WatchController, f: Fonts) {
    val s = ui.snap?.session ?: return
    val tick = rememberTick()
    val ms = remember(tick, ui) { c.activeMs() }
    val walk = s.mode == "WALK"
    val label = (if (walk) "산책" else "달리기") + if (s.sync == "OFFLINE") " · 폰 오프라인" else ""
    Face(
        f,
        small = label,
        smallColor = Brand.lime,
        notice = problemText(s.problem) ?: noticeText(ui.notice),
        main = {
            if (walk) BigNumber(dur(ms), null, f) else BigNumber(km(s.distanceM), "km", f)
            Stats(listOfNotNull(if (walk) "${km(s.distanceM)}km" else dur(ms), s.paceSecPerKm?.let { pace(it) + " /km" }), f)
        },
    ) {
        Action(if (ui.pending == "PAUSE") "일시정지 중…" else "일시정지", f, secondary = true, enabled = ui.pending == null) { c.pause() }
    }
}

@Composable
private fun Paused(ui: Ui, c: WatchController, f: Fonts) {
    val s = ui.snap?.session ?: return
    Face(
        f,
        small = "일시정지됨",
        smallColor = Brand.lime,
        notice = noticeText(ui.notice),
        main = { BigNumber(km(s.distanceM), "km", f) },
    ) {
        Action(if (ui.pending == "RESUME") "다시 시작 중…" else "다시 시작", f, enabled = ui.pending == null) { c.resume() }
        HoldToFinish(f, enabled = ui.pending == null, pending = ui.pending == "FINISH", onHold = { c.finish() }, onTap = { c.askFinish() })
    }
}

@Composable
private fun Checkpoint(ui: Ui, c: WatchController, f: Fonts) {
    val a = ui.alert ?: return
    val tick = rememberTick()
    val expired = remember(tick, ui) { c.alertExpired() }
    val ex = a.exposure
    val body = when {
        expired -> "응답 시간이 지났어요"
        !ex.answerable -> "${ex.radiusM}m 안에서 ‘아직 있어요’를 남길 수 있어요"
        else -> "미선택 시 10초 뒤 운동 복귀"
    }
    Face(f, small = "체크포인트" + (ex.distanceM?.let { " · ${it}m" } ?: ""), smallColor = Brand.lime, title = ex.title.ifEmpty { "체크포인트" }, body = body, notice = noticeText(ui.notice)) {
        Action("아직 있어요", f, enabled = ex.answerable && !expired) { c.answer("PRESENT") }
        Pair(
            { m, compact -> Action("안 보여요", f, secondary = true, enabled = !expired, modifier = m, compact = compact) { c.answer("ABSENT") } },
            { m, compact -> Action("모르겠어요", f, secondary = true, enabled = !expired, modifier = m, compact = compact) { c.answer("UNKNOWN") } },
        )
    }
}

@Composable
private fun PhotoChoice(ui: Ui, c: WatchController, f: Fonts) {
    val ex = ui.alert?.exposure
    val routine = ex?.kind == "ROUTINE"
    val q = ui.quick
    val said = ANSWER[ui.answer] ?: ""
    val note = when {
        routine -> "정기 관찰 지점이에요"
        q == null || q.state == "SENDING" -> "‘$said’ 응답을 보내는 중"
        q.state == "DONE" && q.reward?.existing == true -> "오늘 이미 남긴 응답이에요"
        q.state == "DONE" -> "‘$said’ 응답을 남겼어요"
        q.state == "UNSUPPORTED" -> "‘$said’는 아직 저장되지 않아요"
        else -> "응답을 저장하지 못했어요"
    }
    val allowed = c.photoAllowed()
    Face(
        f,
        small = listOfNotNull(ex?.title?.ifEmpty { null }, ex?.distanceM?.let { "${it}m" }).joinToString(" · ").ifEmpty { "체크포인트" },
        smallColor = Brand.lime,
        title = if (routine) "사진을 남길까요?" else "사진도 남길까요?",
        body = if (allowed) note else "$note\n이 응답의 사진은 아직 보낼 수 없어요",
    ) {
        Action("우이런에서 촬영", f, enabled = allowed) { c.photo() }
        Action("사진 없이 계속하기", f, secondary = true) { c.skipPhoto() }
    }
}

@Composable
private fun Result(o: Outcome?, c: WatchController, f: Fonts) {
    val kind = if (o?.kind == "PHOTO") "사진 참여" else "간단 응답"
    val r = o?.reward
    // [small, symbol, title, reward, body]. 서버가 확정 지급한 값만 라임으로 크게 보여준다. 검토 대기·0P는 지급으로 보이지 않게 한다.
    val v: List<String?> = when {
        o == null -> listOf("참여 처리 중", "…", "확인하고 있어요", null, null)
        o.state == "DONE" && r?.existing == true -> listOf("이미 남긴 응답이에요", "✓", kind, null, "오늘 이미 남겨 새로 기록하지 않았어요")
        o.state == "DONE" && r != null && r.points > 0 && r.pending == 0 -> listOf("참여가 저장됐어요", "✓", null, "+${r.points}", "$kind · 지급 완료")
        o.state == "DONE" && r != null && (r.pending > 0 || r.reason == "PENDING_REVIEW") -> listOf("참여가 저장됐어요", "✓", "보상 검토 중", null, "$kind · 확인 뒤 적립돼요")
        o.state == "DONE" -> listOf("참여가 저장됐어요", "✓", "포인트 없음", null, reasonText(r?.reason))
        o.state == "UNSUPPORTED" -> listOf("저장되지 않았어요", "!", "아직 받지 않는 응답이에요", null, "‘안 보여요’·‘모르겠어요’는 서버 준비 전이에요")
        else -> listOf("저장하지 못했어요", "!", kind, null, failText(o.code))
    }
    // 결과가 늦게 와도 ‘돌아가기’는 지금 세션 상태로 간다(종료된 운동 화면을 다시 열지 않는다)
    Face(f, small = v[0], symbol = v[1], title = v[2], reward = v[3], body = v[4]) {
        Action("운동으로 돌아가기", f, secondary = true) { c.back() }
    }
}

@Composable
private fun Summary(c: WatchController, f: Fonts) {
    val s = c.summary() ?: return
    Face(
        f,
        small = "운동 완료",
        main = {
            BigNumber(km(s.distanceM), "km", f)
            Stats(listOfNotNull(dur(s.activeMs), s.participations?.let { "참여 ${it}회" }), f)
        },
    ) {
        Action("폰에서 결과 보기", f) { c.openResult() }
    }
}

@Composable
private fun Disconnected(ui: Ui, c: WatchController, f: Fonts) {
    val s = ui.snap?.session
    val at = if (ui.rxWall > 0) SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(ui.rxWall)) else "–"
    val last = s?.let { " · ${km(it.distanceM)}km ${dur(it.activeMs)}" } ?: ""
    Face(
        f,
        small = "연결 상태",
        symbol = "!",
        title = if (ui.conn != Conn.CONNECTED) "폰 연결이 끊겼어요" else "폰 앱이 응답하지 않아요",
        // 폰이 계속 기록하는지 확인할 수 없으므로 단정하지 않는다. 숫자는 마지막으로 받은 값이다.
        body = "폰 기록 상태를 확인할 수 없어요\n마지막 수신 $at$last",
    ) {
        Action("다시 연결", f, secondary = true) { c.reconnect() }
    }
}

@Composable
private fun PhoneHelp(ui: Ui, c: WatchController, f: Fonts) {
    val (title, body) = when (ui.help) {
        "CAMERA_PERMISSION" -> "카메라 권한이 필요해요" to "폰 우이런에서 카메라를 허용해주세요"
        "UNLOCK_NEEDED" -> "폰 잠금을 해제해주세요" to "잠금을 풀면 우이런 안에서 촬영해요"
        "PHONE_APP_NOT_RUNNING" -> "폰에서 우이런을\n열어주세요" to "열면 같은 체크포인트로 이어가요"
        "SEND_FAILED", "NOT_CONNECTED" -> "폰과 연결되지 않았어요" to "연결을 확인하고 다시 요청해주세요"
        "OPEN_FAILED" -> "폰에서 우이런을\n열어주세요" to "폰 화면을 열지 못했어요"
        else -> "폰에서 우이런을\n열어주세요" to "앱 안에서 체크포인트 촬영"
    }
    Face(f, small = "촬영 연결", symbol = "!", title = title, body = body) {
        Action("다시 요청", f) { c.photo() }
        Action("운동으로 돌아가기", f, secondary = true) { c.back() }
    }
}

// ---------- 문구 ----------
private val ANSWER = mapOf("PRESENT" to "아직 있어요", "ABSENT" to "안 보여요", "UNKNOWN" to "모르겠어요")

private fun handoffText(ui: Ui) = when (ui.snap?.photo?.stage) {
    "CAMERA_OPENED" -> "폰의 우이런 내부 카메라로 촬영"
    else -> "폰에서 우이런 촬영 화면을 여는 중"
}

private fun problemText(p: String?) = when (p) {
    null -> null
    "LOCATION_OFF" -> "폰 위치 기록이 꺼져 있어요"
    "SESSION_TRACK_LIMIT", "SESSION_EXPIRED" -> "폰에서 저장된 부분으로 마쳐주세요"
    else -> "폰에서 운동 상태를 확인해주세요"
}

fun noticeText(code: String?) = when (code) {
    null -> null
    "NOT_CONNECTED", "SEND_FAILED" -> "폰과 연결되지 않았어요"
    "NO_RESPONSE" -> "폰 응답이 없어요. 상태를 다시 받았어요"
    "PHONE_FOREGROUND_REQUIRED" -> "폰에서 우이런을 열어 시작해주세요"
    "PHONE_APP_NOT_RUNNING" -> "폰에서 우이런을 열어주세요"
    "UNAUTHENTICATED", "LOGIN_REQUIRED" -> "폰에서 로그인해주세요"
    "CONSENT_REQUIRED" -> "폰에서 약관 동의가 필요해요"
    "LOCATION_PERMISSION_REQUIRED", "LOCATION_PERMISSION_DENIED" -> "폰에서 위치 권한을 허용해주세요"
    "PRECISE_LOCATION_REQUIRED" -> "폰에서 정확한 위치를 켜주세요"
    "GPS_ACCURACY_TOO_LOW" -> "GPS 정확도가 낮아요. 잠시 뒤 다시 시도해주세요"
    "LOCATION_UNAVAILABLE", "LOCATION_STALE" -> "폰이 위치를 받지 못했어요"
    "OUTSIDE_PILOT" -> "우이천 파일럿 구간에서 시작할 수 있어요"
    "REJECTED_MOCK" -> "가짜 위치로는 시작할 수 없어요"
    "SESSION_MISMATCH", "STALE_COMMAND" -> "폰의 운동 상태가 바뀌었어요"
    "ACCOUNT_CHANGED" -> "폰 계정이 바뀌었어요"
    "EXPOSURE_EXPIRED" -> "체크포인트 응답 시간이 지났어요"
    "NETWORK", "UNAVAILABLE" -> "폰이 서버에 연결하지 못했어요"
    else -> "폰에서 처리하지 못했어요"
}

private fun failText(code: String?) = when (code) {
    "EXPOSURE_EXPIRED", "EXPIRED" -> "체크포인트 시간이 지났어요"
    "TOO_FAR" -> "체크포인트 가까이에서 다시 남겨주세요"
    "LOCATION_STALE", "LOCATION_UNAVAILABLE", "GPS_ACCURACY_TOO_LOW" -> "폰 위치를 확인하지 못했어요"
    "OWN_ISSUE_RECHECK" -> "내가 올린 제보는 재확인할 수 없어요"
    "MISSION_NOT_ACTIVE", "ISSUE_WINDOW_CLOSED" -> "지금은 참여할 수 없는 체크포인트예요"
    "SEND_FAILED", "NOT_CONNECTED" -> "폰과 연결되지 않았어요"
    "NETWORK", "UNAVAILABLE" -> "폰이 서버에 연결하지 못했어요. 폰에서 다시 시도해주세요"
    "ACCOUNT_CHANGED" -> "폰 계정이 바뀌었어요"
    else -> "폰에서 다시 확인해주세요"
}

// 서버 rewardReason(폰 core.ts REWARD와 같은 뜻, 워치용으로 짧게)
private fun reasonText(reason: String?) = when (reason) {
    "QUICK_NEW_NO_POINTS" -> "사진 없는 새 제보는 포인트가 없어요"
    "CATEGORY_NOT_REWARDED" -> "이 종류는 포인트 대상이 아니에요"
    "DAILY_CAP" -> "오늘 적립 한도를 채웠어요"
    "SUBCAP" -> "오늘 간단 응답 한도를 채웠어요"
    "NO_PHOTO_BASIS" -> "사진 근거가 없어 포인트는 없어요"
    "ALREADY_CONSUMED" -> "이미 반영된 참여예요"
    "LATE_PHOTO" -> "늦게 올린 사진이라 나만 보는 기록이에요"
    "ROUTINE_DAILY_LIMIT" -> "오늘 정기 관찰 한도를 채웠어요"
    "SUPPLEMENT_ONLY" -> "보완 사진으로 접수됐어요"
    else -> "접수됐어요"
}

// ---------- 부품 ----------
@Composable
private fun rememberTick(): Long {
    var tick by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000 - System.currentTimeMillis() % 1000)
            tick++
        }
    }
    return tick
}

@Composable
private fun Face(
    f: Fonts,
    small: String? = null,
    smallColor: Color = Brand.sub,
    symbol: String? = null,
    title: String? = null,
    reward: String? = null,
    body: String? = null,
    notice: String? = null,
    main: (@Composable ColumnScope.() -> Unit)? = null,
    actions: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val w = LocalConfiguration.current.screenWidthDp
    val state = rememberScalingLazyListState(initialCenterItemIndex = 0)
    Box(Modifier.fillMaxSize()) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = state,
        // 원형 가장자리 안쪽만 쓴다: 글자는 폭의 10%, 버튼은 14% 안쪽. 아래 여백 15%면 맨 아래 버튼(폭 72%)의 모서리가 원 안에 든다.
        contentPadding = PaddingValues(start = (w * 0.10f).dp, end = (w * 0.10f).dp, top = (w * 0.12f).dp, bottom = (w * 0.15f).dp),
        verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
        autoCentering = null,
        scalingParams = ScalingLazyColumnDefaults.scalingParams(edgeScale = 1f, edgeAlpha = 1f),
    ) {
        item {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (LocalDemo.current) Text("DEMO", color = Brand.lime, fontSize = 11.sp, fontFamily = f.num, fontWeight = FontWeight.ExtraBold)
                small?.let { Line(it, f, 12.sp, smallColor, FontWeight.SemiBold) }
                symbol?.let { Text(it, color = if (it == "!") Brand.white else Brand.lime, fontSize = 24.sp, fontFamily = f.num, fontWeight = FontWeight.ExtraBold) }
                main?.invoke(this)
                title?.let { Line(it, f, 16.sp, Brand.white, FontWeight.Bold, Modifier.semantics { heading() }) }
                reward?.let { BigNumber(it, "P", f, Brand.lime) }
                body?.let { Line(it, f, 13.sp, Brand.sub, FontWeight.SemiBold) }
                notice?.let { Line("! $it", f, 13.sp, Brand.white, FontWeight.SemiBold) }
            }
        }
        if (actions != null) item {
            Column(Modifier.fillMaxWidth().padding(top = 4.dp, start = (w * 0.04f).dp, end = (w * 0.04f).dp), verticalArrangement = Arrangement.spacedBy(6.dp), content = actions)
        }
    }
    // 작은 화면·큰 글자에서 내용이 넘치면 스크롤 위치를 보여준다(넘치지 않으면 표시되지 않는다)
    if (state.canScrollForward || state.canScrollBackward) ScrollIndicator(state, Modifier.align(Alignment.CenterEnd))
    }
}

@Composable
private fun Line(text: String, f: Fonts, size: TextUnit, color: Color, weight: FontWeight, modifier: Modifier = Modifier) =
    Text(keepAll(text), modifier, color = color, fontSize = size, lineHeight = size * 1.35f, fontFamily = f.text, fontWeight = weight, textAlign = TextAlign.Center)

// 한글을 글자 중간이 아니라 어절(띄어쓰기) 단위로 줄바꿈한다(웹 word-break: keep-all). Wear OS 3(API 30)에서도 되도록
// 어절 안 글자 사이에 WORD JOINER를 넣는다. 한 어절이 한 줄보다 길면 시스템이 그 어절만 나눈다(잘라내지 않는다).
fun keepAll(s: String) = buildString {
    s.forEachIndexed { i, c ->
        if (i > 0 && !c.isWhitespace() && !s[i - 1].isWhitespace()) append('⁠')
        append(c)
    }
}

@Composable
private fun BigNumber(value: String, unit: String?, f: Fonts, color: Color = Brand.white) {
    Row(verticalAlignment = Alignment.Bottom) {
        Text(value, color = color, fontSize = bigNumberSize() * (if (value.length > 5) 0.8f else 1f), fontFamily = f.num, fontWeight = FontWeight.ExtraBold)
        unit?.let { Text(it, Modifier.padding(start = 3.dp, bottom = 7.dp), color = Brand.sub, fontSize = 13.sp, fontFamily = f.text, fontWeight = FontWeight.SemiBold) }
    }
}

@Composable
private fun Stats(items: List<String>, f: Fonts) {
    // 좁거나 글자가 크면 다음 줄로 넘긴다(잘라내지 않는다)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
        items.forEachIndexed { i, s ->
            val hangul = s.any { it in '가'..'힣' } // 숫자 글꼴(Archivo 숫자 전용)에 한글이 없다
            Text(s, color = if (i == 0) Brand.white else Brand.sub, fontSize = if (hangul) 14.sp else 16.sp, fontFamily = if (hangul) f.text else f.num, fontWeight = if (hangul) FontWeight.Bold else FontWeight.ExtraBold, maxLines = 1)
        }
    }
}

@Composable
private fun Action(label: String, f: Fonts, secondary: Boolean = false, enabled: Boolean = true, modifier: Modifier = Modifier.fillMaxWidth(), compact: Boolean = false, onClick: () -> Unit) {
    val bg = if (secondary) Brand.deep else Brand.blue
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = 52.dp),
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = bg,
            contentColor = Brand.white,
            disabledContainerColor = bg.copy(alpha = 0.45f),
            disabledContentColor = Brand.white.copy(alpha = 0.6f),
        ),
        contentPadding = if (compact) PaddingValues(horizontal = 4.dp, vertical = 6.dp) else ButtonDefaults.ContentPadding,
    ) {
        Text(keepAll(label), Modifier.fillMaxWidth(), fontSize = if (compact) 13.sp else 14.sp, lineHeight = 18.sp, fontFamily = f.text, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
    }
}

// W3의 ‘안 보여요 / 모르겠어요’: 넓으면 한 줄에 둘, 좁거나 글자가 크면 위아래로(글자를 자르지 않는다)
@Composable
private fun Pair(a: @Composable (Modifier, Boolean) -> Unit, b: @Composable (Modifier, Boolean) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val fontScale = androidx.compose.ui.platform.LocalDensity.current.fontScale
        if (maxWidth >= 150.dp && fontScale <= 1.1f) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                a(Modifier.weight(1f), true)
                b(Modifier.weight(1f), true)
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                a(Modifier.fillMaxWidth(), false)
                b(Modifier.fillMaxWidth(), false)
            }
        }
    }
}

// W6 길게 눌러 종료: 1.2초 유지하면 종료 요청, 손을 떼면 취소. 짧게 누르거나 접근성 동작(두 번 탭)은 종료 확인 화면(W6C)을 연다.
@Composable
private fun HoldToFinish(f: Fonts, enabled: Boolean, pending: Boolean, onHold: () -> Unit, onTap: () -> Unit) {
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var holding by remember { mutableStateOf(false) }
    var fired by remember { mutableStateOf(false) }
    val label = when {
        pending -> "종료 요청 중…"
        holding -> "계속 누르면 종료"
        else -> "길게 눌러 종료"
    }
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(26.dp))
            .background(if (enabled) Brand.deep else Brand.deep.copy(alpha = 0.45f))
            .drawBehind { drawRect(Brand.blue, size = Size(size.width * progress.value, size.height)) }
            .semantics {
                role = Role.Button
                contentDescription = "$label. 종료 확인을 열려면 두 번 탭하세요"
                if (enabled) onClick("종료 확인 열기") { onTap(); true }
            }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures(
                    onPress = {
                        fired = false
                        holding = true
                        // 종료 판단은 실제 시간(delay)으로 한다. 진행 표시는 애니메이션이라 시스템 ‘애니메이션 끄기’면 바로 차지만 판단에는 영향이 없다.
                        val fill = scope.launch {
                            progress.snapTo(0f)
                            progress.animateTo(1f, tween(HOLD_TO_FINISH_MS.toInt(), easing = LinearEasing))
                        }
                        val job = scope.launch {
                            delay(HOLD_TO_FINISH_MS)
                            fired = true
                            onHold()
                        }
                        tryAwaitRelease()
                        job.cancel()
                        fill.cancel()
                        holding = false
                        scope.launch { progress.snapTo(0f) }
                    },
                    onTap = { if (!fired) onTap() }, // 짧게 누름 → 종료 확인 화면
                    onLongPress = {}, // 길게 누르다 1.2초 전에 떼면 아무것도 하지 않는다(취소)
                )
            }
            .padding(horizontal = 12.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(keepAll(label), color = Brand.white, fontSize = 14.sp, fontFamily = f.text, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
    }
}
