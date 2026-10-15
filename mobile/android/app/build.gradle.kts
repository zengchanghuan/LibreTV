plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "app.libretv.family"
    compileSdk = 36
    defaultConfig { applicationId = "app.libretv.family"; minSdk = 26; targetSdk = 36; versionCode = 1; versionName = "1.0.0" }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    val signingPath = System.getenv("LIBRETV_KEYSTORE")
    if (signingPath != null) {
        signingConfigs.create("family") {
            storeFile = file(signingPath); storePassword = System.getenv("LIBRETV_STORE_PASSWORD")
            keyAlias = System.getenv("LIBRETV_KEY_ALIAS"); keyPassword = System.getenv("LIBRETV_KEY_PASSWORD")
        }
    }
    buildTypes { getByName("release") { isMinifyEnabled = false; if (signingPath != null) signingConfig = signingConfigs.getByName("family") } }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
    implementation("androidx.media3:media3-datasource-okhttp:1.11.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
