import Foundation

/** The floating preview's size (shared/thumb.ts). */
public enum ThumbSize {
  /** Largest floating preview, in points. */
  public static let max = (w: 240.0, h: 160.0)
  /** The preview used for captures much wider or taller than a screen: 16:9, the image fitted inside. */
  public static let standard = (w: 240.0, h: 135.0)
  /** Shapes wider than 3:1 or taller than 1:2 (a toolbar strip, a sidebar) get the standard preview. */
  public static let ratio = (min: 0.5, max: 3.0)

  /** Floating preview size for a capture of width × height pixels. */
  public static func of(_ width: Double, _ height: Double) -> (w: Double, h: Double) {
    let r = width / height
    guard r >= ratio.min && r <= ratio.max else { return standard }
    let k = Swift.min(max.w / width, max.h / height, 1)
    return (Swift.max(60, jsRound(width * k)), Swift.max(40, jsRound(height * k)))
  }
}
