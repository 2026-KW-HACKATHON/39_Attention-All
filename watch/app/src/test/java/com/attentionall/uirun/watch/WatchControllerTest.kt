package com.attentionall.uirun.watch

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// 가짜 전송(fake transport)으로 상태 규칙만 결정적으로 검증한다. 실제 Data Layer 연결 확인과는 별개다.
private class FakeLink : PhoneLink {
    override val demo = false
    override val conn = MutableStateFlow(Conn.CONNECTED)
    override val snapshots = MutableSharedFlow<String>(extraBufferCapacity = 8)
    override val acks = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val sent = mutableListOf<JSONObject>()
    val opened = mutableListOf<String>()
    var openOk = true
    var answerHello = true
    override fun start() {}
    override fun stop() {}
    override suspend fun refresh() {}
    override suspend fun send(json: String): Boolean {
        if (conn.value != Conn.CONNECTED) return false
        val o = JSONObject(json)
        sent += o
        if (o.getString("type") == "HELLO" && answerHello) acks.tryEmit(ack(o.getString("id"), "DONE", jsReady = true)) // 살아 있는 폰 앱
        return true
    }
    override suspend fun open(uri: String): Boolean = openOk.also { opened += uri }
    fun sentOf(type: String) = sent.filter { it.getString("type") == type }
}

private fun snap(
    rev: Long,
    status: String? = "ACTIVE",
    epoch: Long = 1,
    activeMs: Long = 60_000,
    exposure: String? = null,
    expiresInMs: Long = 600_000,
    sync: String = "OK",
    quick: JSONObject? = null,
    photo: JSONObject? = null,
    result: Boolean = false,
): String {
    val o = JSONObject().put("v", 1).put("epoch", epoch).put("revision", rev).put("observedAt", 0)
        .put("account", JSONObject().put("signedIn", true).put("needs", org.json.JSONArray()))
    if (status != null) {
        o.put(
            "session",
            JSONObject().put("sessionId", "s1").put("status", status).put("mode", "RUN").put("distanceM", 1234.5).put("activeMs", activeMs)
                .put("paceSecPerKm", 300).put("sync", sync)
                .put("result", if (result) JSONObject().put("sessionId", "s1").put("distanceM", 1300.0).put("activeMs", 70_000).put("participations", 1) else JSONObject.NULL),
        )
    }
    if (exposure != null) {
        o.put("exposure", JSONObject().put("id", exposure).put("kind", "ISSUE").put("title", "수면 거품").put("distanceM", 20).put("answerable", true).put("radiusM", 40).put("expiresInMs", expiresInMs))
    }
    quick?.let { o.put("quick", it) }
    photo?.let { o.put("photo", it) }
    return o.toString()
}

private fun ack(id: String, status: String, code: String? = null, jsReady: Boolean? = null, opened: Boolean = false) =
    JSONObject().put("v", 1).put("id", id).put("status", status).apply {
        code?.let { put("code", it) }
        jsReady?.let { put("jsReady", it) }
        put("opened", opened)
    }.toString()

@OptIn(ExperimentalCoroutinesApi::class)
class WatchControllerTest {
    private fun TestScope.setup(visible: Boolean = true): Pair<WatchController, FakeLink> {
        val link = FakeLink()
        var n = 0
        val c = WatchController(link, backgroundScope, { testScheduler.currentTime }, { 0L }, AlertBook(), { "id${++n}" })
        c.start()
        runCurrent()
        if (visible) c.setVisible(true)
        runCurrent()
        return c to link
    }

    @Test
    fun w3_stays_until_9999ms_and_returns_at_10s_without_submitting() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, exposure = "ex1"))
        assertEquals(Screen.W3, c.ui.value.screen)
        advanceTimeBy(9_999)
        runCurrent()
        assertEquals(Screen.W3, c.ui.value.screen)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(Screen.W2, c.ui.value.screen)
        assertTrue("시간 초과는 아무 응답도 보내지 않는다", link.sentOf("QUICK").isEmpty())
        assertEquals(1, link.sentOf("ALERT_SHOWN").size)
    }

    @Test
    fun w3_deadline_is_not_extended_by_snapshot_updates_and_not_shown_twice() = runTest {
        val (c, _) = setup()
        c.onSnapshot(snap(1, exposure = "ex1"))
        advanceTimeBy(5_000)
        c.onSnapshot(snap(2, exposure = "ex1", activeMs = 65_000))
        advanceTimeBy(4_000)
        c.onSnapshot(snap(3, exposure = "ex1", activeMs = 69_000))
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(Screen.W2, c.ui.value.screen)
        c.onSnapshot(snap(4, exposure = "ex1"))
        assertEquals("같은 exposureId는 다시 띄우지 않는다", Screen.W2, c.ui.value.screen)
    }

    @Test
    fun answering_before_10s_cancels_the_auto_return() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, exposure = "ex1"))
        advanceTimeBy(3_000)
        c.answer("PRESENT")
        runCurrent()
        advanceTimeBy(20_000)
        runCurrent()
        assertEquals(Screen.W4B, c.ui.value.screen)
        val q = link.sentOf("QUICK").single()
        assertEquals("PRESENT", q.getString("answer"))
        assertEquals("ex1", q.getString("exposureId"))
        c.answer("PRESENT")
        runCurrent()
        assertEquals("응답은 한 번만 만든다", 1, link.sentOf("QUICK").size)
    }

    @Test
    fun leaving_the_screen_cancels_w3_and_sends_nothing() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, exposure = "ex1"))
        c.setVisible(false)
        runCurrent()
        advanceTimeBy(15_000)
        c.setVisible(true)
        runCurrent()
        assertEquals(Screen.W2, c.ui.value.screen)
        assertTrue(link.sentOf("QUICK").isEmpty())
    }

    @Test
    fun absent_and_unknown_are_sent_as_is_and_never_as_present_and_block_photo() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, exposure = "ex1"))
        c.answer("ABSENT")
        runCurrent()
        val sentQuick = link.sentOf("QUICK").single()
        assertEquals("ABSENT", sentQuick.getString("answer"))
        assertTrue(!c.photoAllowed())
        val q = JSONObject().put("commandId", sentQuick.getString("id")).put("exposureId", "ex1").put("answer", "ABSENT").put("state", "UNSUPPORTED").put("code", "ANSWER_NOT_SUPPORTED")
        c.onSnapshot(snap(2, exposure = "ex1", quick = q))
        c.photo()
        runCurrent()
        assertTrue(link.sentOf("PHOTO").isEmpty())
        c.skipPhoto()
        assertEquals(Screen.W5B, c.ui.value.screen)
        assertEquals("UNSUPPORTED", c.ui.value.result?.state)
    }

    @Test
    fun expired_exposure_blocks_submission_even_with_time_left() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, exposure = "ex1", expiresInMs = 3_000))
        advanceTimeBy(3_000)
        c.answer("PRESENT")
        runCurrent()
        assertTrue(link.sentOf("QUICK").isEmpty())
        assertEquals(Screen.W3, c.ui.value.screen)
    }

    @Test
    fun stale_snapshots_are_ignored_and_epoch_change_wipes_previous_account() = runTest {
        val (c, _) = setup()
        c.onSnapshot(snap(5, status = "PAUSED"))
        c.onSnapshot(snap(4, status = "ACTIVE"))
        assertEquals("늦게 온 이전 revision으로 되돌아가지 않는다", Screen.W6, c.ui.value.screen)
        c.onSnapshot(snap(5, status = "ACTIVE"))
        assertEquals(Screen.W6, c.ui.value.screen)
        c.onSnapshot(snap(1, status = "ACTIVE", epoch = 0))
        assertEquals("이전 계정 세대는 버린다", Screen.W6, c.ui.value.screen)
        c.onSnapshot(snap(1, status = null, epoch = 2))
        assertEquals(Screen.W0, c.ui.value.screen)
        assertNull(c.ui.value.snap?.session)
    }

    @Test
    fun start_is_one_request_and_w2_waits_for_phone_snapshot_not_the_ack() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, status = null))
        c.choose()
        c.start("RUN")
        c.start("WALK")
        runCurrent()
        val starts = link.sentOf("START")
        assertEquals(1, starts.size)
        c.onAck(ack(starts[0].getString("id"), "DONE"))
        assertEquals("ACK만으로 W2를 시작하지 않는다", Screen.W1, c.ui.value.screen)
        c.onSnapshot(snap(2, status = "ACTIVE"))
        assertEquals(Screen.W2, c.ui.value.screen)
        assertNull(c.ui.value.pending)
    }

    @Test
    fun rejected_start_shows_reason_and_frees_the_button() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, status = null))
        c.choose()
        c.start("RUN")
        runCurrent()
        c.onAck(ack(link.sentOf("START")[0].getString("id"), "NEEDS_PHONE", "PHONE_FOREGROUND_REQUIRED"))
        assertEquals(Screen.W1, c.ui.value.screen)
        assertEquals("PHONE_FOREGROUND_REQUIRED", c.ui.value.notice)
        assertNull(c.ui.value.pending)
    }

    @Test
    fun lost_ack_retries_with_same_id_then_gives_up() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, status = "ACTIVE"))
        c.pause()
        runCurrent()
        advanceTimeBy(ACK_RETRY_MS * 2)
        runCurrent()
        val pauses = link.sentOf("PAUSE")
        assertEquals(3, pauses.size)
        assertEquals(1, pauses.map { it.getString("id") }.toSet().size)
        assertEquals("s1", pauses[0].getString("sessionId"))
        advanceTimeBy(COMMAND_GIVE_UP_MS)
        runCurrent()
        assertEquals(3, link.sentOf("PAUSE").size)
        assertNull(c.ui.value.pending)
        assertEquals("NO_RESPONSE", c.ui.value.notice)
    }

    @Test
    fun fresh_snapshot_clears_timeout_notice_but_stale_state_and_hello_do_not() = runTest {
        val (c, _) = setup()
        c.onSnapshot(snap(1))
        c.pause()
        runCurrent()
        advanceTimeBy(COMMAND_GIVE_UP_MS + ACK_RETRY_MS)
        runCurrent()
        assertEquals("NO_RESPONSE", c.ui.value.notice)
        c.onAck(ack("hello-recovered", "DONE", jsReady = true))
        assertEquals("응답만으로는 조작 결과를 확정하지 않는다", "NO_RESPONSE", c.ui.value.notice)
        c.onSnapshot(snap(1))
        assertEquals("NO_RESPONSE", c.ui.value.notice)
        c.onSnapshot(snap(2, status = "PAUSED"))
        assertNull(c.ui.value.notice)
        assertEquals(Screen.W6, c.ui.value.screen)
    }

    @Test
    fun connection_recovery_keeps_the_server_rejection_reason() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, status = null))
        c.choose()
        c.start("RUN")
        runCurrent()
        c.onAck(ack(link.sentOf("START").single().getString("id"), "REJECTED", "PILOT_NOT_CONFIGURED"))
        c.onSnapshot(snap(2, status = null))
        assertEquals("PILOT_NOT_CONFIGURED", c.ui.value.notice)
    }

    @Test
    fun home_dismisses_completed_run_without_opening_the_phone() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, status = "ENDED", result = true))
        assertEquals(Screen.W7B, c.ui.value.screen)
        c.home()
        assertEquals(Screen.W0, c.ui.value.screen)
        assertTrue(link.opened.isEmpty())
        c.onSnapshot(snap(2, status = "ENDED", result = true))
        assertEquals(Screen.W0, c.ui.value.screen)
    }

    @Test
    fun disconnected_shows_e1_freezes_time_and_sends_no_commands() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, status = "ACTIVE", activeMs = 60_000))
        link.conn.value = Conn.NO_PHONE
        runCurrent()
        assertEquals(Screen.E1, c.ui.value.screen)
        advanceTimeBy(30_000)
        assertEquals("끊긴 동안은 마지막 수치", 60_000, c.activeMs())
        c.pause()
        runCurrent()
        assertTrue(link.sentOf("PAUSE").isEmpty())
        link.conn.value = Conn.CONNECTED
        runCurrent()
        assertEquals("연결이 돌아오면 최신 스냅샷으로, 명령 자동 재실행 없음", Screen.W2, c.ui.value.screen)
        assertTrue(link.sentOf("PAUSE").isEmpty())
    }

    @Test
    fun phone_app_not_answering_is_unknown_state_not_recording() = runTest {
        val (c, _) = setup()
        c.onSnapshot(snap(1, status = "ACTIVE"))
        c.onAck(ack("hello", "DONE", jsReady = false))
        assertEquals(Screen.E1, c.ui.value.screen)
    }

    @Test
    fun silent_phone_becomes_unknown_after_timeout() = runTest {
        val (c, link) = setup()
        link.answerHello = false
        c.onSnapshot(snap(1, status = "ACTIVE"))
        advanceTimeBy(PHONE_SILENT_MS)
        runCurrent()
        assertEquals(Screen.W2, c.ui.value.screen)
        advanceTimeBy(HELLO_EVERY_MS)
        runCurrent()
        assertEquals(Screen.E1, c.ui.value.screen)
    }

    @Test
    fun time_is_interpolated_only_while_active() = runTest {
        val (c, _) = setup()
        c.onSnapshot(snap(1, status = "ACTIVE", activeMs = 60_000))
        advanceTimeBy(3_000)
        assertEquals(63_000, c.activeMs())
        c.onSnapshot(snap(2, status = "PAUSED", activeMs = 63_500))
        advanceTimeBy(10_000)
        assertEquals("일시정지 중 시간이 늘지 않는다", 63_500, c.activeMs())
    }

    @Test
    fun finish_freezes_time_on_w7a_then_e3_when_phone_offline_and_w7b_when_saved() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, status = "PAUSED", activeMs = 70_000))
        c.finish()
        runCurrent()
        assertEquals(1, link.sentOf("FINISH").size)
        c.onSnapshot(snap(2, status = "ENDING", activeMs = 70_000))
        assertEquals(Screen.W7A, c.ui.value.screen)
        advanceTimeBy(60_000)
        assertEquals(70_000, c.activeMs())
        c.onSnapshot(snap(3, status = "ENDING", activeMs = 70_000, sync = "OFFLINE"))
        assertEquals(Screen.E3, c.ui.value.screen)
        c.retrySave()
        runCurrent()
        assertEquals("같은 종료를 다시 보내 달라는 요청(새 운동 아님)", 1, link.sentOf("RETRY_FINISH").size)
        c.onSnapshot(snap(4, status = "ENDED", result = true))
        assertEquals(Screen.W7B, c.ui.value.screen)
        c.openResult()
        runCurrent()
        assertEquals("uirun://record/s1", link.opened.single())
        assertEquals(Screen.P1, c.ui.value.screen)
        c.home()
        assertEquals(Screen.W0, c.ui.value.screen)
    }

    @Test
    fun photo_handoff_uses_same_request_id_on_retry_and_tracks_phone_stages() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, exposure = "ex1"))
        c.answer("PRESENT")
        c.photo()
        runCurrent()
        val id = link.sentOf("PHOTO").single().getString("id")
        assertEquals(Screen.W4C, c.ui.value.screen)
        c.onAck(ack(id, "RECEIVED"))
        runCurrent()
        assertEquals("uirun://wear-capture?req=$id", link.opened.single())
        advanceTimeBy(CAMERA_WAIT_MS)
        runCurrent()
        assertEquals("카메라가 열리지 않으면 E2", Screen.E2, c.ui.value.screen)
        c.photo()
        runCurrent()
        assertEquals("다시 요청은 같은 요청 ID", id, link.sentOf("PHOTO")[1].getString("id"))
        fun stage(rev: Long, s: String, reward: JSONObject? = null) =
            c.onSnapshot(snap(rev, exposure = "ex1", photo = JSONObject().put("requestId", id).put("exposureId", "ex1").put("stage", s).apply { reward?.let { put("reward", it) } }))
        stage(2, "CAMERA_OPENED")
        assertEquals(Screen.W4C, c.ui.value.screen)
        stage(3, "SUBMITTED")
        assertEquals(Screen.W5A, c.ui.value.screen)
        stage(4, "SERVER_RESULT", JSONObject().put("saved", true).put("points", 0).put("pending", 5).put("reason", "PENDING_REVIEW"))
        assertEquals(Screen.W5B, c.ui.value.screen)
        assertEquals("PHOTO", c.ui.value.result?.kind)
        assertEquals(5, c.ui.value.result?.reward?.pending)
        c.back()
        assertEquals(Screen.W2, c.ui.value.screen)
    }

    @Test
    fun cancelled_photo_returns_to_run_without_result() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, exposure = "ex1"))
        c.answer("PRESENT")
        c.photo()
        runCurrent()
        val id = link.sentOf("PHOTO").single().getString("id")
        c.onSnapshot(snap(2, exposure = "ex1", photo = JSONObject().put("requestId", id).put("exposureId", "ex1").put("stage", "CANCELLED")))
        assertEquals(Screen.W2, c.ui.value.screen)
    }

    @Test
    fun quick_result_arriving_late_is_shown_once_and_back_follows_current_session() = runTest {
        val (c, link) = setup()
        c.onSnapshot(snap(1, exposure = "ex1"))
        c.answer("PRESENT")
        c.skipPhoto()
        runCurrent()
        assertEquals(Screen.W5A, c.ui.value.screen)
        c.back()
        assertEquals(Screen.W2, c.ui.value.screen)
        c.onSnapshot(snap(2, status = "PAUSED"))
        val q = JSONObject().put("commandId", link.sentOf("QUICK").single().getString("id")).put("exposureId", "ex1").put("answer", "PRESENT").put("state", "DONE")
            .put("reward", JSONObject().put("saved", true).put("points", 1).put("pending", 0).put("reason", "PAID"))
        c.onSnapshot(snap(3, status = "PAUSED", quick = q))
        assertEquals(Screen.W5B, c.ui.value.screen)
        c.back()
        assertEquals("결과 뒤에는 지금 세션 상태(일시정지)로", Screen.W6, c.ui.value.screen)
        c.onSnapshot(snap(4, status = "PAUSED", quick = q))
        assertEquals(Screen.W6, c.ui.value.screen)
    }
    @Test
    fun transport_flows_decode_snapshots_and_ack_then_wait_for_authoritative_state() = runTest {
        val (c, link) = setup()
        link.snapshots.emit(snap(1))
        runCurrent()
        assertEquals(Screen.W2, c.ui.value.screen)
        c.pause()
        runCurrent()
        val id = link.sentOf("PAUSE").single().getString("id")
        link.acks.emit(ack(id, "DONE"))
        runCurrent()
        assertEquals(Screen.W2, c.ui.value.screen)
        assertEquals("PAUSE", c.ui.value.pending)
        link.snapshots.emit(snap(2, status = "PAUSED"))
        runCurrent()
        assertEquals(Screen.W6, c.ui.value.screen)
        assertNull(c.ui.value.pending)
    }

    @Test
    fun malformed_or_other_version_transport_messages_do_not_change_current_run() = runTest {
        val (c, link) = setup()
        link.snapshots.emit(snap(1))
        runCurrent()
        c.pause()
        runCurrent()
        val id = link.sentOf("PAUSE").single().getString("id")
        link.snapshots.emit("not-json")
        link.acks.emit(JSONObject(ack(id, "REJECTED")).put("v", 2).toString())
        runCurrent()
        assertEquals(Screen.W2, c.ui.value.screen)
        assertEquals("PAUSE", c.ui.value.pending)
        assertEquals(1L, c.ui.value.snap?.revision)
        link.snapshots.emit(JSONObject(snap(2, status = "PAUSED")).put("v", 2).toString())
        runCurrent()
        assertTrue(c.ui.value.incompatible)
        assertEquals(1L, c.ui.value.snap?.revision)
    }

    @Test
    fun account_change_cancels_retry_and_old_ack_cannot_settle_new_command() = runTest {
        val (c, link) = setup()
        link.snapshots.emit(snap(1))
        runCurrent()
        c.pause()
        runCurrent()
        val old = link.sentOf("PAUSE").single().getString("id")
        link.snapshots.emit(snap(1, epoch = 2))
        runCurrent()
        assertNull(c.ui.value.pending)
        advanceTimeBy(ACK_RETRY_MS)
        runCurrent()
        assertEquals(1, link.sentOf("PAUSE").size)
        c.pause()
        runCurrent()
        val current = link.sentOf("PAUSE").last()
        assertEquals(2L, current.getLong("epoch"))
        link.acks.emit(ack(old, "REJECTED", "ACCOUNT_CHANGED"))
        runCurrent()
        assertEquals("PAUSE", c.ui.value.pending)
        assertNull(c.ui.value.notice)
    }

}
