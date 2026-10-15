import Foundation

/// Keep the retry target separate from periodic progress and the temporary zero during loading.
final class PlaybackPosition {
    private var positions: [Double]
    private var index = 0
    private(set) var restorePosition: Double = 0
    private(set) var isRestoring = true
    var savedPosition: Double { positions[index] }

    init(positions: [Double]) { self.positions = positions }
    func selectEpisode(_ index: Int) {
        self.index = index
        restorePosition = savedPosition
        isRestoring = true
    }
    func didRestore() { isRestoring = false }
    func record(_ position: Double) {
        guard position.isFinite, position >= 0 else { return }
        positions[index] = position
    }
    func prepareRetry(currentPosition: Double) {
        if !isRestoring { record(currentPosition) }
        restorePosition = savedPosition
        isRestoring = true
    }
}
