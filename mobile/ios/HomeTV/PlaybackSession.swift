import Foundation

struct Episode: Codable { let url: String; let title: String; var position: Double }
struct PlaybackSession: Codable {
    let id: String, title: String, sourceKey: String, vodId: String
    let sourceUrl: String?
    let profileId: String?
    var index: Int
    var episodes: [Episode]
    var rate: Float
    var autoplayNext: Bool
    let baseRevision: Int64, openedAt: Int64
    func isValid(origin: URL) -> Bool {
        !id.isEmpty && id.count <= 80 && !title.isEmpty && title.count <= 512 && !sourceKey.isEmpty && sourceKey.count <= 256 &&
        !vodId.isEmpty && vodId.count <= 2048 && (profileId == nil || UUID(uuidString: profileId!) != nil) &&
        !episodes.isEmpty && episodes.count <= 10000 && episodes.indices.contains(index) &&
        [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3].contains(rate) && baseRevision >= 0 && openedAt > 0 &&
        episodes.allSatisfy { URL(string: $0.url).map { ["https", "http"].contains($0.scheme) && $0.host != nil && $0.user == nil && $0.password == nil } == true && $0.url.count <= 8192 && $0.position.isFinite && $0.position >= 0 && $0.position <= 864000 }
    }
}
func sameOrigin(_ a: URL, _ b: URL) -> Bool {
    a.scheme?.lowercased() == b.scheme?.lowercased() && a.host?.lowercased() == b.host?.lowercased() &&
    (a.port ?? (a.scheme == "https" ? 443 : 80)) == (b.port ?? (b.scheme == "https" ? 443 : 80))
}
func serviceOrigin(_ input: String) -> URL? {
    guard var c = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)), c.host != nil, c.user == nil, c.password == nil else { return nil }
    var allowed = c.scheme == "https"
    #if DEBUG
    allowed = allowed || (c.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(c.host!))
    #endif
    guard allowed else { return nil }
    c.path = ""; c.query = nil; c.fragment = nil
    return c.url
}
