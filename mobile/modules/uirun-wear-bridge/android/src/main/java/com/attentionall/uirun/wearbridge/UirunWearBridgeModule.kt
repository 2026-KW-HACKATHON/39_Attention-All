package com.attentionall.uirun.wearbridge

import android.app.KeyguardManager
import android.content.Context
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

// JS(mobile/src/wear.ts)와 Wearable Data Layer 사이의 얇은 연결. 판단(검증·중복·만료)은 JS의 wearlogic.ts가 한다.
class UirunWearBridgeModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("UirunWearBridge")
    Events("onCommand")

    OnCreate {
      appContext.reactContext?.let {
        WearHub.announce(it, "module-create")
        WearHub.diagnose(it, "module-create")
      }
    }
    OnStartObserving {
      WearHub.sink = { json, nodeId -> sendEvent("onCommand", mapOf("json" to json, "nodeId" to nodeId)) }
      appContext.reactContext?.let { WearHub.diag(it, "JS가 onCommand 구독 시작(sink 설정)") }
    }
    OnStopObserving {
      WearHub.sink = null
      appContext.reactContext?.let { WearHub.diag(it, "JS가 onCommand 구독 해제(sink 해제)") }
    }
    OnDestroy { WearHub.sink = null }

    // 임시 진단: 노드·capability 상태를 logcat UirunDiag로(디버그 빌드만)
    Function("diagnose") { reason: String -> WearHub.diagnose(ctx, reason) }

    Function("setAccount") { key: String? -> WearHub.setAccount(ctx, key).toDouble() }
    Function("takePending") { WearHub.takePending(ctx) }
    Function("isPhoneLocked") { (ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked }

    // 스냅샷 1건을 Data Layer에 쓴다(계정 세대·순번은 여기서 붙인다). urgent: 지연 없이 바로 동기화.
    AsyncFunction("publish") { json: String, promise: Promise ->
      val c = ctx
      val revision = WearHub.nextRevision(c)
      val body = JSONObject(json).put("epoch", WearHub.epoch(c)).put("revision", revision).toString()
      val req = PutDataMapRequest.create(WearHub.PATH_SNAPSHOT).apply {
        dataMap.putString("json", body)
        dataMap.putLong("revision", revision)
      }.asPutDataRequest().setUrgent()
      Wearable.getDataClient(c).putDataItem(req)
        .addOnSuccessListener { promise.resolve(revision.toDouble()) }
        .addOnFailureListener { promise.reject("E_WEAR_PUBLISH", it.javaClass.simpleName, it) }
    }

    AsyncFunction("ack") { nodeId: String?, json: String -> WearHub.sendAck(ctx, nodeId, json) }

    // 우이런 워치 앱이 있는 워치: reachable=false면 짝지어진 적만 있어도 true(스냅샷은 연결되면 전달된다), true면 지금 연결된 것만.
    // capability가 비면 명령을 보낸 적 있는 워치 노드로 보완한다(reachable이면 그 노드가 지금 연결돼 있는지까지).
    AsyncFunction("hasWatch") { reachable: Boolean, promise: Promise ->
      val c = ctx
      Wearable.getCapabilityClient(c).getCapability(WearHub.WATCH_CAPABILITY, if (reachable) CapabilityClient.FILTER_REACHABLE else CapabilityClient.FILTER_ALL)
        .addOnSuccessListener { info ->
          val known = WearHub.watchNode(c)
          when {
            info.nodes.isNotEmpty() -> promise.resolve(true)
            known == null -> promise.resolve(false)
            !reachable -> promise.resolve(true)
            else -> Wearable.getNodeClient(c).connectedNodes
              .addOnSuccessListener { nodes -> promise.resolve(nodes.any { it.id == known }) }
              .addOnFailureListener { promise.resolve(false) }
          }
          WearHub.diag(c, "hasWatch(reachable=$reachable): capability=${info.nodes.map { it.id }}, 기억한 워치=$known")
        }
        .addOnFailureListener { promise.resolve(false) } // Wear API 없음(워치 미사용 폰)
    }

    // 워치가 이 체크포인트를 알렸다고 답할 때까지 최대 timeoutMs 기다린다(false면 폰이 직접 알린다).
    AsyncFunction("awaitAlertShown") { exposureId: String, timeoutMs: Double, promise: Promise ->
      WearHub.awaitAlert(exposureId, timeoutMs.toLong()) { promise.resolve(it) }
    }
  }
}
