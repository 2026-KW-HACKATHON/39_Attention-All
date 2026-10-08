package com.attentionall.uirun.watch

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

const val W3_TIMEOUT_MS = 30_000L // 체크포인트 알림 미선택 시 운동 화면 복귀(실제 타이머)
const val HOLD_TO_FINISH_MS = 1_200L
internal const val ACK_RETRY_MS = 3_000L
internal const val COMMAND_GIVE_UP_MS = 12_000L
internal const val HELLO_EVERY_MS = 10_000L
internal const val PHONE_SILENT_MS = 25_000L
internal const val PHOTO_ACK_WAIT_MS = 5_000L
internal const val CAMERA_WAIT_MS = 12_000L

// 화면 ID는 FLOW 03(docs/wear/uirun_watch_flow_v03.html)과 같다. W6C는 길게 누르기 대신 쓰는 종료 확인.
enum class Screen { W0, W1, W2, W3, W4B, W4C, W5A, W5B, W6, W6C, W7A, W7B, E1, E2, E3, P1 }

private enum class Route { CHOOSE, ALERT, PHOTO, HANDOFF, VERIFY, RESULT, HELP, CONFIRM_FINISH, PHONE_RESULT }

data class Alert(val exposure: Exposure, val deadline: Long, val expiresAt: Long)

// kind: QUICK | PHOTO, state: SENDING | DONE | FAILED | UNSUPPORTED
data class Outcome(val kind: String, val state: String, val code: String?, val reward: Reward?)

data class Ui(
    val screen: Screen = Screen.W0,
    val snap: Snapshot? = null,
    val conn: Conn = Conn.CHECKING,
    val phoneReady: Boolean? = null,
    val rxWall: Long = 0, // 마지막 수신(워치 시각, 표시용)
    val pending: String? = null, // 폰 확인을 기다리는 명령 종류
    val notice: String? = null, // 짧은 안내 코드(거절·연결)
    val alert: Alert? = null,
    val answer: String? = null,
    val quick: Outcome? = null,
    val result: Outcome? = null,
    val help: String? = null, // E2 원인
    val openFailed: Boolean = false,
    val demo: Boolean = false,
    val incompatible: Boolean = false,
)

private data class Pending(val id: String, val type: String, val json: String, val firstAt: Long, val acked: Boolean = false)

/**
 * 워치 화면 상태. 폰 스냅샷(권위) + 사용자가 연 화면(route)을 합쳐 지금 화면을 정한다.
 * - 오래된 스냅샷(epoch·revision이 작거나 같음)은 버린다. epoch가 바뀌면 이전 계정 상태를 모두 비운다.
 * - 상태 변경 명령은 연결됐을 때만 보내고, 같은 ID로 제한적으로 재전송한다. 화면은 ACK·스냅샷으로만 바뀐다.
 * - W3 타이머는 최초 표시 시각 기준 30초. 스냅샷 갱신·재구성으로 늘어나지 않고, 화면을 떠나면 취소된다. 시간이 다 되면 아무 응답도 보내지 않는다.
 */
class WatchController(
    private val link: PhoneLink,
    private val scope: CoroutineScope,
    private val clock: () -> Long, // 단조 시계(elapsedRealtime)
    private val wall: () -> Long = System::currentTimeMillis,
    private val book: AlertBook = AlertBook(),
    private val newId: () -> String = { UUID.randomUUID().toString() },
    private val onAlert: () -> Unit = {},
) {
    private val _ui = MutableStateFlow(Ui(demo = link.demo))
    val ui: StateFlow<Ui> = _ui

    private var snap: Snapshot? = null
    private var rxAt = 0L
    private var rxWall = 0L
    private var conn = Conn.CHECKING
    private var phoneReady: Boolean? = null
    private var lastAckAt = 0L
    private var visible = false
    private var incompatible = false

    private var route: Route? = null
    private var pending: Pending? = null
    private var notice: String? = null
    private var alert: Alert? = null
    private var answer: String? = null
    private var quickId: String? = null
    private var quickFail: String? = null
    private var photoId: String? = null
    private var photoFor: String? = null
    private var help: String? = null
    private var resultKind: String? = null
    private val awaiting = mutableSetOf<String>() // 결과가 오면 W5-B로 알려줄 종류
    private var dismissed: String? = null
    private var openFailed = false
    private val ackWaiters = mutableMapOf<String, CompletableDeferred<Ack>>()

    private var alertJob: Job? = null
    private var retryJob: Job? = null
    private var handoffJob: Job? = null
    private var helloJob: Job? = null

    fun start() {
        scope.launch { link.snapshots.collect { onSnapshot(it) } }
        scope.launch { link.acks.collect { onAck(it) } }
        scope.launch {
            link.conn.collect {
                conn = it
                if (it != Conn.CONNECTED) phoneReady = null
                render()
            }
        }
        link.start()
    }

    // 표시용 활동 시간: 폰 값 + (ACTIVE이고 연결돼 있으면) 수신 후 워치 단조 시계 경과. 일시정지·종료·끊김이면 늘리지 않는다.
    // 새 스냅샷이 전달 지연만큼 작은 값을 가져와도 ACTIVE 중에는 표시가 뒤로 가지 않게 한다.
    fun activeMs(): Long {
        val s = snap?.session ?: return 0
        if (s.status != RunStatus.ACTIVE || !linked()) return s.activeMs.also { shown = null }
        val v = s.activeMs + (clock() - rxAt).coerceAtLeast(0)
        val prev = shown?.takeIf { it.first == s.sessionId }?.second ?: 0
        return maxOf(v, prev).also { shown = s.sessionId to it }
    }
    private var shown: Pair<String, Long>? = null

    fun summary(): Summary? = snap?.let { s -> s.session?.takeIf { it.status == RunStatus.ENDED }?.result ?: s.last }

    fun setVisible(v: Boolean) {
        if (visible == v) return
        visible = v
        WatchVisibility.visible = v
        helloJob?.cancel()
        if (v) {
            lastAckAt = clock()
            helloJob = scope.launch {
                while (true) {
                    hello()
                    delay(HELLO_EVERY_MS)
                    if (conn == Conn.CONNECTED && clock() - lastAckAt > PHONE_SILENT_MS && phoneReady != false) {
                        phoneReady = false // 폰 앱이 답하지 않는다: 기록 상태를 단정하지 않는다(E1)
                        render()
                    }
                }
            }
            maybeAlert()
        } else {
            scope.launch { link.send(command("HELLO", newId(), snap?.epoch, "visible" to false)) }
            // 화면을 떠나면 W3 타이머를 취소한다(응답 없음으로 끝낸다)
            if (route == Route.ALERT || (route == Route.PHOTO && answer == null)) closeAlert()
        }
        render()
    }

    fun reconnect() {
        scope.launch {
            link.refresh()
            hello()
        }
    }

    private suspend fun hello() {
        if (!link.send(command("HELLO", newId(), snap?.epoch, "visible" to visible))) link.refresh()
    }

    // ---------- 스냅샷·ACK ----------
    internal fun onSnapshot(json: String) {
        val s = Snapshot.parse(json)
        if (s == null || s.v != PROTOCOL_VERSION) {
            incompatible = s != null
            render()
            return
        }
        incompatible = false
        val cur = snap
        if (cur != null && (s.epoch < cur.epoch || (s.epoch == cur.epoch && s.revision <= cur.revision))) return // 늦게 온 이전 상태
        if (cur != null && s.epoch != cur.epoch) wipe()
        snap = s
        rxAt = clock()
        rxWall = wall()
        // 최신 폰 상태를 실제로 받았을 때만 이전 통신 실패 안내를 지운다.
        // 서버가 거절한 명령의 이유는 연결 회복만으로 없애지 않는다.
        if (notice in setOf("NO_RESPONSE", "SEND_FAILED", "NOT_CONNECTED")) notice = null
        settlePending()
        trackPhoto()
        alert?.let { a -> s.exposure?.takeIf { it.id == a.exposure.id }?.let { alert = a.copy(exposure = it) } } // 거리·응답 가능만 갱신, deadline 유지
        maybeAlert()
        render()
    }

    internal fun onAck(json: String) {
        val a = Ack.parse(json) ?: return
        if (a.jsReady != null) {
            phoneReady = a.jsReady
            lastAckAt = clock()
        }
        ackWaiters.remove(a.id)?.complete(a)
        if (a.id == quickId && a.status == "REJECTED") quickFail = a.code ?: "REJECTED"
        val p = pending
        if (p != null && a.id == p.id) {
            when (a.status) {
                "REJECTED", "NEEDS_PHONE" -> {
                    pending = null
                    notice = a.code ?: a.status
                    if (a.status == "NEEDS_PHONE" && p.type == "START" && !a.opened) {
                        scope.launch { if (!link.open("uirun://")) { notice = "OPEN_FAILED"; render() } }
                    }
                }
                "DONE" -> if (p.type == "RETRY_FINISH") pending = null else pending = p.copy(acked = true)
                "RECEIVED" -> pending = p.copy(acked = true)
            }
        }
        render()
    }

    private fun wipe() {
        route = null
        pending = null
        notice = null
        closeAlert()
        quickId = null
        quickFail = null
        photoId = null
        photoFor = null
        help = null
        awaiting.clear()
        dismissed = null
        handoffJob?.cancel()
        retryJob?.cancel()
        book.clear()
    }

    private fun settlePending() {
        val p = pending ?: return
        val sess = snap?.session
        val done = when (p.type) {
            "START" -> sess != null && sess.status != RunStatus.ENDED // 폰이 만든(또는 이미 진행 중이던) 그 세션
            "PAUSE" -> sess == null || sess.status != RunStatus.ACTIVE
            "RESUME" -> sess == null || sess.status != RunStatus.PAUSED
            "FINISH" -> sess == null || sess.status == RunStatus.ENDING || sess.status == RunStatus.ENDED
            else -> false
        }
        if (done) {
            pending = null
            retryJob?.cancel()
            if (p.type == "START") route = null
        }
    }

    // ---------- 명령 ----------
    fun choose() {
        if (base() == Screen.W0) {
            route = Route.CHOOSE
            notice = null
            render()
        }
    }

    fun back() {
        if (route == Route.ALERT || route == Route.PHOTO) closeAlert()
        route = null
        notice = null
        render()
    }

    fun start(mode: String) = issue("START", "mode" to mode)
    fun pause() = session("PAUSE")
    fun resume() = session("RESUME")
    fun askFinish() {
        if (base() == Screen.W6) {
            route = Route.CONFIRM_FINISH
            render()
        }
    }
    fun finish() = session("FINISH")
    fun retrySave() = session("RETRY_FINISH")

    private fun session(type: String) {
        val s = snap ?: return
        val id = s.session?.sessionId ?: return
        issue(type, "sessionId" to id, "revision" to s.revision)
    }

    private fun issue(type: String, vararg extra: Pair<String, Any?>) {
        if (pending != null) return // 중복 누르기는 한 요청으로
        if (conn != Conn.CONNECTED) {
            notice = "NOT_CONNECTED"
            render()
            return
        }
        val id = newId()
        val json = command(type, id, snap?.epoch, *extra)
        val p = Pending(id, type, json, clock())
        pending = p
        notice = null
        if (route == Route.CONFIRM_FINISH) route = null
        render()
        retryJob?.cancel()
        retryJob = scope.launch {
            var tries = 0
            while (true) {
                val cur = pending?.takeIf { it.id == id } ?: return@launch
                if (!cur.acked && tries < 3) {
                    tries++
                    if (!link.send(json)) return@launch fail(id, "SEND_FAILED")
                }
                delay(ACK_RETRY_MS)
                if (clock() - p.firstAt >= COMMAND_GIVE_UP_MS) {
                    val acked = pending?.takeIf { it.id == id }?.acked == true
                    fail(id, if (acked) null else "NO_RESPONSE")
                    hello() // 같은 세션 상태를 다시 받아 맞춘다(명령을 새로 만들지 않는다)
                    return@launch
                }
            }
        }
    }

    private fun fail(id: String, code: String?) {
        if (pending?.id != id) return
        pending = null
        notice = code
        render()
    }

    // ---------- 체크포인트(W3 → W4-B → W4-C/W5) ----------
    private fun maybeAlert() {
        val s = snap ?: return
        val ex = s.exposure ?: return
        if (!visible || s.session?.status != RunStatus.ACTIVE || !linked()) return
        if (book.seen(s.epoch, ex.id) || alert?.exposure?.id == ex.id || ex.expiresInMs <= 0) return
        if (route != null && route != Route.VERIFY && route != Route.RESULT) return // 다른 체크포인트 흐름 중이면 기다린다
        book.mark(s.epoch, ex.id)
        val now = clock()
        alert = Alert(ex, now + W3_TIMEOUT_MS, rxAt + ex.expiresInMs)
        answer = null
        quickId = null
        quickFail = null
        route = if (ex.kind == "ISSUE") Route.ALERT else Route.PHOTO // 정기 관찰은 상태 응답 없이 사진 선택
        onAlert()
        alertJob?.cancel()
        alertJob = scope.launch {
            delay(W3_TIMEOUT_MS)
            if (route == Route.ALERT || (route == Route.PHOTO && answer == null)) { // 무응답: 아무것도 보내지 않는다
                closeAlert()
                route = null
                render()
            }
        }
        scope.launch { link.send(command("ALERT_SHOWN", newId(), s.epoch, "exposureId" to ex.id)) }
    }

    private fun closeAlert() {
        alertJob?.cancel()
        alertJob = null
        if (route == Route.ALERT || route == Route.PHOTO) route = null
    }

    fun alertExpired() = alert?.let { clock() >= it.expiresAt } ?: true

    fun answer(choice: String) {
        val a = alert ?: return
        if (route != Route.ALERT || quickId != null) return // 응답은 한 번만
        if (alertExpired()) {
            notice = "EXPOSURE_EXPIRED" // 실제 노출이 먼저 만료되면 남은 30초와 관계없이 제출하지 않는다
            render()
            return
        }
        if (choice == "PRESENT" && !a.exposure.answerable) return
        if (conn != Conn.CONNECTED) {
            notice = "NOT_CONNECTED"
            render()
            return
        }
        alertJob?.cancel()
        answer = choice
        val id = newId()
        quickId = id
        quickFail = null
        route = Route.PHOTO
        render()
        val json = command("QUICK", id, snap?.epoch, "sessionId" to snap?.session?.sessionId, "exposureId" to a.exposure.id, "answer" to choice)
        scope.launch {
            if (!link.send(json) && quickId == id) {
                quickFail = "SEND_FAILED"
                render()
            }
        }
    }

    // 사진은 상태 응답이 ‘아직 있어요’(또는 정기 관찰)일 때만 기존 사진 재확인으로 이어간다. 안 보여요·모르겠어요 사진은 서버 계약이 없다.
    fun photoAllowed() = alert?.exposure?.kind == "ROUTINE" || answer == "PRESENT"

    fun skipPhoto() {
        alertJob?.cancel()
        val q = quickOutcome()
        route = when {
            q == null -> null
            q.state == "SENDING" -> {
                awaiting += "QUICK"
                resultKind = "QUICK"
                Route.VERIFY
            }
            else -> {
                resultKind = "QUICK"
                Route.RESULT
            }
        }
        render()
    }

    fun photo() {
        val a = alert ?: return
        val s = snap ?: return
        if (!photoAllowed()) return
        alertJob?.cancel()
        if (alertExpired()) return showHelp("EXPIRED")
        if (conn != Conn.CONNECTED) return showHelp("NOT_CONNECTED")
        // 다시 요청은 같은 요청 ID(폰이 같은 촬영으로 이어간다 — 중복 제출 없음)
        val id = photoId?.takeIf { photoFor == a.exposure.id } ?: newId().also {
            photoId = it
            photoFor = a.exposure.id
        }
        awaiting += "PHOTO"
        route = Route.HANDOFF
        help = null
        render()
        val waiter = CompletableDeferred<Ack>().also { ackWaiters[id] = it }
        handoffJob?.cancel()
        handoffJob = scope.launch {
            // 폰이 이미 카메라를 열었거나(사용자가 폰에서 직접 연 경우 포함) 사용자가 화면을 떠났으면 안내를 띄우지 않는다
            fun stuck(code: String) {
                if (route == Route.HANDOFF && photoStage() in listOf(null, "PHONE_RECEIVED")) showHelp(code)
            }
            val json = command("PHOTO", id, s.epoch, "sessionId" to s.session?.sessionId, "exposureId" to a.exposure.id, "answer" to answer)
            if (!link.send(json)) return@launch stuck("SEND_FAILED")
            val ack = withTimeoutOrNull(PHOTO_ACK_WAIT_MS) { waiter.await() } ?: return@launch stuck("NO_RESPONSE")
            if (ack.status == "REJECTED") return@launch stuck(ack.code ?: "REJECTED")
            // 폰 앱이 꺼져 있으면(NEEDS_PHONE) 폰이 요청을 보관했다. 원격 열기로 앱을 띄우면 그 요청으로 이어간다.
            if (!ack.opened && !link.open("uirun://wear-capture?req=$id")) return@launch stuck("OPEN_FAILED")
            delay(CAMERA_WAIT_MS)
            stuck(if (ack.phoneLocked) "UNLOCK_NEEDED" else "NOT_OPENED")
        }
    }

    private fun showHelp(code: String) {
        if (code == "EXPIRED" || code == "EXPOSURE_EXPIRED" || code == "HANDOFF_EXPIRED") {
            // 만료: 같은 촬영을 이어갈 수 없다. 안내 후 운동으로 돌아간다(새 요청을 만들지 않는다)
            awaiting -= "PHOTO"
            resultKind = "PHOTO"
            help = "EXPIRED"
            route = Route.RESULT
        } else {
            help = code
            route = Route.HELP
        }
        render()
    }

    private fun photoStage() = photoId?.let { id -> snap?.photo?.takeIf { it.requestId == id }?.stage }

    private fun trackPhoto() {
        when (photoStage()) {
            "CAMERA_PERMISSION" -> if (route == Route.HANDOFF) {
                help = "CAMERA_PERMISSION"
                route = Route.HELP
            }
            "CAMERA_OPENED" -> if (route == Route.HELP) route = Route.HANDOFF // 사용자가 폰에서 직접 연 경우
            "SUBMITTED" -> if (route == Route.HANDOFF || route == Route.HELP) {
                resultKind = "PHOTO"
                route = Route.VERIFY
            }
            "CANCELLED" -> if (route == Route.HANDOFF || route == Route.HELP) {
                awaiting -= "PHOTO" // 촬영 취소: 운동은 계속, 포인트 없음
                route = null
            }
        }
    }

    private fun quickOutcome(): Outcome? {
        val id = quickId ?: return null
        val q = snap?.quick?.takeIf { it.commandId == id }
        return when {
            q != null -> Outcome("QUICK", q.state, q.code, q.reward)
            quickFail != null -> Outcome("QUICK", "FAILED", quickFail, null)
            else -> Outcome("QUICK", "SENDING", null, null)
        }
    }

    private fun photoOutcome(): Outcome? {
        val id = photoId ?: return null
        val p = snap?.photo?.takeIf { it.requestId == id }
        return when (p?.stage) {
            "SERVER_RESULT" -> Outcome("PHOTO", "DONE", p.code, p.reward)
            "FAILED", "EXPIRED" -> Outcome("PHOTO", "FAILED", p.code ?: p.stage, null)
            "CANCELLED" -> Outcome("PHOTO", "CANCELLED", null, null)
            else -> if (help == "EXPIRED") Outcome("PHOTO", "FAILED", "EXPIRED", null) else Outcome("PHOTO", "SENDING", null, null)
        }
    }

    // 늦게 도착한 결과: 지금 운동 화면(또는 확인 중 화면)이면 W5-B로 한 번 알린다. 다른 체크포인트 흐름은 끊지 않는다.
    private fun popResults() {
        if (route != null && route != Route.VERIFY && route != Route.HANDOFF) return
        for (kind in awaiting.toList()) {
            val o = (if (kind == "QUICK") quickOutcome() else photoOutcome()) ?: continue
            if (o.state == "SENDING") continue
            awaiting -= kind
            if (o.state == "CANCELLED") continue // 촬영 취소는 결과 화면 없이 운동 계속
            resultKind = kind
            route = Route.RESULT
            return
        }
    }

    // ---------- 종료 결과 ----------
    fun openResult() {
        val sum = summary() ?: return
        scope.launch {
            openFailed = !link.open("uirun://record/${sum.sessionId}") // 폰이 그 계정의 기록인지 다시 확인한다
            route = Route.PHONE_RESULT
            render()
        }
    }

    fun home() {
        dismissed = summary()?.sessionId
        route = null
        render()
    }

    // ---------- 화면 결정 ----------
    private fun linked() = conn == Conn.CONNECTED && phoneReady != false

    private fun base(): Screen {
        val s = snap ?: return Screen.W0
        val sess = s.session
        if (sess != null && sess.status != RunStatus.ENDED && !linked()) return Screen.E1
        return when (sess?.status) {
            RunStatus.ACTIVE -> Screen.W2
            RunStatus.PAUSED -> Screen.W6
            RunStatus.ENDING -> if (sess.sync == "OFFLINE") Screen.E3 else Screen.W7A
            else -> if (summary()?.let { it.sessionId != dismissed } == true) Screen.W7B else Screen.W0
        }
    }

    private fun allowed(r: Route, b: Screen) = when (r) {
        Route.CHOOSE -> b == Screen.W0
        Route.ALERT, Route.PHOTO, Route.HANDOFF, Route.HELP -> b == Screen.W2 || b == Screen.W6
        Route.CONFIRM_FINISH -> b == Screen.W6
        Route.VERIFY, Route.RESULT -> b in listOf(Screen.W2, Screen.W6, Screen.W7A, Screen.W7B, Screen.E3)
        Route.PHONE_RESULT -> b == Screen.W7B
    }

    private fun render() {
        popResults()
        val b = base()
        route?.let { r ->
            if (!allowed(r, b)) {
                if (r == Route.ALERT || r == Route.PHOTO) closeAlert()
                route = null
            }
        }
        val screen = when (route) {
            null -> b
            Route.CHOOSE -> Screen.W1
            Route.ALERT -> Screen.W3
            Route.PHOTO -> Screen.W4B
            Route.HANDOFF -> Screen.W4C
            Route.VERIFY -> Screen.W5A
            Route.RESULT -> Screen.W5B
            Route.HELP -> Screen.E2
            Route.CONFIRM_FINISH -> Screen.W6C
            Route.PHONE_RESULT -> Screen.P1
        }
        if (route == null && awaiting.isEmpty()) alert = null
        if (screen != _ui.value.screen) android.util.Log.i("UirunWatch", "screen ${screen.name}") // 화면 ID만(위치·계정 없음). 실기기 시간 확인용
        _ui.value = Ui(
            screen = screen,
            snap = snap,
            conn = conn,
            phoneReady = phoneReady,
            rxWall = rxWall,
            pending = pending?.type,
            notice = notice,
            alert = alert,
            answer = answer,
            quick = quickOutcome(),
            result = if (resultKind == "PHOTO") photoOutcome() else quickOutcome(),
            help = help,
            openFailed = openFailed,
            demo = link.demo,
            incompatible = incompatible,
        )
    }
}
