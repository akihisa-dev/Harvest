import AppKit

// Deterministic store illustrations. The gallery and results are fictional;
// the controls and their labels follow the current extension UI.
let width = 1280
let height = 800

func color(_ value: String) -> NSColor {
    let hex = UInt64(value.dropFirst(), radix: 16)!
    return NSColor(calibratedRed: CGFloat((hex >> 16) & 255) / 255,
                   green: CGFloat((hex >> 8) & 255) / 255,
                   blue: CGFloat(hex & 255) / 255, alpha: 1)
}

func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat,
         _ fill: NSColor, radius: CGFloat = 0, stroke: NSColor? = nil) {
    let r = NSRect(x: x, y: CGFloat(height) - y - h, width: w, height: h)
    let p = NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius)
    fill.setFill(); p.fill()
    if let stroke { stroke.setStroke(); p.lineWidth = 1; p.stroke() }
}

func label(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat = 12,
           _ ink: NSColor = color("#202020"), bold: Bool = false) {
    let font = bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
    (value as NSString).draw(at: NSPoint(x: x, y: CGFloat(height) - y - size * 1.25),
                             withAttributes: [.font: font, .foregroundColor: ink])
}

func circle(_ x: CGFloat, _ y: CGFloat, _ d: CGFloat, _ fill: NSColor) {
    fill.setFill()
    NSBezierPath(ovalIn: NSRect(x: x, y: CGFloat(height) - y - d, width: d, height: d)).fill()
}

func triangle(_ points: [(CGFloat, CGFloat)], _ fill: NSColor) {
    let path = NSBezierPath()
    path.move(to: NSPoint(x: points[0].0, y: CGFloat(height) - points[0].1))
    for p in points.dropFirst() { path.line(to: NSPoint(x: p.0, y: CGFloat(height) - p.1)) }
    path.close(); fill.setFill(); path.fill()
}

let palettes: [(String, String, String, String)] = [
    ("#e4e9df", "#a9b69a", "#748c73", "#b9c5a9"),
    ("#ede4dc", "#dfc5a9", "#bf8061", "#d9baa1"),
    ("#dfe8e9", "#abc2c6", "#6e949c", "#b4cdd0"),
    ("#ece4e0", "#c8aaa0", "#aa857b", "#d7bbb2"),
    ("#ebe9dc", "#c9c39d", "#a89f70", "#d7d1ad"),
    ("#e0e9e2", "#aac2b5", "#719a87", "#bdd2c5")
]

func landscape(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ index: Int) {
    let p = palettes[index % palettes.count]
    box(x, y, w, h, color(p.0), radius: 4)
    circle(x + w * 0.49, y + h * 0.1, min(w, h) * 0.42, color(p.1))
    triangle([(x, y + h), (x + w * 0.4, y + h * 0.38), (x + w * 0.8, y + h)], color(p.2))
    triangle([(x + w * 0.44, y + h), (x + w * 0.7, y + h * 0.59), (x + w, y + h)], color(p.3))
}

func button(_ value: String, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat,
            dark: Bool = false, size: CGFloat = 11) {
    box(x, y, w, 30, dark ? color("#202020") : .white, radius: 5,
        stroke: dark ? nil : color("#c8c8c8"))
    label(value, x + 9, y + 8, size, dark ? .white : color("#202020"), bold: true)
}

func checkbox(_ x: CGFloat, _ y: CGFloat, checked: Bool) {
    box(x, y, 15, 15, checked ? color("#202020") : .white, radius: 2,
        stroke: color("#888888"))
    if checked { label("✓", x + 2, y - 2, 15, .white, bold: true) }
}

func render(english: Bool, output: String) throws {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                               isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high

    let line = color("#dedede")
    let muted = color("#686868")
    box(0, 0, 1280, 800, .white)
    box(0, 0, 1280, 44, color("#f0f0f0"))
    for i in 0..<3 { circle(18 + CGFloat(i) * 16, 19, 7, color("#b7b7b7")) }
    box(78, 8, 1095, 28, .white, radius: 6, stroke: line)
    label("sample.example / field-notes", 96, 15, 11, muted)
    label(english ? "Sample page" : "サンプル画面", 1190, 16, 10, muted)

    box(0, 44, 820, 756, color("#faf9f6"))
    label("F I E L D   N O T E S", 36, 78, 10, muted)
    label(english ? "Landscape Notes" : "風景の記録", 36, 110, 28, color("#202020"), bold: true)
    label(english ? "A sample gallery of six landscapes." : "色とかたちで描く、6つの風景。このページは掲載用のサンプルです。",
          36, 152, 12, muted)
    for i in 0..<6 {
        let col = i % 3, row = i / 3
        let x = CGFloat(36 + col * 259), y = CGFloat(204 + row * 272)
        landscape(x, y, 241, 220, i)
        label(String(format: "%02d", i + 1) + (english ? " / landscape" : " / 風景"), x, y + 232, 11, muted)
    }

    box(820, 44, 460, 756, color("#f5f5f5"))
    box(820, 44, 1, 756, line)
    box(821, 44, 459, 222, .white)
    box(821, 266, 459, 1, line)
    button(english ? "Collect" : "収集", 836, 54, 60)
    button(english ? "Drop a page URL" : "ページURLをドロップ", 902, 54, 128, size: english ? 9 : 8)
    button(english ? "Analyze" : "解析", 1036, 54, 64, dark: true)
    button(english ? "Save PDF (6 images)" : "PDFを保存（6枚）", 1126, 54, 140, dark: true, size: 10)
    box(821, 96, 459, 1, line)
    label(english ? "Images" : "画像", 836, 107, 14, color("#202020"), bold: true)
    label(english ? "6 / 7 images selected · 6 displayed" : "6 / 7枚を選択・6枚を表示", 894, 109, 10, muted)
    label(english ? "Select all" : "すべて選択", 837, 135, 10)
    label(english ? "Clear selection" : "選択を解除", 922, 135, 10)
    label(english ? "Reset order" : "並び順を戻す", 1032, 135, 10)
    label(english ? "Display" : "表示", 836, 170, 10, muted)
    button(english ? "Show all" : "すべて表示", 891, 160, 75, size: 9)
    button(english ? "Uploaded (6)" : "アップロード済み (6枚)", 972, 160, 168, dark: true, size: 9)
    button(english ? "Other (1)" : "その他 (1枚)", 1147, 160, 119, size: 9)
    label("PDF", 836, 213, 10, muted)
    box(891, 202, 214, 30, .white, radius: 5, stroke: line)
    checkbox(900, 209, checked: true)
    label(english ? "Uploaded (6)" : "アップロード済み (6枚)", 922, 209, 9)
    box(1112, 202, 154, 30, .white, radius: 5, stroke: line)
    checkbox(1121, 209, checked: false)
    label(english ? "Other (1)" : "その他 (1枚)", 1143, 209, 9)
    button(english ? "Viewer mode" : "ビュアーモード", 836, 275, 211, size: 10)
    button(english ? "Clear" : "クリア", 1055, 275, 211, size: 10)
    for i in 0..<4 {
        let col = i % 2, row = i / 2
        let x = CGFloat(836 + col * 219), y = CGFloat(321 + row * 276)
        box(x, y, 211, 264, .white, radius: 5, stroke: color("#202020"))
        landscape(x + 1, y + 1, 209, 262, i)
        box(x + 8, y + 8, 25, 23, .white, radius: 4, stroke: line)
        label("\(i + 1)", x + 15, y + 11, 11, color("#202020"), bold: true)
        box(x + 176, y + 8, 23, 23, color("#202020"), radius: 4)
        label("✓", x + 180, y + 6, 17, .white, bold: true)
        box(x + 1, y + 231, 209, 32, color("#202020"))
        label(String(format: "%03d.jpg", i + 1), x + 11, y + 238, 11, .white)
    }
    NSGraphicsContext.current?.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    let temporary = URL(fileURLWithPath: output + ".jpg")
    let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.96])!
    try data.write(to: temporary)
    let conversion = Process()
    conversion.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
    conversion.arguments = ["-s", "format", "png", temporary.path, "--out", output]
    conversion.standardOutput = FileHandle.nullDevice
    try conversion.run()
    conversion.waitUntilExit()
    try FileManager.default.removeItem(at: temporary)
    guard conversion.terminationStatus == 0 else { throw NSError(domain: "Screenshot", code: 1) }
}

try render(english: false, output: "store/assets/screenshot-ja.png")
try render(english: true, output: "store/assets/screenshot-global.png")
