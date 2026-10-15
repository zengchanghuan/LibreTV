package app.libretv.family

/** Keep the retry target separate from periodic progress and the temporary zero during loading. */
class PlaybackPosition(positions: List<Double>) {
    private val positions = positions.toMutableList()
    private var index = 0
    var restorePosition = 0.0
        private set
    var isRestoring = true
        private set
    val savedPosition get() = positions[index]

    fun selectEpisode(index: Int) {
        this.index = index
        restorePosition = savedPosition
        isRestoring = true
    }
    fun didRestore() { isRestoring = false }
    fun record(position: Double) {
        if (position.isFinite() && position >= 0) positions[index] = position
    }
    fun prepareRetry(currentPosition: Double) {
        if (!isRestoring) record(currentPosition)
        restorePosition = savedPosition
        isRestoring = true
    }
}
