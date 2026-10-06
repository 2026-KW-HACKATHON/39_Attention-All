package com.attentionall.uirun.watch

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import java.util.concurrent.Executor
import kotlin.coroutines.resume

// CONNECTED: 우이런 폰 앱(브리지 capability)이 있는 폰이 연결됨. NO_APP: 폰은 연결됐지만 우이런 브리지가 없음(미설치·구버전).
enum class Conn { CHECKING, CONNECTED, NO_APP, NO_PHONE }

// 폰 연결 경계. 실제 구현은 Wearable Data Layer, 개발 빌드에는 화면 시험용 DEMO 구현이 있다(src/debug, 릴리스에는 없음).
interface PhoneLink {
    val demo: Boolean
    val conn: StateFlow<Conn>
    val snapshots: SharedFlow<String> // 스냅샷 JSON(오래된 것 걸러내기는 WatchController)
    val acks: SharedFlow<String>
    fun start()
    fun stop()
    suspend fun refresh()
    suspend fun send(json: String): Boolean // MessageClient 전달 여부만. 폰 처리 결과가 아니다.
    suspend fun open(uri: String): Boolean // 폰에서 우이런 화면 열기 요청(전달 여부만)
}

class DataLayerLink(context: Context, private val scope: CoroutineScope) :
    PhoneLink,
    DataClient.OnDataChangedListener,
    MessageClient.OnMessageReceivedListener,
    CapabilityClient.OnCapabilityChangedListener {

    private val ctx = context.applicationContext
    private val data = Wearable.getDataClient(ctx)
    private val messages = Wearable.getMessageClient(ctx)
    private val capabilities = Wearable.getCapabilityClient(ctx)
    private val nodes = Wearable.getNodeClient(ctx)
    private var phoneNode: String? = null
    // 직접 HELLO ping에 우이런 폰 브리지가 ACK로 답한 노드. Data Layer 메시지는 같은 패키지·서명 앱에만 닿으므로 ACK가 설치 증거다.
    // 일부 환경(2026-10-07 페어링 에뮬레이터)에서 GMS capability 조회가 양쪽 다 빈 목록을 돌려줘 이것으로 보완한다.
    private var confirmed: String? = null

    override val demo = false
    override val conn = MutableStateFlow(Conn.CHECKING)
    override val snapshots = MutableSharedFlow<String>(replay = 1, extraBufferCapacity = 8)
    override val acks = MutableSharedFlow<String>(extraBufferCapacity = 16)

    override fun start() {
        data.addListener(this, Uri.parse("wear://*" + Paths.SNAPSHOT), DataClient.FILTER_LITERAL)
        messages.addListener(this, Uri.parse("wear://*" + Paths.ACK), MessageClient.FILTER_LITERAL)
        capabilities.addListener(this, Paths.PHONE_CAPABILITY)
        // 정적 선언(res/values/wear.xml)에 더해 실행 중에도 알린다. 이미 있으면 GMS가 중복(4006)으로 답한다 — 결과만 기록
        capabilities.addLocalCapability(WATCH_CAPABILITY)
            .addOnSuccessListener { diag("addLocalCapability('$WATCH_CAPABILITY') 성공") }
            .addOnFailureListener { diag("addLocalCapability('$WATCH_CAPABILITY') 결과: ${it.javaClass.simpleName}: ${it.message}") }
        scope.launch {
            refresh()
            loadLatest()
            diagnose("start")
        }
    }

    override fun stop() {
        data.removeListener(this)
        messages.removeListener(this)
        capabilities.removeListener(this)
    }

    // 워치가 꺼져 있던 사이의 최신 스냅샷: Data Layer가 이 기기에 보관한 항목을 읽는다(별도 DB 없음).
    private suspend fun loadLatest() {
        runCatching {
            val items = data.getDataItems(Uri.parse("wear://*" + Paths.SNAPSHOT), DataClient.FILTER_LITERAL).await()
            try {
                items.map { DataMapItem.fromDataItem(it).dataMap }.maxByOrNull { it.getLong("revision") }?.getString("json")?.let { snapshots.emit(it) }
            } finally {
                items.release()
            }
        }.onFailure { Log.w(TAG, "snapshot load failed: ${it.javaClass.simpleName}") }
    }

    override suspend fun refresh() {
        val c = runCatching {
            val info = capabilities.getCapability(Paths.PHONE_CAPABILITY, CapabilityClient.FILTER_REACHABLE).await()
            diag("refresh: getCapability('${Paths.PHONE_CAPABILITY}', REACHABLE) → ${info.nodes.fmt()}")
            pick(info)?.let { phoneNode = it; return@runCatching Conn.CONNECTED }
            val connected = nodes.connectedNodes.await()
            diag("refresh: connectedNodes → ${connected.fmt()}, ping으로 확인된 폰=$confirmed")
            confirmed?.takeIf { id -> connected.any { it.id == id } }?.let { phoneNode = it; return@runCatching Conn.CONNECTED }
            phoneNode = null
            if (connected.isEmpty()) return@runCatching Conn.NO_PHONE
            probe(connected) // ACK가 오면 onMessageReceived에서 CONNECTED로 바뀐다
            Conn.NO_APP
        }.getOrElse {
            diag("refresh: 실패 ${it.javaClass.simpleName}: ${it.message}")
            Conn.NO_PHONE
        }
        diag("refresh → $c (phoneNode=$phoneNode)")
        conn.value = c
        if (c == Conn.CONNECTED) loadLatest()
    }

    // capability 없이 연결된 노드마다 HELLO. 우이런 폰 브리지만 ACK로 답한다(다른 앱·폰은 받지 못함).
    private suspend fun probe(connected: List<com.google.android.gms.wearable.Node>) {
        for (n in connected) {
            val r = runCatching { messages.sendMessage(n.id, Paths.COMMAND, command("HELLO", "probe-" + java.util.UUID.randomUUID(), null).toByteArray()).await() }
            diag("probe HELLO → ${n.id}: ${r.fold({ "전송됨" }, { "실패 ${it.javaClass.simpleName}" })}")
        }
    }

    // ---------- 임시 진단(debug 빌드만, logcat 태그 UirunDiag). 노드 ID·이름·capability만 남긴다(위치·계정 없음) ----------
    private fun diag(msg: String) {
        if (BuildConfig.DEBUG) Log.i(DIAG, msg)
    }

    private fun Collection<com.google.android.gms.wearable.Node>.fmt() =
        if (isEmpty()) "[]" else joinToString(prefix = "[", postfix = "]") { "${it.id}(${it.displayName}, nearby=${it.isNearby})" }

    // 페어링 문제와 앱(코드) 문제를 가른다:
    //  connectedNodes 비어 있음 → 페어링·연결 문제
    //  capability 없이 직접 보낸 HELLO에 ACK가 옴 → 전송·패키지·서명 정상(폰 우이런 브리지만 ACK를 보낸다) → capability 조회 문제
    //  연결 노드는 있는데 ACK 없음 → 폰 앱 수신 문제(미설치·서명 불일치·서비스 미선언)
    suspend fun diagnose(reason: String) {
        if (!BuildConfig.DEBUG) return
        runCatching {
            val local = nodes.localNode.await()
            diag("[$reason] localNode=${local.id}(${local.displayName})")
            val connected = nodes.connectedNodes.await()
            diag("[$reason] connectedNodes=${connected.fmt()}")
            for ((f, name) in listOf(CapabilityClient.FILTER_ALL to "ALL", CapabilityClient.FILTER_REACHABLE to "REACHABLE")) {
                val info = capabilities.getCapability(Paths.PHONE_CAPABILITY, f).await()
                diag("[$reason] getCapability('${Paths.PHONE_CAPABILITY}', $name) name=${info.name} nodes=${info.nodes.fmt()}")
            }
            val all = capabilities.getAllCapabilities(CapabilityClient.FILTER_ALL).await()
            diag("[$reason] getAllCapabilities(ALL) ${all.size}개: ${all.entries.joinToString { "${it.key}=${it.value.nodes.map { n -> n.id }}" }}")
            for (n in connected) {
                val id = "diag-" + System.currentTimeMillis()
                val r = runCatching { messages.sendMessage(n.id, Paths.COMMAND, command("HELLO", id, null).toByteArray()).await() }
                diag("[$reason] 직접 ping(capability 미사용) → ${n.id} id=$id sendMessage=${r.fold({ "OK($it)" }, { "FAIL ${it.javaClass.simpleName}: ${it.message}" })} — 폰 ACK는 'ack from' 로그로 확인")
            }
        }.onFailure { diag("[$reason] 진단 실패 ${it.javaClass.simpleName}: ${it.message}") }
    }

    private fun pick(info: CapabilityInfo) = info.nodes.let { n -> (n.firstOrNull { it.isNearby } ?: n.firstOrNull())?.id }

    override suspend fun send(json: String): Boolean {
        val node = phoneNode ?: run { refresh(); phoneNode } ?: return false
        return runCatching { messages.sendMessage(node, Paths.COMMAND, json.toByteArray()).await(); true }.getOrElse {
            scope.launch { refresh() }
            false
        }
    }

    // RemoteActivityHelper는 extras를 보장하지 않는다. 문맥은 Data Layer로 먼저 보내고 URI에는 불투명한 요청 ID만 넣는다.
    override suspend fun open(uri: String): Boolean {
        val node = phoneNode ?: return false
        val intent = Intent(Intent.ACTION_VIEW).addCategory(Intent.CATEGORY_BROWSABLE).setData(Uri.parse(uri))
        val direct = Executor { it.run() }
        val future = RemoteActivityHelper(ctx, direct).startRemoteActivity(intent, node)
        return suspendCancellableCoroutine { cont ->
            future.addListener({ cont.resume(runCatching { future.get(); true }.getOrDefault(false)) }, direct)
        }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        events.filter { it.type == DataEvent.TYPE_CHANGED && it.dataItem.uri.path == Paths.SNAPSHOT }
            .mapNotNull { DataMapItem.fromDataItem(it.dataItem).dataMap.getString("json") }
            .forEach { snapshots.tryEmit(it) }
    }

    override fun onMessageReceived(e: MessageEvent) {
        diag("ack from ${e.sourceNodeId} path=${e.path}: ${String(e.data, Charsets.UTF_8)}")
        if (e.path != Paths.ACK) return
        if (phoneNode == null) {
            confirmed = e.sourceNodeId
            phoneNode = e.sourceNodeId
            diag("ACK로 우이런 폰 확인 → phoneNode=${e.sourceNodeId}, CONNECTED")
            conn.value = Conn.CONNECTED
            scope.launch { loadLatest() }
        }
        acks.tryEmit(String(e.data, Charsets.UTF_8))
    }

    override fun onCapabilityChanged(info: CapabilityInfo) {
        diag("onCapabilityChanged name=${info.name} nodes=${info.nodes.fmt()}")
        scope.launch { refresh() }
    }

    private companion object {
        const val TAG = "UirunLink"
        const val DIAG = "UirunDiag"
        const val WATCH_CAPABILITY = "uirun_watch_app" // res/values/wear.xml과 같은 이름
    }
}
