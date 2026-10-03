import AppKit

// Deterministic store illustrations. The gallery and results are fictional;
// the controls and their labels follow the current extension UI.
var width = 1280
var height = 800

func color(_ value: String) -> NSColor {
    let hex = UInt64(value.dropFirst(), radix: 16)!
    return NSColor(calibratedRed: CGFloat((hex >> 16) & 255) / 255,
                   green: CGFloat((hex >> 8) & 255) / 255,
                   blue: CGFloat(hex & 255) / 255, alpha: 1)
}

func box(_ x: CGFloat, _ y: CGFloat, _ shapeWidth: CGFloat, _ shapeHeight: CGFloat,
         _ fill: NSColor, radius: CGFloat = 0, stroke: NSColor? = nil) {
    let rectangle = NSRect(x: x, y: CGFloat(height) - y - shapeHeight, width: shapeWidth, height: shapeHeight)
    let path = NSBezierPath(roundedRect: rectangle, xRadius: radius, yRadius: radius)
    fill.setFill()
    path.fill()
    if let stroke {
        stroke.setStroke()
        path.lineWidth = 1
        path.stroke()
    }
}

func label(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat = 12,
           _ ink: NSColor = color("#202020"), bold: Bool = false) {
    let font = bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
    (value as NSString).draw(at: NSPoint(x: x, y: CGFloat(height) - y - size * 1.25),
                             withAttributes: [.font: font, .foregroundColor: ink])
}

func circle(_ x: CGFloat, _ y: CGFloat, _ diameter: CGFloat, _ fill: NSColor) {
    fill.setFill()
    NSBezierPath(ovalIn: NSRect(x: x, y: CGFloat(height) - y - diameter, width: diameter, height: diameter)).fill()
}

func polygon(_ points: [(CGFloat, CGFloat)], _ fill: NSColor) {
    let path = NSBezierPath()
    path.move(to: NSPoint(x: points[0].0, y: CGFloat(height) - points[0].1))
    for point in points.dropFirst() {
        path.line(to: NSPoint(x: point.0, y: CGFloat(height) - point.1))
    }
    path.close()
    fill.setFill()
    path.fill()
}

let palettes: [(String, String, String, String)] = [
    ("#e4e9df", "#a9b69a", "#748c73", "#b9c5a9"),
    ("#ede4dc", "#dfc5a9", "#bf8061", "#d9baa1"),
    ("#dfe8e9", "#abc2c6", "#6e949c", "#b4cdd0"),
    ("#ece4e0", "#c8aaa0", "#aa857b", "#d7bbb2"),
    ("#ebe9dc", "#c9c39d", "#a89f70", "#d7d1ad"),
    ("#e0e9e2", "#aac2b5", "#719a87", "#bdd2c5")
]

func landscape(_ x: CGFloat, _ y: CGFloat, _ shapeWidth: CGFloat, _ shapeHeight: CGFloat, _ index: Int) {
    let palette = palettes[index % palettes.count]
    box(x, y, shapeWidth, shapeHeight, color(palette.0), radius: 4)
    circle(x + shapeWidth * 0.49, y + shapeHeight * 0.1, min(shapeWidth, shapeHeight) * 0.42, color(palette.1))
    polygon([
        (x, y + shapeHeight),
        (x + shapeWidth * 0.4, y + shapeHeight * 0.38),
        (x + shapeWidth * 0.8, y + shapeHeight)
    ], color(palette.2))
    polygon([
        (x + shapeWidth * 0.44, y + shapeHeight),
        (x + shapeWidth * 0.7, y + shapeHeight * 0.59),
        (x + shapeWidth, y + shapeHeight)
    ], color(palette.3))
}

func button(_ value: String, _ x: CGFloat, _ y: CGFloat, _ shapeWidth: CGFloat,
            dark: Bool = false, size: CGFloat = 11) {
    box(x, y, shapeWidth, 30, dark ? color("#202020") : .white, radius: 5,
        stroke: dark ? nil : color("#c8c8c8"))
    label(value, x + 9, y + 8, size, dark ? .white : color("#202020"), bold: true)
}

func checkbox(_ x: CGFloat, _ y: CGFloat, checked: Bool) {
    box(x, y, 15, 15, checked ? color("#202020") : .white, radius: 2,
        stroke: color("#888888"))
    if checked {
        label("✓", x + 2, y - 2, 15, .white, bold: true)
    }
}

func render(english: Bool, output: String) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                  isPlanar: false, colorSpaceName: .deviceRGB,
                                  bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current?.imageInterpolation = .high

    let line = color("#dedede")
    let muted = color("#686868")
    box(0, 0, 1280, 800, .white)
    box(0, 0, 1280, 44, color("#f0f0f0"))
    for i in 0..<3 {
        circle(18 + CGFloat(i) * 16, 19, 7, color("#b7b7b7"))
    }
    box(78, 8, 1095, 28, .white, radius: 6, stroke: line)
    label("sample.example / field-notes", 96, 15, 11, muted)
    label(english ? "Sample page" : "サンプル画面", 1190, 16, 10, muted)

    box(0, 96, 950, 704, color("#faf9f6"))
    label("F I E L D   N O T E S", 36, 130, 10, muted)
    label(english ? "Landscape Notes" : "風景の記録", 36, 162, 28, color("#202020"), bold: true)
    label(english ? "A sample gallery of six landscapes." : "色とかたちで描く、6つの風景。このページは掲載用のサンプルです。",
          36, 204, 12, muted)
    for i in 0..<6 {
        let column = i % 3
        let row = i / 3
        let x = CGFloat(36 + column * 294)
        let y = CGFloat(256 + row * 272)
        landscape(x, y, 274, 220, i)
        label(String(format: "%02d", i + 1) + (english ? " / landscape" : " / 風景"), x, y + 232, 11, muted)
    }

    // The screenshot follows the live layout: page URL and source actions in
    // the header, image cards in the main area, and save/group controls right.
    button(english ? "Click to enter a page URL" : "クリックしてページURLを入力", 18, 54, 790, size: 11)
    button(english ? "Analyze" : "解析", 969, 54, 86, dark: true)
    button(english ? "Clear" : "クリア", 1063, 54, 86)
    button(english ? "Collect" : "収集", 1157, 54, 105)

    box(950, 96, 330, 704, color("#f5f5f5"))
    box(950, 96, 1, 704, line)
    label(english ? "Save format" : "保存形式", 968, 112, 11, muted)
    let formats = ["PDF", "JPG", "PNG", "JXL"]
    for i in 0..<4 {
        let x = CGFloat(966 + i * 75)
        box(x, 133, 70, 34, .white, radius: 5, stroke: i == 0 ? color("#202020") : line)
        checkbox(x + 8, 142, checked: i == 0)
        label(formats[i], x + 28, 141, 11, color("#202020"), bold: i == 0)
    }
    button(english ? "Save" : "保存", 966, 174, 298, dark: true)
    checkbox(968, 220, checked: false)
    label(english ? "Add source page at end" : "末尾に出典ページを追加", 991, 220, 10)
    box(950, 253, 330, 1, line)
    button(english ? "Viewer mode" : "ビュアーモード", 966, 264, 298, size: 11)
    label(english ? "Image groups" : "画像グループ", 966, 318, 14, color("#202020"), bold: true)
    // The real toolbar uses compact icon buttons: restore order, visibility,
    // and select all. Their accessible names are shown as small captions here.
    button(english ? "↶  Restore order" : "↶  全部元に戻す", 966, 343, 94, size: 8)
    button(english ? "◉  All images" : "◉  すべての画像を表示", 1066, 343, 100, size: 8)
    button(english ? "☑  Select all" : "☑  すべて選択", 1172, 343, 92, size: 8)
    for i in 0..<2 {
        let y = CGFloat(391 + i * 58)
        box(966, y, 298, 48, .white, radius: 5, stroke: line)
        label(i == 0 ? (english ? "Uploaded (6)" : "アップロード済み (6枚)") :
              (english ? "Other (1)" : "その他 (1枚)"), 978, y + 12, 10)
        label(english ? "Show" : "表示", 1150, y + 13, 9, muted)
        circle(1201, y + 15, 16, i == 0 ? color("#202020") : color("#929292"))
        label(i == 0 ? "✓" : "–", 1205, y + 14, 12, .white, bold: true)
        checkbox(1234, y + 15, checked: i == 0)
    }
    label(english ? "6 / 7 selected · 6 displayed" : "7枚中6枚を選択・6枚を表示", 967, 516, 10, muted)
    NSGraphicsContext.current?.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    let temporary = URL(fileURLWithPath: output + ".jpg")
    let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.96])!
    try data.write(to: temporary)
    let conversion = Process()
    conversion.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
    conversion.arguments = ["-s", "format", "png", temporary.path, "--out", output]
    conversion.standardOutput = FileHandle.nullDevice
    try conversion.run()
    conversion.waitUntilExit()
    try FileManager.default.removeItem(at: temporary)
    guard conversion.terminationStatus == 0 else {
        throw NSError(domain: "Screenshot", code: 1)
    }
}

try render(english: false, output: "store/assets/screenshot-ja.png")
try render(english: true, output: "store/assets/screenshot-global.png")

func renderPromo() throws {
    width = 440
    height = 280
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                  isPlanar: false, colorSpaceName: .deviceRGB,
                                  bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    box(0, 0, 440, 280, color("#f7f6f3"))
    box(0, 0, 10, 280, color("#202020"))
    label("HARVEST  /  CHROME EXTENSION", 28, 20, 10, color("#686868"), bold: true)
    label("欲しい画像だけを、", 28, 58, 24, color("#202020"), bold: true)
    label("収穫する。", 28, 91, 30, color("#202020"), bold: true)
    label("Webページの画像を集めて、選んで、", 29, 145, 13, color("#484848"))
    label("好きな形式で保存。", 29, 166, 13, color("#484848"))
    for i in 0..<4 {
        let x = CGFloat(29 + i * 64)
        box(x, 207, 56, 28, .white, radius: 5, stroke: color("#c8c8c8"))
        label(["PDF", "JPG", "PNG", "JXL"][i], x + 12, 214, 11, color("#202020"), bold: true)
    }
    // The geometric grain mark leads the large brand treatment. The familiar
    // image-file app icon remains small and serves only as the toolbar cue.
    let ink = color("#202020")
    polygon([(342, 45), (359, 68), (342, 91), (325, 68)], ink)
    polygon([(292, 78), (324, 82), (337, 105), (307, 101)], ink)
    polygon([(392, 78), (360, 82), (347, 105), (377, 101)], ink)
    polygon([(292, 111), (324, 115), (337, 138), (307, 134)], ink)
    polygon([(392, 111), (360, 115), (347, 138), (377, 134)], ink)
    polygon([(302, 144), (328, 148), (338, 165), (313, 161)], ink)
    polygon([(382, 144), (356, 148), (346, 165), (371, 161)], ink)
    box(338, 90, 8, 84, ink)
    let icon = NSImage(contentsOfFile: "assets/icons/icon-128.png")!
    icon.draw(in: NSRect(x: 368, y: CGFloat(height) - 230 - 42, width: 42, height: 42))
    NSGraphicsContext.current?.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    let data = bitmap.representation(using: .png, properties: [:])!
    try data.write(to: URL(fileURLWithPath: "store/assets/promo-small.png"))
}

try renderPromo()
