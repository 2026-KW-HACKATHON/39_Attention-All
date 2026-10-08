package com.attentionall.uirun.watch.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import java.util.Locale

// 브랜드 색(폰 앱 theme.ts와 같은 값). 주황·갈색·카키 계열은 쓰지 않는다.
object Brand {
    val blue = Color(0xFF384BF0) // 주요 행동·선택
    val deep = Color(0xFF222759) // 보조 행동 배경
    val lime = Color(0xFFCAFF42) // 운동 모드·핵심 강조·서버 확정 보상(넓은 배경으로 쓰지 않는다)
    val black = Color(0xFF111111) // 워치 기본 배경
    val white = Color(0xFFFFFFFF)
    val sub = Color(0xFFC7CADB) // 보조 글자(검은 바탕에서 읽히는 밝기)
}

// 폰 앱 글꼴 재사용: 한글 IBM Plex Sans KR, 숫자 Archivo(폭 78% 숫자 전용). 빌드 때 mobile/assets/fonts에서 가져온다.
data class Fonts(val text: FontFamily, val num: FontFamily)

@Composable
fun rememberFonts(): Fonts {
    val assets = LocalContext.current.assets
    return remember(assets) {
        Fonts(
            text = FontFamily(
                Font("fonts/IBMPlexSansKR-SemiBold.ttf", assets, FontWeight.SemiBold),
                Font("fonts/IBMPlexSansKR-Bold.ttf", assets, FontWeight.Bold),
            ),
            num = FontFamily(Font("fonts/ArchivoNum-ExtraBold.ttf", assets, FontWeight.ExtraBold)),
        )
    }
}

// 작은 원형 화면(폭 200dp 미만)에서는 큰 숫자만 줄인다. 나머지는 Wear 최소 가독 크기를 지킨다.
@Composable
fun bigNumberSize() = if (LocalConfiguration.current.screenWidthDp < 200) 36.sp else 42.sp

fun km(m: Double) = String.format(Locale.US, "%.2f", m / 1000)

// 폰 core.dur과 같은 규칙: m:ss, 1시간 이상 h:mm:ss
fun dur(ms: Long): String {
    val s = ms / 1000
    val h = s / 3600
    val m = (s % 3600) / 60
    val x = s % 60
    return (if (h > 0) "$h:" + m.toString().padStart(2, '0') else m.toString()) + ":" + x.toString().padStart(2, '0')
}

fun pace(secPerKm: Int) = "${secPerKm / 60}′${(secPerKm % 60).toString().padStart(2, '0')}″"
