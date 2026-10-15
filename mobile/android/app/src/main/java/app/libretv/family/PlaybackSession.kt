package app.libretv.family

import android.net.Uri
import org.json.JSONObject

fun sameOrigin(a: Uri, b: Uri): Boolean = a.scheme == b.scheme && a.host == b.host && (if (a.port < 0) if (a.scheme == "https") 443 else 80 else a.port) == (if (b.port < 0) if (b.scheme == "https") 443 else 80 else b.port)
fun serviceOrigin(text: String): Uri? = runCatching {
    val u = Uri.parse(text.trim())
    require(u.host != null && u.userInfo == null && (u.scheme == "https" || (BuildConfig.DEBUG && u.scheme == "http" && u.host in listOf("localhost", "127.0.0.1", "10.0.2.2"))))
    u.buildUpon().path("").clearQuery().fragment(null).build()
}.getOrNull()

data class Episode(val url: String, val title: String, var position: Double)
class PlaybackSession(val json: JSONObject) {
    val id = json.getString("id")
    val title = json.getString("title")
    var index = json.getInt("index")
    var rate = json.getDouble("rate").toFloat()
    var autoplayNext = json.getBoolean("autoplayNext")
    val episodes = json.getJSONArray("episodes").let { list -> (0 until list.length()).map { n -> val e = list.getJSONObject(n); Episode(e.getString("url"), e.getString("title"), e.getDouble("position")) } }
    init {
        require(id.length in 1..80 && title.length in 1..512 && episodes.size in 1..10000 && index in episodes.indices)
        require(json.getString("sourceKey").length in 1..256 && json.getString("vodId").length in 1..2048)
        require(json.isNull("profileId") || json.getString("profileId").matches(Regex("[a-f0-9-]{36}")))
        require(json.getLong("baseRevision") >= 0 && json.getLong("openedAt") > 0)
        require(rate in listOf(.5f, .75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 3f))
        require(episodes.all { val u = Uri.parse(it.url); u.scheme in listOf("http", "https") && u.host != null && u.userInfo == null && it.url.length <= 8192 && it.position.isFinite() && it.position in 0.0..864000.0 })
    }
}
