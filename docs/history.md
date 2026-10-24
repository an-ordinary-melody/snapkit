# Capture history: strategy

Phase 6 (built). A floating panel (like a clipboard manager) of past captures: click to
copy again, or re-edit, pin, save, delete. This is the plan for what is kept,
where, and how it's cleaned up.

## Goals

- **Copy again instantly**, without re-rendering.
- **Re-edit** a past capture with its drawings and background still editable
  (the same capture document the floating preview already uses).
- **Bounded**: disk use and memory stay small no matter how long Snapkit runs.
- **Never slow down capturing**: history work happens after the copy, off the hot path.
- **Local and private**: nothing leaves the Mac; clearing really deletes.

## What is kept per capture

Each entry is a folder, `history/<id>/`, with:

| File | What | Why |
|---|---|---|
| `final.png` | The output exactly as copied/saved (drawings and background baked in) | Copy again with no work |
| `source.png` | The plain crop, no drawings | Re-edit |
| `doc.json` | Drawings and background settings (the `CaptureDoc` minus the PNG) | Re-edit |
| `thumb.jpg` | ~320 px wide, JPEG 80% | The panel loads only these |

Plus one `history/index.json`: newest first, one small record per entry
(`id`, `createdAt`, `width`, `height`, `bytes`, `starred`, `hasBackground`).
It's kept in memory in the main process (~200 bytes per entry).

**When an entry is made:** on every output, meaning copy, save, pin, or Done on a
floating preview. A cancelled capture (Esc) isn't kept. Re-editing an entry and
copying again **updates that entry** (new `final.png`, `thumb.jpg`, `doc.json`,
and it moves to the top) rather than adding a duplicate.

**How it's written:** the renderer already composes the plain crop and the
output for the copy; it also makes the thumbnail (a small canvas → JPEG) and
sends all of it with the copy. Main copies to the clipboard first, then writes
the files with async `fs` calls into `history/<id>.tmp/` and renames the folder
when done, then updates `index.json` (atomic write, debounced). A crash can only
leave a `.tmp` folder, which startup removes.

## Limits and clearing

Settings (General → History), applied in this order after every new entry, at
startup, when the settings change, and every 6 hours:

1. **Keep at most N captures**: default 20 (1–100; a hard ceiling of 100 applies whatever the settings say, to keep the panel and disk use fast).
2. **Size limit**: default 300 MB (50 MB–2 GB, also a hard ceiling). While over it, delete the oldest.
3. **Keep for**: default 30 days (or forever). Older entries are deleted.

**Starred** entries are skipped by all three, so you can keep favorites
forever. Deleting removes the files for good (it's a cache; files you saved
elsewhere are never touched).

Manual clearing:
- delete one entry, in the panel or with the Delete key
- "Clear history…", with a choice of everything or everything except starred
- "Pause history" in the menu-bar menu: nothing is recorded while paused

**Startup check:** remove `.tmp` folders, folders not in the index, and index
entries whose files are missing; recompute `bytes` where unknown. Snapkit's
temporary drag-out files are cleaned up at startup too.

## Memory and speed

- The panel reads only `index.json` and `thumb.jpg` files (about 25 KB each), and
  loads thumbnails lazily as they scroll into view. 50 entries is about 1.3 MB.
- `final.png` is read only for copy, pin or save; `source.png` + `doc.json` only
  for edit.
- Targets: recording blocks the main process for under 50 ms (measured: 2–4 ms
  of async writes per capture); the panel opens instantly (it's preloaded).

## Panel

⌘⇧1 (changeable in Settings → Shortcuts), the menu bar's History…, or
`Snapkit --history` opens a floating panel with the newest capture first.
Arrows move, Enter copies, E edits, P pins, S saves, Delete deletes, Esc closes.
Hover shows the same actions. F stars. Settings → General → History has the
limits, Pause, the folder (Show folder) and Clear (keep starred, or all).
