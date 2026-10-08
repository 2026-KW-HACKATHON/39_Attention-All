package com.attentionall.uirun.watch

import android.content.Context

// 같은 exposureId 알림은 워치에서 한 번만 띄운다(화면·백그라운드 알림·워치 재시작 공통). 계정 세대(epoch)가 바뀌면 비운다.
open class AlertBook {
    private var epoch = 0L
    protected val ids = LinkedHashSet<String>()

    @Synchronized
    fun seen(epoch: Long, id: String) = this.epoch == epoch && id in ids

    @Synchronized
    fun mark(epoch: Long, id: String) {
        if (this.epoch != epoch) {
            ids.clear()
            this.epoch = epoch
        }
        ids += id
        while (ids.size > 20) ids.remove(ids.first())
        save(this.epoch, ids.toList())
    }

    @Synchronized
    fun clear() {
        ids.clear()
        save(epoch, emptyList())
    }

    protected fun restore(epoch: Long, list: List<String>) {
        this.epoch = epoch
        ids += list
    }

    protected open fun save(epoch: Long, list: List<String>) {}
}

class PrefsAlertBook private constructor(ctx: Context, name: String) : AlertBook() {
    private val prefs = ctx.getSharedPreferences(name, Context.MODE_PRIVATE)

    init {
        restore(prefs.getLong("epoch", 0), prefs.getString("ids", "")!!.split(',').filter { it.isNotEmpty() })
    }

    override fun save(epoch: Long, list: List<String>) {
        prefs.edit().putLong("epoch", epoch).putString("ids", list.joinToString(",")).apply()
    }

    companion object {
        @Volatile private var screen: PrefsAlertBook? = null
        @Volatile private var notifiedBook: PrefsAlertBook? = null

        // 화면에서 W3로 보여준 체크포인트
        fun get(ctx: Context) = screen ?: synchronized(this) { screen ?: PrefsAlertBook(ctx.applicationContext, "uirun_alerts").also { screen = it } }

        // 화면이 없을 때 알림으로 울린 체크포인트(같은 것을 두 번 울리지 않는다. 누르면 화면이 W3를 한 번 보여준다)
        fun notified(ctx: Context) = notifiedBook ?: synchronized(this) { notifiedBook ?: PrefsAlertBook(ctx.applicationContext, "uirun_alerts_notified").also { notifiedBook = it } }
    }
}

// 워치 화면이 보이는지(보이면 화면이 W3를 띄우고, 아니면 PhoneDataService가 알림으로 알린다)
object WatchVisibility {
    @Volatile var visible = false
}
