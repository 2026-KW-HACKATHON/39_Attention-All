// 버전은 폰 앱(mobile, RN 0.86 툴체인)과 같은 AGP·Kotlin으로 고정한다. 같은 PC·JDK 17에서 두 프로젝트를 빌드한다.
plugins {
    id("com.android.application") version "8.12.0" apply false
    id("org.jetbrains.kotlin.android") version "2.1.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.20" apply false
}
