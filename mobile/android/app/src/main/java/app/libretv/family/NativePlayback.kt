package app.libretv.family

import android.app.Activity
import android.app.AlertDialog
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.*
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import okhttp3.*
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

@UnstableApi
class NativePlayback(
    private val activity: Activity, val session: PlaybackSession, private val origin: Uri, private val client: OkHttpClient,
    private val report: (JSONObject) -> Unit, private val onClose: () -> Unit
) : FrameLayout(activity) {
    private val handler = Handler(Looper.getMainLooper())
    private val player = ExoPlayer.Builder(activity).setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(client))).build()
    private val title = TextView(activity)
    private val info = TextView(activity)
    private val time = TextView(activity)
    private val seek = SeekBar(activity)
    private val play = Button(activity)
    private val speed = Button(activity)
    private val sleepTimer = SleepTimer()
    private var sleeping = false
    private var userPaused = false
    private var finished = false
    private var closed = false
    private var generation = 0L
    private var sequence = 0L
    private var ticks = 0
    private var dragging = false
    private var proxied = false
    private var resolved: String? = null
    private var resolvedType: String? = null
    private var call: Call? = null
    private val playbackPosition = PlaybackPosition(session.episodes.map { it.position })
    private val ticker = object : Runnable {
        override fun run() {
            if (closed) return
            ticks++; updateTime(); if (!checkDeadline() && ticks % 5 == 0) emit("progress")
            handler.postDelayed(this, 1000)
        }
    }
    init {
        setBackgroundColor(Color.BLACK)
        val video = PlayerView(activity).apply { player = this@NativePlayback.player; useController = false }
        addView(video, LayoutParams(-1, -1))
        val top = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; setBackgroundColor(0xAA000000.toInt()); gravity = Gravity.CENTER_VERTICAL }
        top.addView(button("返回") { close() }); title.setTextColor(Color.WHITE); title.textSize = 14f; top.addView(title, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(button("横竖屏") { activity.requestedOrientation = if (resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE })
        addView(top, LayoutParams(-1, -2, Gravity.TOP))
        val controls = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(12, 8, 12, 8); setBackgroundColor(0xBB000000.toInt()) }
        listOf(info, time).forEach { it.setTextColor(Color.WHITE); it.textSize = 13f; controls.addView(it) }
        seek.max = 10000
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {}
            override fun onStartTrackingTouch(bar: SeekBar) { dragging = true }
            override fun onStopTrackingTouch(bar: SeekBar) { dragging = false; if (duration > 0) { finished = false; player.seekTo((duration * bar.progress / 10000 * 1000).toLong()) } }
        })
        controls.addView(seek)
        play.text = "暂停"; play.setOnClickListener { toggle() }
        speed.text = "${session.rate} 倍"; speed.setOnClickListener {
            val rates = listOf(.5f, .75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 3f)
            AlertDialog.Builder(activity).setTitle("播放速度").setSingleChoiceItems(rates.map { "$it 倍速" }.toTypedArray(), rates.indexOf(session.rate)) { dialog, which ->
                session.rate = rates[which]; player.setPlaybackSpeed(session.rate); speed.text = "${session.rate} 倍"; dialog.dismiss()
            }.setNegativeButton("取消", null).show()
        }
        controls.addView(row(button("上一集") { select(session.index - 1) }, play, button("下一集") { select(session.index + 1) }, compact = true))
        controls.addView(row(button("选集") {
            AlertDialog.Builder(activity).setTitle("选集").setSingleChoiceItems(session.episodes.map { it.title }.toTypedArray(), session.index) { dialog, which -> dialog.dismiss(); select(which) }.setNegativeButton("关闭", null).show()
        }, speed, button("定时") {
            val minutes = listOf(0, 15, 30, 45, 60, 90, 120)
            AlertDialog.Builder(activity).setTitle("定时停止").setItems(minutes.map { if (it == 0) "关闭定时" else "$it 分钟后停止" }.toTypedArray()) { _, which ->
                sleepTimer.set(minutes[which])
                updateTime()
            }.show()
        }))
        addView(controls, LayoutParams(-1, -2, Gravity.BOTTOM))
        player.setAudioAttributes(AudioAttributes.Builder().setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).setUsage(C.USAGE_MEDIA).build(), true)
        player.setHandleAudioBecomingNoisy(true)
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (closed) return
                if (state == Player.STATE_READY && playbackPosition.isRestoring) {
                    playbackPosition.didRestore(); info.text = ""
                    val restore = playbackPosition.restorePosition
                    if (restore > 0 && restore < duration - 2) player.seekTo((restore * 1000).toLong())
                    player.setPlaybackSpeed(session.rate)
                    if (!checkDeadline() && !sleeping && !userPaused) player.play()
                }
                if (state == Player.STATE_ENDED) {
                    if (checkDeadline()) return
                    finished = true; playbackPosition.record(0.0); emit("ended")
                    if (session.autoplayNext && session.index < session.episodes.lastIndex) load(session.index + 1)
                }
            }
            override fun onPlayerError(error: PlaybackException) {
                val target = resolved
                if (!proxied && target != null && !(sameOrigin(Uri.parse(target), origin) && Uri.parse(target).path == "/api/proxy")) {
                    proxied = true; info.text = "直连失败，正在通过服务重试…"
                    // Capture before setMediaItem resets the failed player's clock.
                    playbackPosition.prepareRetry(player.currentPosition / 1000.0)
                    val proxy = origin.buildUpon().path("/api/proxy").appendQueryParameter("url", target).build().toString()
                    attach(proxy)
                } else { player.pause(); info.text = "无法播放此源，请返回换源或使用网页播放器"; emit("error") }
            }
        })
    }
    private fun row(vararg buttons: Button, compact: Boolean = false): LinearLayout = LinearLayout(activity).apply {
        gravity = Gravity.START
        buttons.forEach { addView(it, if (compact) LinearLayout.LayoutParams(-2, -2) else LinearLayout.LayoutParams(0, -2, 1f)) }
    }
    private fun button(text: String, action: () -> Unit): Button = Button(activity).apply { this.text = text; textSize = 13f; minWidth = 0; setOnClickListener { action() } }
    fun start() { activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); handler.post(ticker); load(session.index) }
    private fun load(index: Int) {
        if (closed || index !in session.episodes.indices) return
        call?.cancel(); generation++; val token = generation
        player.pause(); player.stop(); player.clearMediaItems()
        session.index = index; userPaused = false; sleeping = false; finished = false; proxied = false; resolvedType = null
        playbackPosition.selectEpisode(index)
        title.text = "${session.title} · 第 ${index + 1}/${session.episodes.size} 集"; info.text = "正在加载…"; emit("episode")
        val raw = session.episodes[index].url; val uri = Uri.parse(raw)
        if (sameOrigin(uri, origin) && uri.path == "/api/site-playback") {
            call = client.newBuilder().followRedirects(false).followSslRedirects(false).build().newCall(Request.Builder().url(raw).build())
            call!!.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { activity.runOnUiThread { if (!closed && token == generation) { info.text = "播放线路解析失败，请返回换源"; emit("error") } } }
                override fun onResponse(call: Call, response: Response) {
                    val result = response.use { runCatching {
                        require(it.isSuccessful)
                        val json = JSONObject(it.body!!.string())
                        val url = json.getString("url"); val uri = Uri.parse(url)
                        require(uri.scheme in listOf("http", "https") && uri.host != null && uri.userInfo == null)
                        Pair(url, json.optString("type"))
                    }.getOrNull() }
                    activity.runOnUiThread { if (!closed && token == generation) { if (result == null) { info.text = "播放线路解析失败，请返回换源"; emit("error") } else { resolved = result.first; resolvedType = result.second; attach(result.first) } } }
                }
            })
        } else { resolved = raw; attach(raw) }
    }
    private fun attach(url: String) {
        val item = MediaItem.Builder().setUri(url).apply {
            // Proxy query paths have no media extension; infer from the original resolved URL.
            val original = Uri.parse(resolved ?: url).path ?: ""
            if (resolvedType == "m3u8" || original.endsWith(".m3u8", true)) setMimeType("application/x-mpegURL")
            else if (resolvedType == "mp4" || original.endsWith(".mp4", true)) setMimeType("video/mp4")
        }.build()
        player.setMediaItem(item); player.prepare()
    }
    private val position get() = if (playbackPosition.isRestoring || player.currentMediaItem == null) playbackPosition.savedPosition else (player.currentPosition.coerceAtLeast(0) / 1000.0)
    private val duration get() = player.duration.let { if (it > 0) it / 1000.0 else 0.0 }
    private fun emit(reason: String) {
        if (closed) return
        sequence++; if (!finished) playbackPosition.record(position)
        val event = JSONObject()
        listOf("profileId", "sourceKey", "sourceUrl", "vodId", "title", "baseRevision", "openedAt").forEach { if (session.json.has(it)) event.put(it, session.json.get(it)) }
        event.put("eventId", UUID.randomUUID().toString()).put("sessionId", session.id).put("index", session.index).put("total", session.episodes.size)
            .put("position", position).put("duration", duration).put("sequence", sequence).put("rate", session.rate).put("ended", finished).put("reason", reason)
        report(event)
    }
    private fun checkDeadline(): Boolean {
        if (!sleepTimer.consumeExpired()) return false
        sleeping = true; userPaused = true; session.autoplayNext = false; player.pause(); info.text = "已定时停止，自动连播已关闭"; emit("sleep"); return true
    }
    private fun updateTime() {
        if (!dragging) seek.progress = if (duration > 0) (10000 * position / duration).toInt() else 0
        val left = sleepTimer.minutesRemaining?.let { " · $it 分钟后停止" } ?: ""
        time.text = "${format(position)} / ${format(duration)}$left"; play.text = if (player.isPlaying) "暂停" else "播放"
    }
    private fun format(value: Double): String { val n = value.toInt(); return "%02d:%02d".format(n / 60, n % 60) }
    private fun toggle() {
        if (checkDeadline()) return
        if (player.playWhenReady) { userPaused = true; player.pause(); emit("pause") }
        else { userPaused = false; sleeping = false; if (finished) { finished = false; player.seekTo(0) }; player.play() }
    }
    private fun select(index: Int) { if (index in session.episodes.indices && index != session.index) { emit("pause"); load(index) } }
    fun background() { userPaused = true; player.pause(); emit("pause") }
    fun foreground() { checkDeadline(); updateTime() }
    fun close() { if (closed) return; emit("close"); release(); activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED; onClose() }
    fun release() { if (closed) return; closed = true; call?.cancel(); handler.removeCallbacks(ticker); player.release() }
}
