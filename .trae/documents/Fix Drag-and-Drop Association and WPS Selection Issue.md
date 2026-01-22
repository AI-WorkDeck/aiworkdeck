I will fix the drag-and-drop issue and the "undefined" selection error by implementing a robust selection caching mechanism and optimizing the WPS API usage.

### 1. Fix Selection Loss (The "undefined" error)
The root cause is that dragging files causes the WPS iframe to lose focus, making `Selection.Text` undefined.
- **Action**: In `WpsEditor.vue`, I will enhance the existing polling mechanism to reliably cache the last valid selection (start, end, text).
- **Action**: Expose a `getLastKnownSelection()` method in `WpsEditor` that returns the cached selection if the real-time one is invalid.
- **Action**: Update `project-overview.vue` to use this cached selection when dropping a file.

### 2. Fix Hyperlink Creation (The "no reaction" issue)
Since `Select()` might fail when focus is lost, I will try an alternative API approach that doesn't require visual selection.
- **Action**: In `WpsEditor.vue` -> `setHyperlinkAtRange`, I will add a fallback strategy:
  1. Try `range.Select()` then `doc.Hyperlinks.Add(...)` (Standard way).
  2. If that fails, try `range.Hyperlinks.Add(...)` (Contextual way, if supported).
  3. If all else fails, use the cached text to reconstruct the content.

### 3. Fix Floating Window UI (The "not turning blue" issue)
- **Action**: I will verify and enforce the CSS for `.filelink-float-zone.active` to ensure it gives visual feedback.
- **Action**: I will ensure `z-index` is sufficient so the drop zone is not blocked by other overlays.

### 4. Verification
- I will add detailed logs to track the entire flow: Drag Start -> Polling Selection -> Drop -> Link Creation.
- I will ask you to test by dragging a file to the float zone again.
