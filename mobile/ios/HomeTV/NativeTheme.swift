import UIKit

/// Shared native colors matching the web's resolved theme in globals.css.
struct NativeTheme {
    let dark: Bool
    static var current: NativeTheme { NativeTheme(dark: UserDefaults.standard.object(forKey: "native.theme.dark") as? Bool ?? true) }
    var style: UIUserInterfaceStyle { dark ? .dark : .light }
    private func color(_ light: Int, _ dark: Int) -> UIColor {
        let value = self.dark ? dark : light
        return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
    }
    var surface: UIColor { color(0xffffff, 0x141c29) }
    var page: UIColor { color(0xf6f7f9, 0x0b101a) }
    var content: UIColor { color(0x1a1a1a, 0xe6f2ff) }
    var muted: UIColor { color(0x5f6368, 0x8599b2) }
    var accent: UIColor { color(0x2563eb, 0x00b8e6) }
    var line: UIColor { color(0xe0e3e8, 0x223045) }
    var chip: UIColor { color(0xeef0f3, 0x16202e) }
    var hover: UIColor { color(0xe9ecf0, 0x1d2a3d) }

    func apply(to bar: UINavigationBar) {
        bar.overrideUserInterfaceStyle = style
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = surface; appearance.shadowColor = line
        appearance.titleTextAttributes = [.foregroundColor: content]
        appearance.largeTitleTextAttributes = [.foregroundColor: content]
        bar.standardAppearance = appearance; bar.scrollEdgeAppearance = appearance
        bar.compactAppearance = appearance; bar.compactScrollEdgeAppearance = appearance
        bar.tintColor = content
    }
}
