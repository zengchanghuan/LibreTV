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

    // Observe the page's resolved theme, rather than forcing WebKit's system
    // appearance (which would feed back into the web "system" theme option).
    static let themeScript = """
    (() => {
      let last;
      const notify = () => {
        const dark = document.documentElement.classList.contains('dark');
        if (dark === last) return;
        last = dark;
        window.__LIBRETV_NATIVE__?.postMessage({type:'theme',dark});
      };
      const start = () => {
        new MutationObserver(notify).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
        notify();
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
      else start();
      window.addEventListener('pageshow',notify);
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

    struct Page {
        let title: String
        let parent: URL?
    }

    static func page(for url: URL, origin: URL) -> Page? {
        guard sameOrigin(url, origin) else { return nil }
        let path = url.path == "/" ? "/" : url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        switch path {
        case "", "/":
            let searching = query.contains { $0.name == "s" && !($0.value ?? "").isEmpty }
            return Page(title: searching ? "搜索结果" : "首页", parent: searching ? origin : nil)
        case "live": return Page(title: "直播", parent: nil)
        case "hd": return Page(title: "高清专区", parent: nil)
        case "settings": return Page(title: "设置", parent: nil)
        case "about": return Page(title: "关于 HomeTV", parent: origin.appendingPathComponent("settings"))
        case "watch":
            return Page(title: "影片详情", parent: tabIndex(for: url, origin: origin) == 2 ? origin.appendingPathComponent("hd") : origin)
        default:
            if path.hasPrefix("hd/") {
                var parent = URLComponents(url: origin.appendingPathComponent("hd"), resolvingAgainstBaseURL: false)!
                parent.queryItems = [URLQueryItem(name: "site", value: String(path.dropFirst(3)).components(separatedBy: "/")[0])]
                return Page(title: "资源详情", parent: parent.url)
            }
            if path.hasPrefix("live/") { return Page(title: "直播详情", parent: origin.appendingPathComponent("live")) }
            if path.hasPrefix("settings/") { return Page(title: "设置", parent: origin.appendingPathComponent("settings")) }
            return Page(title: "HomeTV", parent: origin)
        }
    }

    /// Tab roots have no back button. Within a section prefer browser history
    /// so search/filter state survives; direct links fall back to their parent.
    static func backURL(from current: URL, previous: URL?, origin: URL) -> URL? {
        guard let parent = page(for: current, origin: origin)?.parent else { return nil }
        if let previous, previous != current, sameOrigin(previous, origin),
           tabIndex(for: previous, origin: origin) == tabIndex(for: current, origin: origin) { return previous }
        return parent
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
