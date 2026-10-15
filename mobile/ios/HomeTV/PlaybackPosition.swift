import Foundation

/// Keep the retry target separate from periodic progress and the temporary zero during loading.
final class PlaybackPosition {
    private var positions: [Double]
    private var index = 0
    private(set) var restorePosition: Double = 0
    private(set) var isRestoring = true
    private var pendingSeek: (id: UUID, position: Double)?
    var savedPosition: Double { positions[index] }

    init(positions: [Double]) { self.positions = positions }
    func selectEpisode(_ index: Int) {
        self.index = index
        pendingSeek = nil
        restorePosition = savedPosition
        isRestoring = true
    }
    func didRestore() { isRestoring = false }
    func beginSeek(to position: Double) -> UUID {
        let id = UUID()
        guard position.isFinite, position >= 0 else { return id }
        pendingSeek = (id, position)
        positions[index] = position
        return id
    }
    func finishSeek(_ id: UUID) {
        guard pendingSeek?.id == id else { return }
        pendingSeek = nil
    }
    func position(currentTime: Double) -> Double {
        if let pendingSeek { return pendingSeek.position }
        guard !isRestoring, currentTime.isFinite, currentTime >= 0 else { return savedPosition }
        return currentTime
    }
    func record(_ position: Double) {
        guard position.isFinite, position >= 0 else { return }
        positions[index] = pendingSeek?.position ?? position
    }
    func prepareRetry(currentPosition: Double) {
        if !isRestoring { record(currentPosition) }
        restorePosition = savedPosition
        isRestoring = true
    }
}
