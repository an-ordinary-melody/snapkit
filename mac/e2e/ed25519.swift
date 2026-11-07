// Ed25519 for the Sparkle update test only: a throwaway key pair and update signatures, as Sparkle's
// generate_keys / sign_update make them (base64). Release keys never come from here.
//   swift mac/e2e/ed25519.swift keygen <dir>        writes <dir>/private.b64 and <dir>/public.b64
//   swift mac/e2e/ed25519.swift sign <private.b64> <file>   prints the signature
import CryptoKit
import Foundation

let a = CommandLine.arguments
func read(_ p: String) -> Data { FileManager.default.contents(atPath: p) ?? Data() }
if a.count == 3, a[1] == "keygen" {
  let k = Curve25519.Signing.PrivateKey()
  try! k.rawRepresentation.base64EncodedString().write(toFile: a[2] + "/private.b64", atomically: true, encoding: .utf8)
  try! k.publicKey.rawRepresentation.base64EncodedString().write(toFile: a[2] + "/public.b64", atomically: true, encoding: .utf8)
} else if a.count == 4, a[1] == "sign",
          let raw = Data(base64Encoded: String(decoding: read(a[2]), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)),
          let k = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) {
  print(try! k.signature(for: read(a[3])).base64EncodedString())
} else {
  FileHandle.standardError.write(Data("usage: ed25519.swift keygen <dir> | sign <private.b64> <file>\n".utf8))
  exit(2)
}
