import Compression
import Foundation

/**
 * "Compress" (src/main/compress.ts): a PNG with at most 256 colours, like TinyPNG. The quantizer is
 * a port of UPNG.js's (MIT, © Photopea), the same one the Electron app uses, so both apps make the
 * same palettes: a k-d tree that keeps splitting the leaf with the most colour variance along its
 * main axis, then maps each pixel down the tree.
 */
public enum Quantizer {
  private final class Node {
    var i0: Int, i1: Int
    var R: [Double]
    var m: [Double]
    var N: Int
    var e = [Double](repeating: 0.5, count: 4)
    var q = [Double](repeating: 0, count: 4)
    var L = 0.0
    var eMq255 = 0.0
    var eMq = 0.0
    var rgba: UInt32 = 0
    var left: Node?
    var right: Node?

    init(i0: Int, i1: Int, R: [Double], m: [Double], N: Int) {
      self.i0 = i0
      self.i1 = i1
      self.R = R
      self.m = m
      self.N = N
      estats()
    }

    /** UPNG.quantize.estats: covariance, its main axis by power iteration, the mean colour. */
    func estats() {
      let iN = N == 0 ? 0 : 1 / Double(N)
      var A = [Double](repeating: 0, count: 16)
      for r in 0..<4 { for c in 0..<4 { A[r * 4 + c] = R[r * 4 + c] - m[r] * m[c] * iN } }
      var b = [0.5, 0.5, 0.5, 0.5]
      var mi = 0.0
      if N != 0 {
        for _ in 0..<10 {
          b = [A[0] * b[0] + A[1] * b[1] + A[2] * b[2] + A[3] * b[3],
               A[4] * b[0] + A[5] * b[1] + A[6] * b[2] + A[7] * b[3],
               A[8] * b[0] + A[9] * b[1] + A[10] * b[2] + A[11] * b[3],
               A[12] * b[0] + A[13] * b[1] + A[14] * b[2] + A[15] * b[3]]
          let tmi = (b[0] * b[0] + b[1] * b[1] + b[2] * b[2] + b[3] * b[3]).squareRoot()
          b = b.map { $0 * (1 / tmi) }
          if abs(tmi - mi) < 1e-9 { break }
          mi = tmi
        }
      }
      q = [m[0] * iN, m[1] * iN, m[2] * iN, m[3] * iN]
      e = b
      L = mi
      eMq255 = 255 * (q[0] * b[0] + q[1] * b[1] + q[2] * b[2] + q[3] * b[3])
      eMq = q[0] * b[0] + q[1] * b[1] + q[2] * b[2] + q[3] * b[3]
      let ia = q[3] < 0.001 ? 0 : 1 / q[3]
      func ch(_ v: Double) -> UInt32 { UInt32(truncatingIfNeeded: Int(jsRound(255 * v))) & 0xff }
      rgba = (ch(q[3]) << 24) | (ch(q[2] * ia) << 16) | (ch(q[1] * ia) << 8) | ch(q[0] * ia)
    }
  }

  private static func stats(_ px: UnsafeMutablePointer<UInt8>, _ i0: Int, _ i1: Int) -> (R: [Double], m: [Double], N: Int) {
    var R = [Double](repeating: 0, count: 16)
    var m = [Double](repeating: 0, count: 4)
    var i = i0
    let k = 1.0 / 255
    var r0 = 0.0, r1 = 0.0, r2 = 0.0, r3 = 0.0, r5 = 0.0, r6 = 0.0, r7 = 0.0, r10 = 0.0, r11 = 0.0, r15 = 0.0
    var m0 = 0.0, m1 = 0.0, m2 = 0.0, m3 = 0.0
    while i < i1 {
      let r = Double(px[i]) * k, g = Double(px[i + 1]) * k, b = Double(px[i + 2]) * k, a = Double(px[i + 3]) * k
      m0 += r; m1 += g; m2 += b; m3 += a
      r0 += r * r; r1 += r * g; r2 += r * b; r3 += r * a
      r5 += g * g; r6 += g * b; r7 += g * a
      r10 += b * b; r11 += b * a
      r15 += a * a
      i += 4
    }
    R = [r0, r1, r2, r3, r1, r5, r6, r7, r2, r6, r10, r11, r3, r7, r11, r15]
    m = [m0, m1, m2, m3]
    return (R, m, (i1 - i0) >> 2)
  }

  private static func dot(_ px: UnsafeMutablePointer<UInt8>, _ i: Int, _ e: [Double]) -> Double {
    Double(px[i]) * e[0] + Double(px[i + 1]) * e[1] + Double(px[i + 2]) * e[2] + Double(px[i + 3]) * e[3]
  }

  /** UPNG.quantize.splitPixels: partition the node's pixels by the plane through its mean. */
  private static func split(_ px: UnsafeMutablePointer<UInt8>, _ i0In: Int, _ i1In: Int, _ e: [Double], _ eMq: Double) -> Int {
    var i0 = i0In, i1 = i1In - 4
    px.withMemoryRebound(to: UInt32.self, capacity: (i1In + 4) / 4) { p32 in
      while i0 < i1 {
        while dot(px, i0, e) <= eMq { i0 += 4 }
        while dot(px, i1, e) > eMq { i1 -= 4 }
        if i0 >= i1 { break }
        let t = p32[i0 >> 2]
        p32[i0 >> 2] = p32[i1 >> 2]
        p32[i1 >> 2] = t
        i0 += 4
        i1 -= 4
      }
    }
    while dot(px, i0, e) > eMq { i0 -= 4 }
    return i0 + 4
  }

  /**
   * RGBA pixels (straight alpha) → a palette of at most `colors` RGBA values (little-endian
   * 0xAABBGGRR, the first one transparent black, as UPNG reserves it) and one index per pixel.
   */
  public static func quantize(_ rgba: [UInt8], colors: Int = 256) -> (palette: [UInt32], indices: [UInt8]) {
    let n = rgba.count
    // alphaMul: premultiplied copies (one sorted for the tree, one mapped).
    var work = [UInt8](repeating: 0, count: n)
    var orig = [UInt8](repeating: 0, count: n)
    for i in stride(from: 0, to: n, by: 4) {
      let a = Double(rgba[i + 3]) * (1 / 255)
      for c in 0..<3 { orig[i + c] = UInt8(Double(rgba[i + c]) * a) } // truncates, like Uint8Array
      orig[i + 3] = rgba[i + 3]
    }
    work = orig
    var leafs: [Node] = []
    let root: Node = work.withUnsafeMutableBufferPointer { buf in
      let px = buf.baseAddress!
      let s = stats(px, 0, n)
      let root = Node(i0: 0, i1: n, R: s.R, m: s.m, N: s.N)
      leafs = [root]
      let ps = colors - 1 // index 0 is the reserved transparent colour
      while leafs.count < ps {
        var maxL = 0.0, mi = 0
        for (i, l) in leafs.enumerated() where l.L > maxL {
          maxL = l.L
          mi = i
        }
        if maxL < 1e-3 { break }
        let node = leafs[mi]
        let s0 = split(px, node.i0, node.i1, node.e, node.eMq255)
        let ls = stats(px, node.i0, s0)
        let ln = Node(i0: node.i0, i1: s0, R: ls.R, m: ls.m, N: ls.N)
        let rn = Node(i0: s0, i1: node.i1, R: (0..<16).map { node.R[$0] - ln.R[$0] }, m: (0..<4).map { node.m[$0] - ln.m[$0] }, N: node.N - ln.N)
        node.left = ln
        node.right = rn
        leafs[mi] = ln
        leafs.append(rn)
      }
      return root
    }
    leafs.sort { $0.N > $1.N }
    var palette: [UInt32] = [0]
    var index: [UInt32: UInt8] = [0: 0]
    for l in leafs where index[l.rgba] == nil {
      index[l.rgba] = UInt8(palette.count)
      palette.append(l.rgba)
    }
    var indices = [UInt8](repeating: 0, count: n / 4)
    let k = 1.0 / 255
    for p in 0..<(n / 4) {
      let i = p * 4
      let r = Double(orig[i]) * k, g = Double(orig[i + 1]) * k, b = Double(orig[i + 2]) * k, a = Double(orig[i + 3]) * k
      var nd = root
      while let l = nd.left, let rr = nd.right {
        nd = (nd.e[0] * r + nd.e[1] * g + nd.e[2] * b + nd.e[3] * a - nd.eMq) <= 0 ? l : rr
      }
      indices[p] = index[nd.rgba] ?? 0
    }
    return (palette, indices)
  }
}

/** A minimal PNG writer for palette images (zlib through Apple's Compression framework). */
public enum PNGWriter {
  public static func indexed(width: Int, height: Int, palette: [UInt32], indices: [UInt8]) -> Data {
    var png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    let depth: UInt8 = palette.count <= 2 ? 1 : palette.count <= 4 ? 2 : palette.count <= 16 ? 4 : 8
    var ihdr = Data()
    ihdr.append(be32(UInt32(width)))
    ihdr.append(be32(UInt32(height)))
    ihdr.append(contentsOf: [depth, 3, 0, 0, 0])
    chunk(&png, "IHDR", ihdr)
    var plte = Data(), trns = Data()
    for c in palette {
      plte.append(contentsOf: [UInt8(c & 0xff), UInt8((c >> 8) & 0xff), UInt8((c >> 16) & 0xff)])
      trns.append(UInt8(c >> 24))
    }
    chunk(&png, "PLTE", plte)
    // Alpha per palette entry (UPNG always writes it for palettes).
    chunk(&png, "tRNS", trns)
    // Rows: filter byte 0, then the indices packed at `depth` bits.
    let perByte = 8 / Int(depth)
    let rowBytes = (width + perByte - 1) / perByte
    var raw = Data(capacity: (rowBytes + 1) * height)
    for y in 0..<height {
      raw.append(0)
      var row = [UInt8](repeating: 0, count: rowBytes)
      for x in 0..<width {
        let v = indices[y * width + x]
        let shift = 8 - Int(depth) * (x % perByte + 1)
        row[x / perByte] |= v << UInt8(shift)
      }
      raw.append(contentsOf: row)
    }
    chunk(&png, "IDAT", zlib(raw))
    chunk(&png, "IEND", Data())
    return png
  }

  static func zlib(_ data: Data) -> Data {
    var out = Data([0x78, 0xDA])
    let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: data.count + 1024)
    defer { dst.deallocate() }
    let n = data.withUnsafeBytes { src in
      compression_encode_buffer(dst, data.count + 1024, src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
    }
    out.append(dst, count: n)
    var a: UInt32 = 1, b: UInt32 = 0
    for byte in data {
      a = (a + UInt32(byte)) % 65521
      b = (b + a) % 65521
    }
    out.append(be32((b << 16) | a))
    return out
  }

  static func be32(_ v: UInt32) -> Data { Data([UInt8(v >> 24), UInt8((v >> 16) & 0xff), UInt8((v >> 8) & 0xff), UInt8(v & 0xff)]) }

  static func chunk(_ png: inout Data, _ type: String, _ body: Data) {
    png.append(be32(UInt32(body.count)))
    var crcData = Data(type.utf8)
    crcData.append(body)
    png.append(crcData)
    png.append(be32(crc32(crcData)))
  }

  private static let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
    var c = UInt32(n)
    for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    return c
  }

  static func crc32(_ d: Data) -> UInt32 {
    var c: UInt32 = 0xFFFF_FFFF
    for b in d { c = crcTable[Int((c ^ UInt32(b)) & 0xff)] ^ (c >> 8) }
    return c ^ 0xFFFF_FFFF
  }
}

/** compressesFor() in settings.ts: does this output get compressed? */
public func compressesFor(_ applyTo: String, _ on: Bool, _ output: String) -> Bool {
  on && (applyTo == "both" || applyTo == output)
}
