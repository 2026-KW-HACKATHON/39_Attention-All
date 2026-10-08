package com.attentionall.uirun.watch

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.VibratorManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.attentionall.uirun.watch.ui.WatchApp

class WatchViewModel(app: Application, scenario: String?) : AndroidViewModel(app) {
    // 개발 빌드에서만 ?demo 시나리오로 DEMO 데이터를 쓸 수 있다(Links는 src/debug·src/release에 따로 있다).
    private val link = Links.create(app, viewModelScope, scenario)
    val controller = WatchController(link, viewModelScope, SystemClock::elapsedRealtime, book = PrefsAlertBook.get(app), onAlert = {
        val vibrator = if (Build.VERSION.SDK_INT >= 31) app.getSystemService(VibratorManager::class.java).defaultVibrator
            else app.getSystemService(android.os.Vibrator::class.java)
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 150, 120, 150), -1))
    }).also {
        it.start()
        Links.script(it, viewModelScope, scenario)
    }

    override fun onCleared() = link.stop()
}

class MainActivity : ComponentActivity() {
    private val vm: WatchViewModel by viewModels {
        viewModelFactory { initializer { WatchViewModel(application, intent.getStringExtra("demo")) } }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1) // 거절해도 화면 안 W3는 그대로, 폰 알림으로 대신한다
        }
        setContent {
            val ui by vm.controller.ui.collectAsStateWithLifecycle()
            WatchApp(ui, vm.controller)
        }
    }

    override fun onStart() {
        super.onStart()
        vm.controller.setVisible(true)
        getSystemService(NotificationManager::class.java).cancel(PhoneDataService.NOTIFICATION_ID) // 화면이 직접 W3를 띄운다
    }

    override fun onStop() {
        vm.controller.setVisible(false)
        super.onStop()
    }
}
