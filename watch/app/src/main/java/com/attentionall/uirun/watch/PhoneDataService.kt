package com.attentionall.uirun.watch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import java.util.UUID

// 워치 앱 화면이 없을 때 새 체크포인트를 알림(진동)으로 한 번만 알린다. 누르면 앱이 W3를 띄운다(30초는 그때부터).
// 알린 뒤 폰에 ALERT_SHOWN을 보내 폰이 같은 알림을 다시 울리지 않게 한다. 보내지 못하면 폰이 자기 알림으로 대신한다.
class PhoneDataService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        if (WatchVisibility.visible) return // 화면이 직접 처리한다
        val json = events.lastOrNull { it.type == DataEvent.TYPE_CHANGED && it.dataItem.uri.path == Paths.SNAPSHOT }
            ?.let { DataMapItem.fromDataItem(it.dataItem).dataMap.getString("json") } ?: return
        val s = Snapshot.parse(json) ?: return
        val ex = s.exposure ?: return
        val notified = PrefsAlertBook.notified(this)
        if (s.session?.status != RunStatus.ACTIVE || ex.expiresInMs <= 0 || notified.seen(s.epoch, ex.id) || PrefsAlertBook.get(this).seen(s.epoch, ex.id)) return
        val nm = getSystemService(NotificationManager::class.java)
        if (!nm.areNotificationsEnabled()) return // 알림 권한 없음: ACK를 보내지 않아 폰 알림이 대신한다
        notified.mark(s.epoch, ex.id)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "체크포인트", NotificationManager.IMPORTANCE_HIGH).apply { vibrationPattern = longArrayOf(0, 150, 120, 150) })
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        nm.notify(
            NOTIFICATION_ID,
            Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(if (ex.kind == "ISSUE") "체크포인트" else "정기 관찰 지점")
                .setContentText(ex.title.ifEmpty { "눌러서 확인해주세요" })
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setTimeoutAfter(ex.expiresInMs)
                .setContentIntent(open)
                .build(),
        )
        val ack = command("ALERT_SHOWN", UUID.randomUUID().toString(), s.epoch, "exposureId" to ex.id).toByteArray()
        Wearable.getNodeClient(this).connectedNodes.addOnSuccessListener { nodes ->
            nodes.forEach { Wearable.getMessageClient(this).sendMessage(it.id, Paths.COMMAND, ack) }
        }
    }

    companion object {
        const val CHANNEL = "checkpoint"
        const val NOTIFICATION_ID = 7
    }
}
