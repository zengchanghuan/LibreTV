import AVFoundation
import Vision

/// Samples a separate, paused decoder. A miss always leaves subtitle status unknown.
enum FrameSubtitleProbe {
    struct Line {
        let text: String
        let bounds: CGRect
    }

    @MainActor static func detect(url: URL, cookies: [HTTPCookie]) async -> Bool {
        let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies])
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = 1
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: nil)
        item.add(output)
        let player = AVPlayer(playerItem: item)
        player.isMuted = true
        player.allowsExternalPlayback = false
        player.preventsDisplaySleepDuringVideoPlayback = false
        defer {
            item.cancelPendingSeeks()
            player.replaceCurrentItem(with: nil)
            item.remove(output)
            asset.cancelLoading()
        }

        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while !Task.isCancelled && ContinuousClock.now < deadline && item.status != .failed {
            if item.status == .readyToPlay && item.duration.seconds.isFinite { break }
            try? await Task.sleep(for: .milliseconds(70))
        }
        let duration = item.duration.seconds
        guard item.status == .readyToPlay, duration.isFinite, duration >= 4 else { return false }
        var previous: [[Line]] = []
        for fraction in [0.18, 0.37, 0.58, 0.76] {
            guard !Task.isCancelled, ContinuousClock.now < deadline, item.status != .failed else { break }
            let target = CMTime(seconds: duration * fraction, preferredTimescale: 600)
            item.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { _ in }
            let frameDeadline = min(deadline, ContinuousClock.now.advanced(by: .seconds(2.5)))
            while !Task.isCancelled && ContinuousClock.now < frameDeadline && item.status != .failed {
                let time = item.currentTime()
                var displayTime = CMTime.invalid
                if abs(time.seconds - target.seconds) < 0.25, output.hasNewPixelBuffer(forItemTime: time),
                   let pixels = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: &displayTime),
                   abs(displayTime.seconds - target.seconds) < 0.5 {
                    let lines = await readLines(pixels)
                    if !Task.isCancelled && previous.contains(where: { changedLine(from: $0, to: lines) }) { return true }
                    if !lines.isEmpty { previous.append(lines) }
                    break
                }
                try? await Task.sleep(for: .milliseconds(60))
            }
        }
        return false
    }

    // Vision uses lower-left normalized coordinates. Keep centered, subtitle-sized lines.
    private static func readLines(_ pixels: CVPixelBuffer) async -> [Line] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
        request.usesLanguageCorrection = false
        let region = CGRect(x: 0.03, y: 0.01, width: 0.94, height: 0.36)
        request.regionOfInterest = region
        do { try VNImageRequestHandler(cvPixelBuffer: pixels).perform([request]) }
        catch { return [] }
        return (request.results ?? []).compactMap { observation in
            // Vision returns boxes normalized to the cropped recognition region.
            let local = observation.boundingBox
            let box = CGRect(x: region.minX + local.minX * region.width, y: region.minY + local.minY * region.height,
                             width: local.width * region.width, height: local.height * region.height)
            guard abs(box.midX - 0.5) <= 0.18, (0.015...0.11).contains(box.height),
                  box.width >= 0.055, let candidate = observation.topCandidates(1).first,
                  candidate.confidence >= 0.55 else { return nil }
            let raw = candidate.string.lowercased()
            guard !raw.contains("://"), !raw.contains("www."), !raw.contains(".com") else { return nil }
            let text = String(raw.filter(\.isLetter))
            guard text.count >= 2 else { return nil }
            return Line(text: text, bounds: box)
        }
    }

    static func changedLine(from previous: [Line], to current: [Line]) -> Bool {
        // Match by baseline and size so a persistent bilingual watermark cannot
        // count its two lines as changing dialogue. Ignore one-glyph OCR jitter.
        for line in current {
            let nearby = previous.filter {
                abs($0.bounds.midY - line.bounds.midY) <= min($0.bounds.height, line.bounds.height) * 0.65 &&
                max($0.bounds.height, line.bounds.height) <= min($0.bounds.height, line.bounds.height) * 1.6
            }
            if !nearby.isEmpty && nearby.allSatisfy({ old in
                let difference = old.text.difference(from: line.text)
                return difference.count > 2 && !old.text.contains(line.text) && !line.text.contains(old.text)
            }) { return true }
        }
        return false
    }
}
