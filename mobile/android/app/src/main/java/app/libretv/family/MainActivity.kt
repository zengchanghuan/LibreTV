package app.libretv.family

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import okhttp3.*
import org.json.JSONObject

@androidx.media3.common.util.UnstableApi
class MainActivity : Activity() {
    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var status: TextView
    private lateinit var retry: Button
    private val prefs by lazy { getSharedPreferences("libretv", MODE_PRIVATE) }
    private var origin: Uri? = null
    private var playback: NativePlayback? = null
    private var navigationFailed = false
    private var pending = JSONObject()
    private val pendingKey get() = "pending:${origin}"
    private val bridgeScript = """window.__LIBRETV_NATIVE__={version:1,platform:'android',postMessage:m=>libretvNative.postMessage(JSON.stringify(m))};window.dispatchEvent(new Event('libretv:native-ready'));"""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this); root.setBackgroundColor(Color.BLACK); setContentView(root)
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                val safe = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
                v.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val toolbar = LinearLayout(this)
        listOf("首页" to { origin?.let { connect(it) } }, "设置" to { settings() }).forEach { (title, action) ->
            toolbar.addView(Button(this).apply { text = title; setOnClickListener { action() } }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        web = WebView(this)
        web.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = true; allowFileAccess = false; allowContentAccess = false; mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; userAgentString += " LibreTVNative/1" }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        column.addView(web, LinearLayout.LayoutParams(-1, 0, 1f)); column.addView(toolbar)
        root.addView(column, FrameLayout.LayoutParams(-1, -1))
        status = TextView(this).apply { setTextColor(Color.WHITE); gravity = android.view.Gravity.CENTER; text = "请设置家庭服务的 HTTPS 地址" }
        retry = Button(this).apply { text = "重试"; visibility = View.GONE; setOnClickListener { origin?.let { connect(it) } } }
        val connectionStatus = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = android.view.Gravity.CENTER
            addView(status); addView(retry)
        }
        root.addView(connectionStatus, FrameLayout.LayoutParams(-1, -2, android.view.Gravity.CENTER))
        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) { navigationFailed = false }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (origin?.let { sameOrigin(request.url, it) } == true) return false
                if (request.isForMainFrame && request.hasGesture() && request.url.scheme in listOf("http", "https")) runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!navigationFailed && origin?.let { sameOrigin(Uri.parse(url), it) } == true) { status.text = ""; retry.visibility = View.GONE; web.evaluateJavascript(bridgeScript, null) }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) { if (request.isForMainFrame) { navigationFailed = true; status.text = "连接失败，请检查地址和网络后重试"; retry.visibility = View.VISIBLE } }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) { handler.cancel(); navigationFailed = true; status.text = "服务证书校验失败"; retry.visibility = View.VISIBLE }
        }
        val saved = prefs.getString("serviceURL", null)?.let { serviceOrigin(it) }
        (serviceOrigin(BuildConfig.DEFAULT_SERVICE_URL) ?: saved)?.let { connect(it) }
    }
    private fun settings() {
        origin?.let { web.loadUrl(it.buildUpon().path("/settings").build().toString()) }
    }
    private fun connect(url: Uri) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { status.text = "请更新 Android System WebView 后重试"; return }
        if (origin != null) WebViewCompat.removeWebMessageListener(web, "libretvNative")
        origin = url; prefs.edit().putString("serviceURL", url.toString()).apply()
        pending = runCatching { JSONObject(prefs.getString(pendingKey, "{}")!!) }.getOrDefault(JSONObject())
        WebViewCompat.addWebMessageListener(web, "libretvNative", setOf(url.toString())) { _, message, sourceOrigin, isMainFrame, _ ->
            if (isMainFrame && sameOrigin(sourceOrigin, url)) runCatching { command(JSONObject(message.data ?: "{}")) }
        }
        retry.visibility = View.GONE; status.text = "正在连接…"; web.loadUrl(url.toString())
    }
    private fun command(body: JSONObject) {
        when (body.optString("type")) {
            "ready" -> flush()
            "ack" -> { val id = body.optString("eventId"); pending.keys().asSequence().toList().filter { pending.getJSONObject(it).optString("eventId") == id }.forEach { pending.remove(it) }; persist() }
            "close" -> if (playback?.session?.id == body.optString("sessionId")) playback?.close()
            "open" -> {
                if (playback != null) return
                val session = PlaybackSession(body.getJSONObject("session")); val service = origin ?: return
                val native = NativePlayback(this, session, service, client(service), ::record) {
                    playback?.let { root.removeView(it) }; playback = null
                    window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    fullscreen(false)
                }
                playback = native; root.addView(native, FrameLayout.LayoutParams(-1, -1)); fullscreen(true); native.start()
            }
        }
    }
    private fun fullscreen(enabled: Boolean) {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.apply {
                systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                if (enabled) hide(android.view.WindowInsets.Type.systemBars()) else show(android.view.WindowInsets.Type.systemBars())
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (enabled) View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY else View.SYSTEM_UI_FLAG_VISIBLE
        }
        root.requestApplyInsets()
    }
    private fun client(service: Uri): OkHttpClient = OkHttpClient.Builder().cookieJar(object : CookieJar {
        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            if (!sameOrigin(Uri.parse(url.toString()), service)) return emptyList()
            return CookieManager.getInstance().getCookie(url.toString())?.split(';')?.mapNotNull { part ->
                val parts = part.trim().split('=', limit = 2)
                if (parts.size != 2) null else runCatching { Cookie.Builder().name(parts[0]).value(parts[1]).hostOnlyDomain(url.host).path("/").apply { if (url.isHttps) secure() }.build() }.getOrNull()
            } ?: emptyList()
        }
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) { if (sameOrigin(Uri.parse(url.toString()), service)) cookies.forEach { CookieManager.getInstance().setCookie(url.toString(), it.toString()) } }
    }).build()
    private fun record(event: JSONObject) { pending.put("${event.getString("sessionId")}:${event.getInt("index")}", event); persist(); send(event) }
    private fun persist() { prefs.edit().putString(pendingKey, pending.toString()).commit() }
    private fun send(event: JSONObject) {
        if (origin?.let { sameOrigin(Uri.parse(web.url ?: ""), it) } == true) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('libretv:native-progress',{detail:$event}))", null)
    }
    private fun flush() { pending.keys().asSequence().map { pending.getJSONObject(it) }.sortedWith(compareBy<JSONObject> { it.optLong("openedAt") }.thenBy { it.optLong("sequence") }).forEach(::send) }
    override fun onPause() { playback?.background(); super.onPause() }
    override fun onResume() { super.onResume(); playback?.foreground(); if (::web.isInitialized) flush() }
    private fun handleBack() { if (playback != null) playback?.close() else if (web.canGoBack()) web.goBack() else finish() }
    @Deprecated("Deprecated in Java") override fun onBackPressed() { handleBack() }
    override fun onDestroy() { playback?.release(); if (::web.isInitialized) { web.removeAllViews(); web.destroy() }; super.onDestroy() }
}
