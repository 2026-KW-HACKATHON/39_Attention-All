package com.attentionall.uirun.watch

import org.json.JSONArray
import org.json.JSONObject

// 폰↔워치 계약 v1(docs/wear/PROTOCOL.md). 폰 쪽은 mobile/src/wearlogic.ts. 필드를 바꾸면 두 곳과 문서를 함께 바꾼다.
// 폰 운동 엔진이 유일한 권위다. 워치는 스냅샷을 표시하고 명령을 요청할 뿐 거리·보상을 계산하지 않는다.
object Paths {
    const val SNAPSHOT = "/uirun/v1/snapshot" // DataClient(폰 → 워치, 최신 상태 1건)
    const val COMMAND = "/uirun/v1/command" // MessageClient(워치 → 폰)
    const val ACK = "/uirun/v1/ack" // MessageClient(폰 → 워치)
    const val PHONE_CAPABILITY = "uirun_phone_bridge"
}

const val PROTOCOL_VERSION = 1

enum class RunStatus { ACTIVE, PAUSED, ENDING, ENDED }

data class Summary(val sessionId: String, val distanceM: Double, val activeMs: Long, val participations: Int?)

data class Session(
    val sessionId: String,
    val status: RunStatus,
    val mode: String, // RUN | WALK
    val distanceM: Double,
    val activeMs: Long, // observedAt 시점의 활동 시간(폰 엔진 값). 워치는 ACTIVE일 때만 수신 후 경과를 더해 보여준다.
    val paceSecPerKm: Int?, // 10m 미만이면 null(가짜 페이스를 만들지 않는다)
    val sync: String, // OK | SENDING | OFFLINE
    val problem: String?,
    val result: Summary?, // 서버가 종료를 확인한 값(ENDED)
)

data class Exposure(
    val id: String,
    val kind: String, // ISSUE | ROUTINE
    val title: String,
    val distanceM: Int?,
    val answerable: Boolean, // 폰 최근 정확한 위치가 응답 반경 안(최종 판단은 서버)
    val radiusM: Int,
    val expiresInMs: Long, // observedAt 기준 남은 시간(시계가 다른 두 기기에서 절대 시각을 비교하지 않는다)
)

data class Reward(val saved: Boolean, val existing: Boolean, val points: Int, val pending: Int, val reason: String?)

// state: SENDING | DONE | FAILED | UNSUPPORTED
data class Quick(val commandId: String, val exposureId: String, val answer: String, val state: String, val code: String?, val reward: Reward?)

// stage: PHONE_RECEIVED | CAMERA_OPENED | CAMERA_PERMISSION | SUBMITTED | SERVER_RESULT | CANCELLED | FAILED | EXPIRED
data class Photo(val requestId: String, val exposureId: String, val stage: String, val code: String?, val reward: Reward?)
data class Preparation(val phase: String, val count: Int, val outside: Boolean, val error: String?, val mode: String)

data class Snapshot(
    val v: Int,
    val epoch: Long, // 계정 세대. 바뀌면 이전 계정의 모든 표시·대기 상태를 버린다.
    val revision: Long, // 같은 epoch 안에서 증가. 작거나 같으면 늦게 온 이전 상태다.
    val signedIn: Boolean,
    val needs: List<String>, // LOGIN | CONSENT | LOCATION_PERMISSION | PRECISE_LOCATION
    val session: Session?,
    val exposure: Exposure?,
    val quick: Quick?,
    val photo: Photo?,
    val last: Summary?, // 마지막 종료 요약(서버 확인분)
    val preparation: Preparation? = null,
) {
    companion object {
        fun parse(json: String): Snapshot? = runCatching {
            val o = JSONObject(json)
            val account = o.optJSONObject("account") ?: JSONObject()
            Snapshot(
                v = o.getInt("v"),
                epoch = o.getLong("epoch"),
                revision = o.getLong("revision"),
                signedIn = account.optBoolean("signedIn", false),
                needs = account.optJSONArray("needs").strings(),
                session = o.optJSONObject("session")?.let(::session),
                exposure = o.optJSONObject("exposure")?.let(::exposure),
                quick = o.optJSONObject("quick")?.let {
                    Quick(it.getString("commandId"), it.getString("exposureId"), it.getString("answer"), it.getString("state"), it.str("code"), it.optJSONObject("reward")?.let(::reward))
                },
                photo = o.optJSONObject("photo")?.let {
                    Photo(it.getString("requestId"), it.getString("exposureId"), it.getString("stage"), it.str("code"), it.optJSONObject("reward")?.let(::reward))
                },
                last = o.optJSONObject("last")?.let(::summary),
                preparation = o.optJSONObject("preparation")?.let {
                    Preparation(it.getString("phase"), it.optInt("count"), it.optBoolean("outside"), it.str("error"), it.optString("mode", "RUN"))
                },
            )
        }.getOrNull()

        private fun session(o: JSONObject) = Session(
            sessionId = o.getString("sessionId"),
            status = RunStatus.valueOf(o.getString("status")),
            mode = o.getString("mode"),
            distanceM = o.getDouble("distanceM"),
            activeMs = o.getLong("activeMs"),
            paceSecPerKm = if (o.isNull("paceSecPerKm") || !o.has("paceSecPerKm")) null else o.getInt("paceSecPerKm"),
            sync = o.optString("sync", "OK"),
            problem = o.str("problem"),
            result = o.optJSONObject("result")?.let(::summary),
        )

        private fun summary(o: JSONObject) = Summary(
            sessionId = o.getString("sessionId"),
            distanceM = o.getDouble("distanceM"),
            activeMs = o.getLong("activeMs"),
            participations = if (o.has("participations") && !o.isNull("participations")) o.getInt("participations") else null,
        )

        private fun exposure(o: JSONObject) = Exposure(
            id = o.getString("id"),
            kind = o.getString("kind"),
            title = o.optString("title", ""),
            distanceM = if (o.has("distanceM") && !o.isNull("distanceM")) o.getInt("distanceM") else null,
            answerable = o.optBoolean("answerable", false),
            radiusM = o.optInt("radiusM", 40),
            expiresInMs = o.getLong("expiresInMs"),
        )

        private fun reward(o: JSONObject) = Reward(
            saved = o.optBoolean("saved", false),
            existing = o.optBoolean("existing", false),
            points = o.optInt("points", 0),
            pending = o.optInt("pending", 0),
            reason = o.str("reason"),
        )
    }
}

// status: RECEIVED(폰이 받음, 처리 중) | DONE(폰 엔진 처리 완료) | REJECTED(검증 거절) | NEEDS_PHONE(폰 화면에서 확인 필요)
// MessageClient 전송 성공은 폰 처리 성공이 아니다. 이 ACK와 스냅샷으로만 확인한다.
data class Ack(
    val id: String,
    val status: String,
    val code: String?,
    val sessionId: String?,
    val jsReady: Boolean?, // 폰 우이런 앱(JS 엔진)이 살아 있어 명령을 바로 처리할 수 있는지
    val opened: Boolean, // 폰이 스스로 촬영 화면을 열었는지(이미 앞에 있을 때)
    val phoneLocked: Boolean,
) {
    companion object {
        fun parse(json: String): Ack? = runCatching {
            val o = JSONObject(json)
            if (o.getInt("v") != PROTOCOL_VERSION) return null
            Ack(
                id = o.getString("id"),
                status = o.getString("status"),
                code = o.str("code"),
                sessionId = o.str("sessionId"),
                jsReady = if (o.has("jsReady")) o.getBoolean("jsReady") else null,
                opened = o.optBoolean("opened", false),
                phoneLocked = o.optBoolean("phoneLocked", false),
            )
        }.getOrNull()
    }
}

// type: HELLO | START | PAUSE | RESUME | FINISH | RETRY_FINISH | QUICK | PHOTO | ALERT_SHOWN
fun command(type: String, id: String, epoch: Long?, vararg extra: Pair<String, Any?>): String {
    val o = JSONObject().put("v", PROTOCOL_VERSION).put("id", id).put("type", type)
    if (epoch != null) o.put("epoch", epoch)
    for ((k, v) in extra) if (v != null) o.put(k, v)
    return o.toString()
}

private fun JSONObject.str(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null
private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else List(length()) { getString(it) }
