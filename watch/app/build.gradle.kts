import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Data Layer는 폰·워치의 applicationId와 서명 인증서가 같아야 연결된다.
// 워치 debug 서명은 폰 개발 빌드가 실제로 쓰는 키(Expo prebuild가 만든 mobile/android/app/debug.keystore)를 그대로 쓴다.
// 사용자 기본 ~/.android/debug.keystore와 다를 수 있으므로 기본 debug 키에 맡기지 않는다. 다른 위치면 -PuirunDebugKeystore=<경로>.
val phoneDebugKeystore = rootProject.file(
    providers.gradleProperty("uirunDebugKeystore").getOrElse("../mobile/android/app/debug.keystore"),
)

// 브랜드 글꼴·아이콘은 폰 앱 자산(mobile/assets)을 저장소에 복사해 두지 않고 빌드 때 필요한 파일만 가져온다.
val brandDir = layout.buildDirectory.dir("generated/brand")
val brandAssets = tasks.register<Sync>("brandAssets") {
    from(rootProject.file("../mobile/assets/fonts")) {
        include("IBMPlexSansKR-SemiBold.ttf", "IBMPlexSansKR-Bold.ttf", "ArchivoNum-ExtraBold.ttf", "OFL-*.txt")
        into("assets/fonts")
    }
    from(rootProject.file("../mobile/assets/brand/adaptive-foreground.png")) {
        rename { "ic_launcher_foreground.png" }
        into("res/mipmap-xxxhdpi")
    }
    into(brandDir)
}

android {
    namespace = "com.attentionall.uirun.watch"
    compileSdk = 36

    defaultConfig {
        // 폰 앱과 같은 applicationId(.watch 접미사를 붙이지 않는다). Kotlin 패키지만 구분한다.
        applicationId = "com.attentionall.uirun"
        // Wear OS 3(API 30) 이상. Tizen 기반 갤럭시워치는 지원하지 않는다.
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        getByName("debug") {
            storeFile = phoneDebugKeystore
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        // 릴리스는 서명하지 않은 APK만 만든다. 배포 서명은 폰 앱과 같은 릴리스 키로 팀이 따로 한다(키를 저장소에 두지 않는다).
        release {
            isMinifyEnabled = false
            signingConfig = null
        }
    }

    sourceSets["main"].assets.srcDir(brandDir.map { it.dir("assets") })
    sourceSets["main"].res.srcDir(brandDir.map { it.dir("res") })

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

tasks.named("preBuild") { dependsOn(brandAssets) }
tasks.matching { it.name == "validateSigningDebug" }.configureEach {
    doFirst {
        if (!phoneDebugKeystore.exists()) {
            throw GradleException(
                "폰 debug 키가 없습니다: $phoneDebugKeystore\n" +
                    "mobile에서 npx expo prebuild --platform android 를 먼저 실행하거나 -PuirunDebugKeystore=<폰 debug.keystore 경로>를 지정하세요.",
            )
        }
    }
}

dependencies {
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.wear.compose:compose-material3:1.5.6")
    implementation("androidx.wear.compose:compose-foundation:1.5.6")
    implementation("androidx.wear:wear-remote-interactions:1.1.0")
    implementation("com.google.android.gms:play-services-wearable:19.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("org.json:json:20240303") // android.jar의 org.json은 JVM 테스트에서 비어 있다
}
