// Builds the text-recognition helper for this OS into build/ocr/ (shipped in the app by
// electron-builder.yml). Skipped when the helper is newer than its source.
//   macOS:   native/ocr-mac/main.swift  -> build/ocr/snapkit-ocr      (swiftc, Command Line Tools)
//   Windows: native/ocr-win/main.cpp    -> build/ocr/snapkit-ocr.exe  (MSVC, found with vswhere)
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const root = resolve(import.meta.dirname, '..')
const outDir = join(root, 'build', 'ocr')
mkdirSync(outDir, { recursive: true })
const fresh = (out, src) => existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs

if (process.platform === 'darwin') {
  const src = join(root, 'native', 'ocr-mac', 'main.swift')
  const out = join(outDir, 'snapkit-ocr')
  if (fresh(out, src)) process.exit(0)
  execFileSync('swiftc', ['-O', '-target', 'arm64-apple-macos11', src, '-o', out], { stdio: 'inherit' })
  console.log('built build/ocr/snapkit-ocr')
} else if (process.platform === 'win32') {
  const src = join(root, 'native', 'ocr-win', 'main.cpp')
  const out = join(outDir, 'snapkit-ocr.exe')
  if (!existsSync(src) || fresh(out, src)) process.exit(0)
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  const vs = execFileSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' }).trim()
  const vcvars = join(vs, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  const cmd = `"${vcvars}" >nul && cl /nologo /O2 /EHsc /std:c++20 "${src}" /Fe:"${out}" /Fo:"${outDir}\\\\" /link windowsapp.lib`
  execFileSync('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], { stdio: 'inherit', windowsVerbatimArguments: true })
  console.log('built build/ocr/snapkit-ocr.exe')
}
