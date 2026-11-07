# State machines

What can be in what state in the Electron app, which moves between states are allowed, and what must always hold. Written to find bugs that come from states the code can reach but shouldn't, especially through repeated input, timeouts and work that overlaps in time. The native Mac app gets its own section later; its flows mirror these.

Most of these machines are **implicit**: a few variables whose combinations make the state. That is the right choice where the states are few and every handler checks the same guard (the capture session below). An explicit machine is only worth it where the guards are spread out and have already gone wrong. Each section says which.

**Bug status:** ✅ fixed (with a regression test) · 🟡 plausible, not reproduced · ⚪ checked, holds.

---

## 1. Capture session (main process, `src/main/overlay.ts`)

**Implicit.** State is `active` (bool), `session` (counter), `editTarget` (an edit of a floating preview, or null), plus `shownAt`, `touched`, `idleTimer`. Every async step re-checks `id === session && active` after each `await`; every renderer message carries the session and is ignored unless it matches. This guard is simple and uniform, so an explicit machine would add little.

| State | `active` | `editTarget` | Overlays |
|---|---|---|---|
| Idle | false | null | hidden (Windows: shown, invisible, click-through) |
| Grabbing | true | null | hidden |
| Arming | true | null | page told `arm`, not shown |
| Shown (dim) | true | null | visible, frozen image not yet painted |
| Live | true | null | frozen image painted, accepting input |
| Editing | true | set | one overlay, opened into the background editor |

| From | Event | To | Notes |
|---|---|---|---|
| Idle | hotkey / tray / second instance | Grabbing | `session++` |
| Grabbing | grab fails | Idle | |
| Grabbing | grab done | Arming | windows rebuilt if displays changed |
| Arming | page answers `armed` | Shown | |
| Arming | no answer in 1 s | Idle | force end, that window replaced |
| Shown | page answers `painted` | Live | |
| Shown | no answer in 2 s | Idle | force end, window replaced |
| any active | hotkey again | Idle | force end; if nothing was touched within 15 s (macOS), windows rebuilt |
| any active | Esc / copy / save / copy text / edit done | Idle | only if the message's session matches |
| any active | 3 min without input | Idle | |
| any active | overlay unresponsive / renderer gone | Idle | renderer gone: window replaced |
| any active | macOS moved to another Space within 1.5 s of opening | Idle → Grabbing | windows rebuilt, reopened once per 30 s |
| Idle | Edit on a preview, or Edit in History | Editing | ignored while a capture is open |

**Invariants**
- At most one capture or edit at a time (`active`).
- A message from the page acts only on the session it was armed with.
- Ending always hides every overlay and gives focus back (macOS), whatever the page does.

**Findings**
- ⚪ A late step of an ended session can't act on a newer one: `forceEndCapture` doesn't bump `session`, but every step re-checks `active`, and a new session bumps it. The page answers `painted` for any session (`Overlay.tsx:293`), and main only sends pixels for the current one, so a newer capture is never ended by an older one's timeout unless the page is truly stuck.
- 🟡 When an `armed` or `painted` timeout fires for a session that has already ended, `replaceOverlay` still destroys that display's window (`overlay.ts:316-320, 349-352`), even if a newer capture is using it. Needs a stuck page to happen; not reproduced.
- 🟡 `startEdit` ignores an `armed` timeout (`overlay.ts:375-377`) and has no idle timer, so a stuck page in an edit session stays on screen until the hotkey is pressed. Needs a stuck page.
- ✅ **A capture closed right after ⌘C could still go into History.** The page sends the History entry after the output; when Esc reached main first, the copy was refused but the entry was kept. Fix: main only keeps History entries for sessions whose copy, save or edit it accepted. Test: `e2e/states.mjs` (6).

## 2. Outputs: copy and save (main, `src/main/output.ts`)

**Implicit**, and none was kept before: each copy or save ran on its own. With compression on, the PNG is encoded on a worker thread, so two outputs close together overlap.

**Invariants**
- The clipboard holds the most recent copy.
- Two saves never write the same file; numbers are given in the order the saves were made.

**Findings**
- ✅ **The clipboard could end up with the older capture.** Copy a large capture, then a small one within the time the first takes to compress: the large one finishes last and overwrites the clipboard. Fix: a copy counter; a copy that finishes after a newer one has started doesn't write. Test: `src/main/output.test.ts`.
- ✅ **Two saves at once could overwrite each other's file**, losing a capture. The name and number were picked before compressing and the file written after, so both saves picked the same free name. Fix: each save takes its number when it's made, and picks a free name right before writing, with no wait in between. Test: `src/main/output.test.ts`.

## 3. History store (main, `src/main/history.ts`)

**Implicit**: `entries` in memory, `index.json` written 150 ms after a change, one folder per entry, written to `<id>.tmp` and renamed.

**Invariants**
- Every entry in the index has a folder with `final.png`; every folder is in the index (cleaned up at start).
- A re-edit replaces its entry (same id), keeping `createdAt` and the star.

**Findings**
- 🟡 Two re-edits of the same entry written at the same time share the `<id>.tmp` folder; the second rename can fail and that output isn't kept. Needs two outputs of the same entry within a few hundred ms.
- 🟡 Deleting an entry while its re-edit is being written brings it back. The History panel is hidden during an edit, so it needs a delete from elsewhere within that time.

## 4. Settings store (main, `src/main/settings.ts`)

**Implicit**: overrides in memory, written 100 ms after the last change and on quit. Changes are applied synchronously, so overlapping changes can't interleave. ⚪ holds.

## 5. Global hotkeys (main, `src/main/hotkeys.ts`)

**Implicit**, per hotkey: *ours* · *taken by another app* (retried every 4 s) · *stepped aside* (while capture mode is open, for shortcuts that capture mode uses itself, like ⌘⇧Z). Capture mode opening and closing moves them between *ours* and *stepped aside*. ⚪ holds.

## 6. Screen permission (main, `src/main/permissions.ts`, macOS)

**Findings**
- ✅ Pressing a capture hotkey several times without permission opened one explanation dialog per press. Fix: while one is open, further presses do nothing (and start no capture). Test: `src/main/permissions.test.ts`.

## 7. Overlay page (renderer, `src/renderer/src/overlay/Overlay.tsx`)

One page per display, kept loaded between captures. Its state is many `useState`s, plus module-level picks that are meant to last between captures (`lastStyle`, `lastVariants`, `lastBeautify`).

**Explicit where it mattered.** The page used to have no notion of "which capture is this": async work (reading text, making the output image, decoding an edit's image) captured the capture it started in and acted on whatever state the page had when it finished. Two counters now say which capture and which area a piece of work belongs to; every await is followed by a check, and stale work stops:

- `opened`: bumped when capture mode opens or closes. Outputs and the edit image check it.
- `area`: also bumped by a new area, the area moving to another display, and every text read (only the newest read counts). Text reads check it.

The rest stays implicit: the machines below are local to one handler each, and their guards are consistent.

| Machine | States | Moves |
|---|---|---|
| Phase | idle → armed → live → outputting → idle | `arm`, `pixels` (or the edit image decoded), copy / save / edit done (`busy`), `reset` |
| Area | none · creating · moving · resizing · selected | pointer down / move / up; cleared by `arm`, `reset`, and another display taking the area |
| Text read | none · reading · result (panel) · note | `X` or a drag in Capture text; Esc clears a result; a new area or capture drops it |
| Editor | closed · open | Background editor button, arm with an edit; Done / Esc; `reset` |
| Text box | none · typing | local to the drawing layer |
| Undo | past · present · future | pure functions in `annotate/model.ts`; replaced on `arm` and `reset` |

**Invariants**
- Work started for one capture never changes another capture's state.
- At most one display has an area; drawings, text results and the editor belong to it.
- One output per capture (`busy` is set before the first await).
- Capture text reads text only: no drawing, and nothing copies or saves the image.

**What `reset` clears:** the capture, area, drag, drawings and undo, tool, selected shape, editor, and the frozen image. Text results, notes, `busy`, style and background are cleared by the next `arm`; that was fine on its own, the bug was late work setting them again after `arm`.

**Findings**
- ✅ **A text read finishing after capture mode closed froze the next capture.** Press X, then Esc (or ⌘C) before it finishes, and open capture mode again. The old read's result then arrived: in "Copy right away" mode it showed "Copied … lines" and set `busy`, so tools, Copy and Save did nothing until Esc. In panel mode, the old text panel showed over the new area. Fix: the `area` counter. Test: `e2e/states.mjs` (1).
- ✅ **Two text reads at once**, from dragging two areas quickly in Capture text, or from pressing X and then dragging a new area. Whichever answer came last won, its lines could be outlined on the wrong area, and both could reach the clipboard. Fix: only the newest read counts. Test: `e2e/states.mjs` (2).
- ✅ **Capture text allowed drawing**, and once a shape existed a click outside the area no longer started a new one. Enter, ⌘C and ⌘S copied or saved the image. Fix: no drawing layer and no tool, copy or save keys in Capture text. Test: `e2e/states.mjs` (3).
- ✅ **The area moving to another display left its drawings and editor behind.** Starting an area on display B cleared only A's rectangle. Dragging on A again brought back the old drawings and undo steps, and opened the editor at once if it had been open. A text read on A could still copy and close capture mode while you worked on B. Fix: the area going away clears its drawings, undo, tool, text result and editor, and drops its read. Test: `e2e/states.mjs` (4), by sending the "area moved" message.
- ✅ **"Remember last background" reset the color and tool styles picked.** It changes the background defaults after a copy, and the next capture took any change in settings as "new defaults", dropping the session's picks. Fix: drawing picks reset only when the drawing settings change, background picks only when the background settings change. Test: `e2e/states.mjs` (5).
- ✅ **The edit image (from a preview or History) had no failure path**: if it couldn't be decoded, outputs waited for it forever. A late decode after Esc also repainted the screenshot that `reset` had just released. Fix: an undecodable image closes the editor; a late decode is dropped. Checked by reading; no test (needs a corrupt image in a document).
- 🟡 Capture mode closing in the middle of a pen stroke leaves the stroke's window listeners; letting go after the next capture opened could add the old drawings to it. Needs `reset` to arrive between mouse down and up.
- 🟡 Picking two image backgrounds in quick succession can show the first one's preview (no stale check in `BackgroundEditor.tsx` `setImage`); a background image that failed to load once stays failed until restart (`render.ts`).

## 8. Floating previews and pins (main `src/main/pin.ts`, renderer `pin/`)

**Implicit**, per window: *loading* → *shown* → *closed*; previews also *in the corner stack* or *moved*, and *linked to a History entry* once it's written. Editing a preview goes through the capture session (section 1), which allows one edit at a time.

**Findings**
- ✅ **Double-clicking any button on a preview also opened the editor** (the double-click to edit was on the whole preview). Double-clicking Copy copied twice and opened the editor. Fix: only a double click on the image edits. Test: `e2e/states.mjs` (7).
- ✅ **A pin saved again while saving** (⌘S pressed twice or held, or Save twice from the menu) wrote two numbered files, or opened two save dialogs. Fix: one save at a time per pin. Test: `e2e/states.mjs` (8).
- 🟡 A preview whose capture never reaches History (History paused) stays in `thumbBySession` until quit: a small leak, no visible effect.

---

## Confirmed bugs by impact

| # | Bug | Impact | Section |
|---|---|---|---|
| 1 | Two saves at once overwrote each other's file | A capture is lost (needs compression on and no save dialog) | 2 |
| 2 | A late text read froze the next capture | Capture mode stops responding until Esc | 7 |
| 3 | The clipboard could end up with the older capture | The wrong image is pasted, silently (needs compression on) | 2 |
| 4 | The area moving to another display left drawings and the editor behind | Old drawings come back or go into the output (several displays) | 7 |
| 5 | Capture text allowed drawing and copied the image | Can't drag a new text area; ⌘C copies an image instead of text | 7 |
| 6 | "Remember last background" reset the color picked | The color picked resets after changing the background | 7 |
| 7 | Double-clicking a preview button opened the editor | Unexpected editor; double copy | 8 |
| 8 | Two text reads at once | Wrong text copied or outlined | 7 |
| 9 | A pin saved twice | Duplicate files or dialogs | 8 |
| 10 | Esc right after ⌘C still went into History | A History entry for a capture that wasn't copied | 1 |
| 11 | One permission dialog per hotkey press | Stacked dialogs | 6 |
| 12 | Undecodable edit image | Editor outputs wait forever | 7 |

## Issues

Fixes are grouped by cause:

- [#1](https://github.com/an-ordinary-melody/snapkit/issues/1) **Work from an earlier capture or area acting on the current one** (bugs 2, 4, 8, 10, 12): the `opened` and `area` counters and main's check of History entries.
- [#2](https://github.com/an-ordinary-melody/snapkit/issues/2) **Outputs overlapping** (bugs 1, 3, 9): copy order, save naming, one pin save at a time.
- [#3](https://github.com/an-ordinary-melody/snapkit/issues/3) **Capture text is for text only** (bug 5).
- [#4](https://github.com/an-ordinary-melody/snapkit/issues/4) **Small state leaks between features** (bugs 6, 7, 11).
