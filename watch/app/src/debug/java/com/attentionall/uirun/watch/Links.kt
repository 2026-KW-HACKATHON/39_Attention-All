package com.attentionall.uirun.watch

import android.app.Application
import kotlinx.coroutines.CoroutineScope

// 개발 빌드: 실행 인자 `--es demo <시나리오>`가 있을 때만 DEMO 데이터(화면에 DEMO 표시). 없으면 실제 폰 연결.
object Links {
    fun create(app: Application, scope: CoroutineScope, scenario: String?): PhoneLink =
        if (scenario != null) DemoLink(scope, scenario) else DataLayerLink(app, scope)

    fun script(c: WatchController, scope: CoroutineScope, scenario: String?) {
        if (scenario != null) DemoLink.script(c, scope, scenario)
    }
}
