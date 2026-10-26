// Snapkit's Windows text recognizer: the OCR built into Windows 10+ (Windows.Media.Ocr), run as a small helper.
// Reads a PNG on stdin, prints {"lines":[{"text","x","y","w","h"}],"language":"vi"} on stdout, with each
// line's box as fractions of the image, top-left origin. Arguments: preferred languages (BCP-47, e.g. vi en);
// the first one whose OCR pack is installed is used, else the user's profile languages.
//   snapkit-ocr.exe --languages   lists the languages Windows can read right now.
// Built by scripts/build-ocr.mjs.
#include <fcntl.h>
#include <io.h>
#include <cstdio>
#include <string>
#include <vector>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Globalization.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Ocr.h>
#include <winrt/Windows.Storage.Streams.h>

using namespace winrt;
using namespace Windows::Globalization;
using namespace Windows::Graphics::Imaging;
using namespace Windows::Media::Ocr;
using namespace Windows::Storage::Streams;

static std::string json(const std::string& s) {
  std::string out = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') out += '\\', out += c;
    else if (c < 0x20) {
      char buf[8];
      snprintf(buf, sizeof buf, "\\u%04x", c);
      out += buf;
    } else out += c;
  }
  return out + "\"";
}

static int fail(const char* message) {
  fprintf(stderr, "%s\n", message);
  return 1;
}

int wmain(int argc, wchar_t** argv) {
  init_apartment();
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);

  if (argc > 1 && std::wstring(argv[1]) == L"--languages") {
    std::string out = "[";
    for (auto const& lang : OcrEngine::AvailableRecognizerLanguages()) {
      if (out.size() > 1) out += ",";
      out += json(to_string(lang.LanguageTag()));
    }
    printf("%s]", out.c_str());
    return 0;
  }

  // The first preferred language Windows can read, else the user's profile languages.
  OcrEngine engine{ nullptr };
  for (int i = 1; i < argc && !engine; i++) {
    Language lang{ hstring(argv[i]) };
    if (OcrEngine::IsLanguageSupported(lang)) engine = OcrEngine::TryCreateFromLanguage(lang);
  }
  if (!engine) engine = OcrEngine::TryCreateFromUserProfileLanguages();
  if (!engine) return fail("no OCR language installed");

  std::vector<uint8_t> png;
  uint8_t buf[65536];
  size_t n;
  while ((n = fread(buf, 1, sizeof buf, stdin)) > 0) png.insert(png.end(), buf, buf + n);
  if (png.empty()) return fail("no image on stdin");

  try {
    InMemoryRandomAccessStream stream;
    DataWriter writer(stream);
    writer.WriteBytes(png);
    writer.StoreAsync().get();
    writer.DetachStream();
    stream.Seek(0);
    auto decoder = BitmapDecoder::CreateAsync(stream).get();
    uint32_t w = decoder.PixelWidth(), h = decoder.PixelHeight();
    // Windows OCR reads images up to MaxImageDimension on each side: shrink bigger ones to fit.
    double k = 1;
    uint32_t max = OcrEngine::MaxImageDimension();
    if (w > max || h > max) k = (double)max / (w > h ? w : h);
    BitmapTransform transform;
    transform.ScaledWidth((uint32_t)(w * k));
    transform.ScaledHeight((uint32_t)(h * k));
    auto bitmap = decoder.GetSoftwareBitmapAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied, transform,
                                                 ExifOrientationMode::IgnoreExifOrientation, ColorManagementMode::DoNotColorManage).get();
    double bw = bitmap.PixelWidth(), bh = bitmap.PixelHeight();
    auto result = engine.RecognizeAsync(bitmap).get();

    std::string out = "{\"lines\":[";
    bool first = true;
    for (auto const& line : result.Lines()) {
      double x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
      for (auto const& word : line.Words()) {
        auto r = word.BoundingRect();
        x0 = r.X < x0 ? r.X : x0;
        y0 = r.Y < y0 ? r.Y : y0;
        x1 = r.X + r.Width > x1 ? r.X + r.Width : x1;
        y1 = r.Y + r.Height > y1 ? r.Y + r.Height : y1;
      }
      if (x1 <= x0) continue;
      char box[160];
      snprintf(box, sizeof box, ",\"x\":%.5f,\"y\":%.5f,\"w\":%.5f,\"h\":%.5f}", x0 / bw, y0 / bh, (x1 - x0) / bw, (y1 - y0) / bh);
      out += first ? "" : ",";
      out += "{\"text\":" + json(to_string(line.Text())) + box;
      first = false;
    }
    out += "],\"language\":" + json(to_string(engine.RecognizerLanguage().LanguageTag())) + "}";
    fwrite(out.data(), 1, out.size(), stdout);
  } catch (hresult_error const& e) {
    return fail(to_string(e.message()).c_str());
  }
  return 0;
}
