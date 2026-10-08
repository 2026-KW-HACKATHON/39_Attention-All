package com.attentionall.uirun.wearbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

// 워치 연결의 네이티브 쪽 공용 상태. 계약: docs/wear/PROTOCOL.md (워치 watch/.../Protocol.kt, 폰 JS mobile/src/wearlogic.ts)
object WearHub {
  const val PATH_COMMAND = "/uirun/v1/command"
  const val PATH_ACK = "/uirun/v1/ack"
  const val PATH_SNAPSHOT = "/uirun/v1/snapshot"
  const val WATCH_CAPABILITY = "uirun_watch_app"
  const val PHONE_CAPABILITY = "uirun_phone_bridge" // res/values/wear.xml android_wear_capabilities(정적 선언)와 같은 이름
  private const val PENDING_MAX = 10
  private const val CHANNEL = "wear-request"

  // JS 엔진이 이벤트를 받을 수 있을 때만 설정된다(모듈 OnStartObserving). null이면 앱 JS가 없다.
  @Volatile var sink: ((String, String) -> Unit)? = null

  // 워치가 체크포인트를 사용자에게 알렸다는 ACK(ALERT_SHOWN). 폰 알림을 미룰지 판단할 때 쓴다.
  // 기다림은 네이티브 Handler로 한다(앱이 백그라운드면 JS 타이머가 돌지 않는다).
  private val shown = LinkedHashSet<String>()
  private val waiters = HashMap<String, MutableList<(Boolean) -> Unit>>()
  private val main = Handler(Looper.getMainLooper())

  @Synchronized
  fun alertShown(exposureId: String) {
    shown += exposureId
    while (shown.size > 20) shown.remove(shown.first())
    waiters.remove(exposureId)?.forEach { it(true) }
  }

  @Synchronized
  fun awaitAlert(exposureId: String, timeoutMs: Long, done: (Boolean) -> Unit) {
    if (exposureId in shown) return done(true)
    var once = false
    val cb: (Boolean) -> Unit = { v -> if (!once) { once = true; done(v) } }
    waiters.getOrPut(exposureId) { mutableListOf() } += cb
    main.postDelayed({ synchronized(this) { waiters[exposureId]?.remove(cb) }; cb(false) }, timeoutMs)
  }

  private fun prefs(ctx: Context) = ctx.getSharedPreferences("uirun_wear_bridge", Context.MODE_PRIVATE)

  // 계정 세대: 로그인 계정이 바뀌면(로그아웃 포함) 커진다. 워치는 세대가 바뀐 스냅샷을 받으면 이전 계정 표시를 모두 버린다.
  // 계정 값은 해시만 이 기기에 남기고 워치로 보내지 않는다. 바뀌면 보관 중인 워치 요청도 버린다.
  @Synchronized
  fun setAccount(ctx: Context, key: String?): Long {
    val p = prefs(ctx)
    val hash = key?.let { sha256(it) } ?: "-"
    var epoch = p.getLong("epoch", 0)
    if (p.getString("account", null) != hash) {
      epoch = maxOf(epoch + 1, System.currentTimeMillis())
      p.edit().putString("account", hash).putLong("epoch", epoch).putString("pending", "[]").apply()
    }
    return epoch
  }

  fun epoch(ctx: Context) = prefs(ctx).getLong("epoch", 0)

  // 명령을 보낸 워치 노드. Data Layer 메시지는 같은 패키지·서명 앱에서만 오므로 우이런 워치가 있다는 증거다.
  // GMS capability 조회가 빈 목록을 주는 환경(2026-10-07 페어링 에뮬레이터에서 확인)에서 워치 존재·연결 판단을 보완한다.
  fun rememberWatch(ctx: Context, nodeId: String) {
    if (watchNode(ctx) != nodeId) prefs(ctx).edit().putString("watchNode", nodeId).apply()
  }
  fun watchNode(ctx: Context): String? = prefs(ctx).getString("watchNode", null)

  // 정적 선언에 더해 실행 중에도 capability를 알린다. 이미 있으면 GMS가 중복으로 답한다 — 결과만 기록한다.
  fun announce(ctx: Context, reason: String) {
    val c = ctx.applicationContext
    Wearable.getCapabilityClient(c).addLocalCapability(PHONE_CAPABILITY)
      .addOnSuccessListener { diag(c, "[$reason] addLocalCapability('$PHONE_CAPABILITY') 성공") }
      .addOnFailureListener { diag(c, "[$reason] addLocalCapability('$PHONE_CAPABILITY') 결과: ${it.javaClass.simpleName}: ${it.message}") }
  }

  // 스냅샷 순번: 앱을 다시 켜도 줄지 않는다(워치는 같거나 작은 순번을 버린다).
  @Synchronized
  fun nextRevision(ctx: Context): Long {
    val p = prefs(ctx)
    val r = p.getLong("revision", 0) + 1
    p.edit().putLong("revision", r).commit()
    return r
  }

  // JS가 없을 때 받은 시작·촬영 요청만 최대 10건 보관한다. JS가 시작되면 꺼내 같은 규칙(만료·계정·중복)으로 처리한다.
  @Synchronized
  fun enqueue(ctx: Context, json: String, nodeId: String) {
    val p = prefs(ctx)
    val arr = JSONArray(p.getString("pending", "[]"))
    arr.put(JSONObject().put("json", json).put("nodeId", nodeId).put("receivedAt", System.currentTimeMillis()))
    while (arr.length() > PENDING_MAX) arr.remove(0)
    p.edit().putString("pending", arr.toString()).apply()
  }

  @Synchronized
  fun takePending(ctx: Context): String {
    val p = prefs(ctx)
    val s = p.getString("pending", "[]")!!
    p.edit().putString("pending", "[]").apply()
    return s
  }

  fun sendAck(ctx: Context, nodeId: String?, json: String) {
    val bytes = json.toByteArray(Charsets.UTF_8)
    val messages = Wearable.getMessageClient(ctx)
    if (nodeId != null) {
      messages.sendMessage(nodeId, PATH_ACK, bytes)
      return
    }
    Wearable.getNodeClient(ctx).connectedNodes.addOnSuccessListener { nodes -> nodes.forEach { messages.sendMessage(it.id, PATH_ACK, bytes) } }
  }

  // JS가 없을 때: 사용자가 눌러 우이런을 열 수 있게 알린다(백그라운드에서 화면을 직접 띄우지 않는다). 알림 권한이 없으면 false.
  fun notifyOpenApp(ctx: Context, type: String, requestId: String): Boolean {
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return false
    if (!nm.areNotificationsEnabled()) return false
    if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "워치 요청", NotificationManager.IMPORTANCE_HIGH))
    val photo = type == "PHOTO"
    val intent = if (photo) Intent(Intent.ACTION_VIEW, Uri.parse("uirun://wear-capture?req=$requestId")).setPackage(ctx.packageName)
    else ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return false
    val open = PendingIntent.getActivity(ctx, requestId.hashCode(), intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    @Suppress("DEPRECATION")
    val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, CHANNEL) else Notification.Builder(ctx)
    nm.notify(
      "wear-request".hashCode(),
      b.setSmallIcon(ctx.applicationInfo.icon)
        .setContentTitle(if (photo) "워치에서 체크포인트 촬영을 요청했어요" else "워치에서 운동 시작을 요청했어요")
        .setContentText(if (photo) "눌러서 우이런 안에서 촬영을 이어가요" else "눌러서 우이런에서 시작을 확인해 주세요")
        .setAutoCancel(true)
        .setContentIntent(open)
        .build(),
    )
    return true
  }

  fun ack(id: String, status: String) = JSONObject().put("v", 1).put("id", id).put("status", status)

  // ---------- 임시 진단(debuggable 빌드만, logcat 태그 UirunDiag). 노드 ID·이름·capability만(계정·위치 없음) ----------
  const val DIAG = "UirunDiag"
  private fun debuggable(ctx: Context) = (ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
  fun diag(ctx: Context, msg: String) {
    if (debuggable(ctx)) android.util.Log.i(DIAG, msg)
  }
  private fun fmt(nodes: Collection<com.google.android.gms.wearable.Node>) =
    if (nodes.isEmpty()) "[]" else nodes.joinToString(prefix = "[", postfix = "]") { "${it.id}(${it.displayName}, nearby=${it.isNearby})" }

  // 이 폰이 Data Layer에서 어떻게 보이는지: 로컬 노드, 연결 노드, 우리 capability(폰·워치 쪽 이름) 등록·발견 상태
  fun diagnose(ctx: Context, reason: String) {
    if (!debuggable(ctx)) return
    val c = ctx.applicationContext
    diag(c, "[$reason] JS 이벤트 연결(sink)=${sink != null}, epoch=${epoch(c)}, 기억한 워치 노드=${watchNode(c)}")
    Wearable.getNodeClient(c).localNode
      .addOnSuccessListener { diag(c, "[$reason] localNode=${it.id}(${it.displayName})") }
      .addOnFailureListener { diag(c, "[$reason] localNode 실패 ${it.javaClass.simpleName}: ${it.message}") }
    Wearable.getNodeClient(c).connectedNodes
      .addOnSuccessListener { diag(c, "[$reason] connectedNodes=${fmt(it)}") }
      .addOnFailureListener { diag(c, "[$reason] connectedNodes 실패 ${it.javaClass.simpleName}: ${it.message}") }
    val caps = Wearable.getCapabilityClient(c)
    for (name in listOf(PHONE_CAPABILITY, WATCH_CAPABILITY)) for ((f, fn) in listOf(com.google.android.gms.wearable.CapabilityClient.FILTER_ALL to "ALL", com.google.android.gms.wearable.CapabilityClient.FILTER_REACHABLE to "REACHABLE")) {
      caps.getCapability(name, f)
        .addOnSuccessListener { diag(c, "[$reason] getCapability('$name', $fn) nodes=${fmt(it.nodes)}") }
        .addOnFailureListener { diag(c, "[$reason] getCapability('$name', $fn) 실패 ${it.javaClass.simpleName}: ${it.message}") }
    }
    caps.getAllCapabilities(com.google.android.gms.wearable.CapabilityClient.FILTER_ALL)
      .addOnSuccessListener { m -> diag(c, "[$reason] getAllCapabilities(ALL) 중 uirun: ${m.filterKeys { it.startsWith("uirun") }.entries.joinToString { "${it.key}=${it.value.nodes.map { n -> n.id }}" }.ifEmpty { "없음" }}") }
  }

  private fun sha256(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}

// 워치 명령 수신. 앱이 꺼져 있어도 Google Play 서비스가 이 서비스를 깨운다. 하지만 이것이 백그라운드 위치 서비스 시작 권한을 주지는 않는다.
class WearListenerService : WearableListenerService() {
  override fun onCreate() {
    super.onCreate()
    WearHub.announce(this, "service-create")
    WearHub.diagnose(this, "service-create")
  }

  override fun onMessageReceived(e: MessageEvent) {
    WearHub.diag(this, "message from ${e.sourceNodeId} path=${e.path} bytes=${e.data.size} sink=${WearHub.sink != null}")
    if (e.path != WearHub.PATH_COMMAND) return
    val json = String(e.data, Charsets.UTF_8)
    val cmd = runCatching { JSONObject(json) }.getOrNull() ?: return
    val id = cmd.optString("id")
    val type = cmd.optString("type")
    WearHub.diag(this, "command type=$type id=$id")
    WearHub.rememberWatch(this, e.sourceNodeId)
    val sink = WearHub.sink
    if (type == "ALERT_SHOWN") WearHub.alertShown(cmd.optString("exposureId"))
    if (type == "HELLO") WearHub.sendAck(this, e.sourceNodeId, WearHub.ack(id, "DONE").put("jsReady", sink != null).toString())
    if (sink != null) return sink(json, e.sourceNodeId)
    if (type == "HELLO" || type == "ALERT_SHOWN") return
    // 시작·촬영 요청만 보관한다. 일시정지·재개·종료는 앱 엔진 없이 처리할 수 없으므로 보관하지 않는다(나중에 오래된 명령을 재생하지 않는다).
    val keep = type == "START" || type == "PHOTO"
    if (keep) WearHub.enqueue(this, json, e.sourceNodeId)
    val notified = keep && WearHub.notifyOpenApp(this, type, id)
    WearHub.sendAck(this, e.sourceNodeId, WearHub.ack(id, "NEEDS_PHONE").put("code", "PHONE_APP_NOT_RUNNING").put("jsReady", false).put("notified", notified).toString())
  }
}
