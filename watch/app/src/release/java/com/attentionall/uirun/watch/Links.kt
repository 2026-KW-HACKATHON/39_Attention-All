package com.attentionall.uirun.watch

import android.app.Application
import kotlinx.coroutines.CoroutineScope

// 릴리스: 실제 Data Layer만 쓴다. DEMO 데이터 소스는 이 빌드에 들어 있지 않다(src/debug 전용).
object Links {
    fun create(app: Application, scope: CoroutineScope, @Suppress("UNUSED_PARAMETER") scenario: String?): PhoneLink = DataLayerLink(app, scope)

    @Suppress("UNUSED_PARAMETER")
    fun script(c: WatchController, scope: CoroutineScope, scenario: String?) = Unit
}
