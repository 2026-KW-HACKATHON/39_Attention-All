package com.attentionall.uirun.watch

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 개발 빌드 전용 가짜 폰(화면에 DEMO 표시). 실제 운동·서버·촬영을 하지 않고 화면 전환만 보여준다.
 * 모든 수치·보상은 예시이며 실제 연결 결과가 아니다. 릴리스 빌드에는 이 파일이 없다.
 *
 * adb shell am start -n com.attentionall.uirun/com.attentionall.uirun.watch.MainActivity --es demo <시나리오>
 * 시나리오: ready, login, choose, run, walk, alert, photo, handoff, verify, result, unsupported, paused, confirm,
 *          saving, summary, phoneResult, disconnect, phoneHelp, saveError
 */
class DemoLink(private val scope: CoroutineScope, private val scenario: String) : PhoneLink {
    override val demo = true
    override val conn = MutableStateFlow(Conn.CONNECTED)
    override val snapshots = MutableSharedFlow<String>(replay = 1, extraBufferCapacity = 8)
    override val acks = MutableSharedFlow<String>(extraBufferCapacity = 16)

    private var revision = 0L
    private var status: String? = null
    private var mode = "RUN"
    private var distanceM = 0.0
    private var activeMs = 0L
    private var sync = "OK"
    private var result: JSONObject? = null
    private var last: JSONObject? = null
    private var exposure: JSONObject? = null
    private var quick: JSONObject? = null
    private var photo: JSONObject? = null
    private var signedIn = true
    private var ticker: Job? = null

    override fun start() {
        when (scenario) {
            "login" -> signedIn = false
            "run", "alert", "photo", "handoff", "verify", "result", "unsupported", "disconnect", "phoneHelp" -> active(2840.0, 1_056_000)
            "walk" -> {
                mode = "WALK"
                active(1210.0, 1_302_000)
            }
            "paused", "confirm" -> {
                active(2840.0, 1_056_000)
                status = "PAUSED"
            }
            "saving", "saveError" -> {
                active(5210.0, 2_292_000)
                status = "ENDING"
                if (scenario == "saveError") sync = "OFFLINE"
            }
            "summary", "phoneResult" -> {
                active(5210.0, 2_292_000)
                end()
            }
        }
        if (scenario in listOf("alert", "photo", "handoff", "verify", "result", "unsupported", "phoneHelp")) {
            exposure = JSONObject().put("id", "demo-ex-${System.currentTimeMillis()}").put("kind", "ISSUE").put("title", "수면 거품").put("distanceM", 24)
                .put("answerable", true).put("radiusM", 40).put("expiresInMs", 30 * 60_000)
        }
        publish()
        if (scenario == "disconnect") scope.launch {
            delay(1500)
            conn.value = Conn.NO_PHONE
        }
    }

    override fun stop() {
        ticker?.cancel()
    }

    override suspend fun refresh() {
        if (scenario != "disconnect") conn.value = Conn.CONNECTED
    }

    override suspend fun open(uri: String) = scenario != "phoneHelp"

    override suspend fun send(json: String): Boolean {
        if (conn.value != Conn.CONNECTED) return false
        val c = JSONObject(json)
        val id = c.getString("id")
        scope.launch { handle(id, c) }
        return true
    }

    private suspend fun handle(id: String, c: JSONObject) {
        delay(300)
        when (c.getString("type")) {
            "HELLO" -> ack(id, "DONE", jsReady = true)
            "START" -> {
                ack(id, "DONE")
                mode = c.getString("mode")
                active(0.0, 0)
                publish()
            }
            "PAUSE" -> {
                status = "PAUSED"
                ack(id, "DONE")
                publish()
            }
            "RESUME" -> {
                status = "ACTIVE"
                ack(id, "DONE")
                publish()
            }
            "FINISH" -> {
                status = "ENDING"
                ack(id, "DONE")
                publish()
                delay(2500)
                end()
                publish()
            }
            "RETRY_FINISH" -> {
                sync = "SENDING"
                ack(id, "DONE")
                publish()
                delay(1500)
                end()
                publish()
            }
            "QUICK" -> {
                ack(id, "RECEIVED")
                val answer = c.getString("answer")
                quick = JSONObject().put("commandId", id).put("exposureId", c.getString("exposureId")).put("answer", answer).put("state", "SENDING")
                publish()
                delay(if (scenario == "verify") 60_000 else 1200)
                if (scenario == "unsupported" && answer != "PRESENT") quick!!.put("state", "UNSUPPORTED").put("code", "ANSWER_NOT_SUPPORTED")
                else quick!!.put("state", "DONE").put("reward", reward(if (answer == "PRESENT") 1 else 0, 0, if (answer == "PRESENT") "PAID" else null))
                publish()
            }
            "PHOTO" -> {
                ack(id, "RECEIVED")
                photo = JSONObject().put("requestId", id).put("exposureId", c.getString("exposureId")).put("stage", "PHONE_RECEIVED")
                publish()
                if (scenario == "phoneHelp") return
                for ((wait, stage) in listOf(1500L to "CAMERA_OPENED", 5000L to "SUBMITTED", 2500L to "SERVER_RESULT")) {
                    delay(wait)
                    photo!!.put("stage", stage)
                    if (stage == "SERVER_RESULT") photo!!.put("reward", reward(0, 5, "PENDING_REVIEW"))
                    publish()
                }
            }
        }
    }

    private fun active(d: Double, ms: Long) {
        status = "ACTIVE"
        distanceM = d
        activeMs = ms
        ticker?.cancel()
        ticker = scope.launch {
            while (true) {
                delay(1000)
                if (status == "ACTIVE") {
                    activeMs += 1000
                    distanceM += if (mode == "RUN") 2.7 else 1.2
                    if (activeMs % 5000 == 0L) publish() // 폰도 화면이 보일 때 1~2초, 아니면 드물게 보낸다. 시간은 워치가 보간한다.
                }
            }
        }
    }

    private fun end() {
        status = "ENDED"
        ticker?.cancel()
        exposure = null
        result = JSONObject().put("sessionId", "demo-session").put("distanceM", distanceM).put("activeMs", activeMs).put("participations", 2)
        last = result
    }

    private fun reward(points: Int, pending: Int, reason: String?) =
        JSONObject().put("saved", true).put("existing", false).put("points", points).put("pending", pending).put("reason", reason ?: JSONObject.NULL)

    private suspend fun ack(id: String, status: String, jsReady: Boolean? = null) {
        val o = JSONObject().put("v", PROTOCOL_VERSION).put("id", id).put("status", status)
        if (jsReady != null) o.put("jsReady", jsReady)
        acks.emit(o.toString())
    }

    private fun publish() {
        val s = status
        val session = s?.let {
            JSONObject().put("sessionId", "demo-session").put("status", it).put("mode", mode).put("distanceM", distanceM).put("activeMs", activeMs)
                .put("paceSecPerKm", if (distanceM >= 10 && activeMs > 0) (activeMs / 1000.0 / (distanceM / 1000)).toInt() else JSONObject.NULL)
                .put("sync", sync).put("result", result ?: JSONObject.NULL)
        }
        val o = JSONObject().put("v", PROTOCOL_VERSION).put("epoch", 1).put("revision", ++revision).put("observedAt", System.currentTimeMillis())
            .put("account", JSONObject().put("signedIn", signedIn).put("needs", org.json.JSONArray(if (signedIn) emptyList<String>() else listOf("LOGIN"))))
            .put("session", session ?: JSONObject.NULL)
            .put("exposure", (if (s == "ACTIVE") exposure else null) ?: JSONObject.NULL)
            .put("quick", quick ?: JSONObject.NULL)
            .put("photo", photo ?: JSONObject.NULL)
            .put("last", last ?: JSONObject.NULL)
        snapshots.tryEmit(o.toString())
    }

    companion object {
        // 화면 확인용: 시나리오에 맞춰 사용자가 누를 버튼을 대신 누른다.
        fun script(c: WatchController, scope: CoroutineScope, scenario: String) {
            scope.launch {
                delay(1200)
                when (scenario) {
                    "choose" -> c.choose()
                    "photo", "unsupported" -> c.answer(if (scenario == "photo") "PRESENT" else "ABSENT")
                    "handoff", "phoneHelp" -> {
                        c.answer("PRESENT")
                        delay(1500)
                        c.photo()
                    }
                    "verify", "result" -> {
                        c.answer("PRESENT")
                        delay(if (scenario == "verify") 300 else 2000)
                        c.skipPhoto()
                    }
                    "confirm" -> c.askFinish()
                    "phoneResult" -> c.openResult()
                }
            }
        }
    }
}
