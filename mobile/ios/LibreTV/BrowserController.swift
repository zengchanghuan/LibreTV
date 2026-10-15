import UIKit
import WebKit

final class BrowserController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var web: WKWebView!
    private var origin: URL?
    private var player: PlayerController?
    private let status = UILabel()
    private let toolbar = UIStackView()
    private var pending: [String: [String: Any]] = [:]
    private var storageKey: String { "native.pending." + (origin?.absoluteString ?? "") }

    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.applicationNameForUserAgent = "LibreTVNative/1"
        config.userContentController.add(self, name: "libretvNative")
        let bridge = """
        window.__LIBRETV_NATIVE__={version:1,platform:'ios',postMessage:m=>window.webkit.messageHandlers.libretvNative.postMessage(m)};
        window.dispatchEvent(new Event('libretv:native-ready'));
        """
        config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self
        web.isOpaque = false; web.backgroundColor = .black
        toolbar.axis = .horizontal; toolbar.distribution = .fillEqually
        for (title, selector) in [("首页", #selector(home)), ("刷新", #selector(reload)), ("服务地址", #selector(configure))] {
            let button = UIButton(type: .system); button.setTitle(title, for: .normal); button.addTarget(self, action: selector, for: .touchUpInside); toolbar.addArrangedSubview(button)
        }
        status.textColor = .white; status.numberOfLines = 0; status.textAlignment = .center
        for sub in [web!, toolbar, status] { sub.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(sub) }
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor), toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor), toolbar.heightAnchor.constraint(equalToConstant: 40),
            web.topAnchor.constraint(equalTo: toolbar.bottomAnchor), web.bottomAnchor.constraint(equalTo: view.bottomAnchor), web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            status.centerXAnchor.constraint(equalTo: view.centerXAnchor), status.centerYAnchor.constraint(equalTo: view.centerYAnchor), status.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -40)
        ])
        if let url = UserDefaults.standard.string(forKey: "serviceURL").flatMap(serviceOrigin) { connect(url) }
        else { status.text = "请先设置家庭服务的 HTTPS 地址" }
        NotificationCenter.default.addObserver(self, selector: #selector(flush), name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    private func connect(_ url: URL) {
        origin = url; UserDefaults.standard.set(url.absoluteString, forKey: "serviceURL")
        pending = UserDefaults.standard.data(forKey: storageKey).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: [String: Any]] } ?? [:]
        status.text = "正在连接…"; web.load(URLRequest(url: url))
    }
    @objc private func home() { if let origin { web.load(URLRequest(url: origin)) } }
    @objc private func reload() { if origin != nil { web.reload() } }
    @objc private func configure() {
        let alert = UIAlertController(title: "家庭服务地址", message: "填写现有 LibreTV 服务的 HTTPS 地址。账号和播放记录按服务隔离。", preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "https://tv.example.com"; $0.text = self.origin?.absoluteString; $0.keyboardType = .URL; $0.autocapitalizationType = .none }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "连接", style: .default) { [weak self] _ in
            guard let self else { return }
            guard let url = serviceOrigin(alert.textFields?.first?.text ?? "") else { self.status.text = "请输入有效的 HTTPS 服务地址"; return }
            self.connect(url)
        }); present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = action.request.url, let origin else { decisionHandler(.cancel); return }
        if sameOrigin(target, origin) { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated && ["https", "http"].contains(target.scheme) { UIApplication.shared.open(target) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { status.text = ""; flush() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { status.text = "连接失败，请检查地址和网络后刷新" }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let origin, let frame = message.frameInfo.request.url, sameOrigin(frame, origin),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "ready" { flush(); return }
        if type == "ack", let id = body["eventId"] as? String {
            pending = pending.filter { $0.value["eventId"] as? String != id }; persist(); return
        }
        if type == "close", let id = body["sessionId"] as? String, player?.session.id == id { player?.closePlayer(); return }
        guard type == "open", player == nil, let raw = body["session"], JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw), let session = try? JSONDecoder().decode(PlaybackSession.self, from: data), session.isValid(origin: origin) else { return }
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self, self.player == nil, self.origin == origin, self.web.url.map({ sameOrigin($0, origin) }) == true else { return }
            let controller = PlayerController(session: session, origin: origin, cookies: cookies)
            controller.onProgress = { [weak self] event in self?.record(event) }
            controller.onClose = { [weak self] in self?.player = nil }
            controller.modalPresentationStyle = .fullScreen; self.player = controller
            self.present(controller, animated: true)
        }
    }
    private func record(_ event: [String: Any]) {
        guard let session = event["sessionId"] as? String, let index = event["index"] as? Int else { return }
        pending["\(session):\(index)"] = event
        persist(); send(event)
    }
    private func persist() { if let data = try? JSONSerialization.data(withJSONObject: pending) { UserDefaults.standard.set(data, forKey: storageKey) } }
    private func send(_ event: [String: Any]) {
        guard let origin, web.url.map({ sameOrigin($0, origin) }) == true,
              let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('libretv:native-progress',{detail:\(json)}))", completionHandler: nil)
    }
    @objc private func flush() {
        for event in pending.values.sorted(by: {
            let a = $0["openedAt"] as? Int64 ?? 0, b = $1["openedAt"] as? Int64 ?? 0
            return a == b ? ($0["sequence"] as? Int ?? 0) < ($1["sequence"] as? Int ?? 0) : a < b
        }) { send(event) }
    }
    deinit { NotificationCenter.default.removeObserver(self) }
}
