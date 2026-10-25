# Snapkit landing page: plan

A one-page site for Snapkit, free on Vercel. Clean and modern, in the style of
[colorme.vn/tools/remove-background](https://colorme.vn/tools/remove-background):
a white page, a big headline with one word set in an italic serif, black pill buttons,
and a soft gray rounded "stage" holding tilted cards and small floating labels.

## 1. Stack and hosting

| Choice | Why |
|---|---|
| **Astro** (static output) in a new `site/` folder in this repo | Ships plain HTML, with JS only where a demo needs it. Can read `release-notes/*.md` and `src/shared/settings.ts` at build time, so the changelog and the background presets come from the app's own files. |
| **React islands** for the interactive demos | Same React and `lucide-react` icons as the app, so the demo toolbars look like the real ones. |
| Plain CSS with color tokens on `:root` (no Tailwind) | Small, matches the app's CSS approach; light theme first, dark via `prefers-color-scheme`. |
| Fonts: **Geist** or Inter for text, **Instrument Serif** italic for the accent word | Same look as the reference page. Self-hosted through `@fontsource`. |
| **Vercel Hobby** (free) | Import the GitHub repo, Root Directory `site`, framework Astro. Free plan covers an open-source, non-commercial project. Address `snapkit.vercel.app` (or a custom domain later). |

`site/` gets its own `package.json`, so the site never installs Electron, and the app build never sees the site.

**Every push to main deploys** (no Ignored Build Step: Vercel's shallow clone has no `HEAD^`, so a
`git diff HEAD^ HEAD` filter fails the build, and a release rebuild must run even when no site file changed).

**Download links stay current:** at build time the site reads the GitHub releases API
(`/repos/an-ordinary-melody/snapkit/releases`, which, unlike `/releases/latest`, includes betas) and gets the `.dmg` and `-setup.exe` URLs.
The Release job in `.github/workflows/build.yml` calls a Vercel Deploy Hook (secret `VERCEL_DEPLOY_HOOK`) after publishing, so a new release redeploys the site.
If the API call fails at build time, the buttons fall back to `github.com/an-ordinary-melody/snapkit/releases/latest`.

## 2. Page sections

### 2.1 Header and hero: capture mode in action

- Nav: logo (from `branding/lockup-horizontal.svg`), Features · FAQ · Changelog · GitHub (with star count), a small black "Download" pill.
- Headline, for example: **"Screenshots, *your way*."** (the serif italic accent word).
  Subline: "A free screenshot tool for macOS and Windows. Capture, annotate, beautify and share, with every step yours to change."
- Two buttons: **Download for macOS** (black) and **Download for Windows** (light).
  The visitor's OS is detected and that button comes first; the other stays next to it.
  Under them, small text: `v0.2.0-beta.4 · Apple Silicon · Windows x64 · MIT`.
- Floating labels on the stage, like the reference: "Free & open source", "macOS + Windows", "Every tool optional".
- **The stage: an animated capture mode** (HTML/CSS + a small timeline script, not a video, so it stays sharp, small and themable). A loop of about 8 seconds:
  1. A fake desktop (a browser window with a pricing card), the hotkey keycaps `⌥ ⇧ Z` light up.
  2. The screen dims; a crosshair drags out a selection with its live size label (`640 × 400`).
  3. The vertical tools bar and the action bar slide in beside the selection (real lucide icons).
  4. An arrow is drawn, steps ① ② drop in, an email address gets blurred.
  5. The background toggles on: an orange-to-yellow gradient with padding, corners and shadow wraps the shot.
  6. `⌘C`, a "Copied" toast, and the floating preview lands in the bottom-right corner.
  - With `prefers-reduced-motion`, it shows the finished frame. Pauses when off screen.

### 2.2 Three signatures

Three large cards in a row (stacked on phones), each with a small live demo, not a static image.

1. **Your workflow, your settings.** A mini settings panel with real switches:
   *Floating preview after copy*, *Quick area capture*, *Background on copy*, *Ask where to save*.
   Flipping a switch changes a small flow strip beside it (`Select → Draw → Copy → Preview`).
   Plus keycaps showing the shortcuts are yours to change.
2. **Annotate. Blur. Numbered steps.** A small screenshot where the tools play in turn:
   an arrow, a highlight, text with a stroke, a blur that sharpens on hover, and steps that count themselves (① ② ③). Shortcut letters (`A`, `B`, `N`…) shown under each tool.
3. **Background presets, fully yours.** Click a preset (Ember, Sunset, Mint, and a few from the app's 32 gradients, read from `src/shared/settings.ts`), and the screenshot re-frames: gradient, padding, corners, shadow, then the size chips `Auto · 1:1 · 16:9 · 9:16`.

### 2.3 Why a screenshot app in 2026?

A quiet text section in a narrow column, with no signature. Lightly copyedited from your note:

> **Why a screenshot app in 2026?**
>
> Taking screenshots is something I do a lot, and I suspect I'm not the only one.
> There are plenty of screenshot tools out there, and some are arguably more polished.
> I'd probably have stuck with Lightshot if it didn't look set to have compatibility problems with upcoming macOS versions.
> So I built one that fits my own workflow and comes with the extra tools I need.
> The aim: good defaults that cover most people's everyday needs (hopefully), while staying very customizable and extensible.
>
> And it's all open source. If it still isn't quite right for you, fork it and ask Claude or ChatGPT to build the version you need.

### 2.4 Features in detail

A tabbed explorer: tabs down the left (a row of chips on phones), a demo on the right. Each tab has one or two lines of copy and a looping mini demo.

| Tab | Shows |
|---|---|
| **Capture** | Area (`⌥⇧Z`), full screen (`⌘⇧9`) straight to the preview, quick area capture, arrow-key nudging, frozen screen. |
| **Annotate** | Pencil, line, arrow (one- or two-way), rectangle/ellipse (filled too), highlighter, text, steps, blur/pixelate; letter shortcuts; undo/redo. |
| **Smart align** | Dragging a shape, pink guides snap it to the others and to the capture edges. |
| **Text** | Plain, stroke, light and dark background styles; click to edit in place. |
| **Background editor** | Gradient/color, editable hex, hue slider, random, 32 + 32 presets, output sizes, zoom and pan. |
| **Floating preview & pins** | The preview in the corner (Copy, Edit, drag out), turning it into a pin that floats over everything, zoom and opacity. |
| **History** | `⌘⇧1`: recent captures, copy again, edit with drawings still editable, star, drag out as a file. |
| **Make it yours** | Light / Gray / Dark / System, Liquid Glass, highlight color, toolbar order, every shortcut. |

Demos are built in the DOM like the hero. Where a real look matters more than motion (Settings window, History panel), use real screenshots taken with Snapkit itself, framed with its own background (a nice touch: "Every image on this page was made with Snapkit").

### 2.5 Questions and answers

An accordion. Draft answers, all checked against the code:

- **Is it really free?** Yes. Open source under the MIT license. No account, no ads, no paid tier.
- **Does it send my screenshots anywhere?** No. Captures, history and settings stay on your computer. The only network request is a once-a-day check of GitHub for a new version (`src/main/system.ts`), which you can see in Settings → About. Clearing history deletes the files.
- **Is it safe?** The code is public. Windows are sandboxed, accept messages only from Snapkit's own pages, and can't open web pages; the packaged app has Electron's run-as-Node and debug switches turned off.
- **Why does macOS warn me when I open it?** Snapkit isn't signed with a paid Apple Developer ID yet. Open it once, then System Settings → Privacy & Security → **Open Anyway** (or `xattr -cr /Applications/Snapkit.app`). Then allow Screen Recording and reopen.
- **Windows says "Windows protected your PC".** Same reason: click **More info → Run anyway**.
- **Why does it need Screen Recording permission?** That's how macOS lets any app read the screen to take a screenshot.
- **Intel Mac? Linux?** Apple Silicon only for now; Windows x64. Since it's open source, you can build it for other systems yourself.
- **How do updates work?** Snapkit tells you when there's a new version and downloads the installer; nothing installs by itself.
- **Where do I report a bug or ask for a feature?** GitHub Issues.

### 2.6 Changelog and roadmap

Two columns (stacked on phones).

- **Changelog:** a timeline built from `release-notes/*.md` at build time (version, date from the git tag, the Highlights list), newest first, the top three open and the rest collapsed. "Unreleased" on top, taken from commits since the last tag, is optional.
- **Roadmap:** a small hand-written list in `site/src/content/roadmap.json`:
  - **Custom image backgrounds:** use your own picture behind a screenshot (the editor already shows "Coming later").
  - **Performance:** faster capture start and lighter memory use (for example ScreenCaptureKit on macOS, DXGI on Windows).

### 2.7 Footer

A last call to action ("Ready to snap?" with both download buttons, like the reference's closing band), then GitHub, Issues, License, and "Made with Snapkit".

## 3. Assets to prepare

- Logo and favicon from `branding/` (SVG).
- Open Graph image (1200×630): the hero's final frame, rendered with `@vercel/og` or exported once.
- 3–4 real screenshots taken with Snapkit: Settings (General + Toolbar), History panel, Background editor, a pin.
- Optionally a 15-second real screen recording (MP4/WebM, under 2 MB) for the Capture tab, if the built demo isn't convincing enough.

## 4. Quality

- Lighthouse 95+ on all four scores; no layout shift from fonts (`font-display: swap` + size-adjusted fallback).
- Works at 375 px wide with a 16 px gutter and no sideways scroll; demos scale down or swap to a still frame.
- Keyboard and screen-reader friendly: real buttons, labeled tabs and accordion, demos marked `aria-hidden` with a text description.
- Same QC rule as the app: a Playwright check in `site/e2e/` that loads the page at desktop and phone widths, finds no console errors, and checks both download links point at a `.dmg` / `-setup.exe`. It runs on Vercel preview deploys (or in CI).
- Vercel Web Analytics (free, no cookies) is optional; the privacy answer stays true either way since it concerns the site, not the app.

## 5. Steps

1. Scaffold `site/` (Astro, React, fonts, tokens), nav, footer; connect Vercel and deploy an empty page.
2. Hero with the animated capture-mode stage and the download buttons (release lookup + OS detection).
3. The three signature cards and their demos.
4. Story section and FAQ.
5. Feature explorer (demos plus real screenshots).
6. Changelog from release notes, roadmap from JSON.
7. OG image, meta, sitemap, analytics; Playwright check; deploy hook in the release workflow.
8. Phone and dark-mode pass, Lighthouse, then point a domain at it if wanted.

## 6. Open questions

- **Domain:** `snapkit.vercel.app` to start, or a custom one?

Decided: English only for now; no signature on the story; roadmap is custom image backgrounds and performance.
