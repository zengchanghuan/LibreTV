import Foundation

enum NativeNavigation {
    /// Observe SPA navigation as well as full document loads, without changing its behavior.
    static let script = """
    (() => {
      const notify = () => {
        try { window.__LIBRETV_NATIVE__?.postMessage({type:'navigation',url:location.href}); }
        catch { /* Navigation must still work if the bridge is unavailable. */ }
      };
      for (const name of ['pushState', 'replaceState']) {
        const original = history[name];
        history[name] = function(...args) {
          const result = original.apply(this, args);
          notify();
          return result;
        };
      }
      window.addEventListener('popstate', notify);
      window.addEventListener('hashchange', notify);
      window.addEventListener('pageshow', notify);
      notify();
    })();
    """

    static func tabIndex(for url: URL, origin: URL) -> Int? {
        guard sameOrigin(url, origin) else { return nil }
        let path = url.path
        if path == "/live" || path.hasPrefix("/live/") { return 1 }
        if path == "/hd" || path.hasPrefix("/hd/") { return 2 }
        if path == "/watch", URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "section" && $0.value == "hd" }) == true { return 2 }
        return path == "/settings" || path.hasPrefix("/settings/") || path == "/about" || path == "/about/" ? 3 : 0
    }

    static func url(forTab index: Int, origin: URL, currentURL: URL? = nil, retrying: Bool = false) -> URL? {
        // A live page owns playback and search state. Reselecting its tab must
        // not replace the document; a failed navigation still needs a retry.
        if [1, 2].contains(index), !retrying, let currentURL, currentURL.path != "/watch",
           tabIndex(for: currentURL, origin: origin) == index { return nil }
        switch index {
        case 0: return origin
        case 1: return origin.appendingPathComponent("live")
        case 2: return origin.appendingPathComponent("hd")
        case 3: return origin.appendingPathComponent("settings")
        default: return nil
        }
    }
}
