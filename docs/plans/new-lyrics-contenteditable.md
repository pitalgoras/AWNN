# Contenteditable Lyrics Builder — Final Plan (v3)

## Branch
`new-lyrics` — all changes isolated from `main`.

---

## Core Architecture

Replace textarea (edit mode) + view-only render (voicing mode) with a **single always-contenteditable workspace**.
No `isEditMode` toggle. Same behavior on desktop and mobile.

The component owns a div with `contentEditable` and never sets innerHTML during user typing.
**React never manages the editable content's value** during typing.
The DOM is the source of truth for display; the raw string is reconstructed by `serializeEditor()` only on save events
(blur, tab-change, paint action, beforeunload).

CSS cascade inside `.voice-zone` wrapper spans handles colored text for painted regions.
Typed text within a zone inherits the zone's background/color automatically — no keystroke interception needed.

---

## Painting Model

Two modes: **Normal** (default) and **Spree**. `activeTagId` is persistent — never auto-clears.
Palette always shows a ring on the active tag.

| Action | Normal mode | Spree mode |
|--------|-------------|------------|
| Tap palette button | Set `activeTagId` + **paint at cursor word** (via `paintAtCursor()`) | Same as normal |
| Long-press palette | Enter spree mode (sets `activeTagId` to this tag) | Exit spree mode |
| Tap word in lyrics | Normal cursor movement | Paint word with `activeTagId` |
| Select text + tap palette | Paint selection | Same |
| Type text | Normal typing, CSS cascade if in voice zone | Same |
| Escape key | No-op | Exit spree mode |
| Blur editor | Serialize, stay in spree (no change) | Same |

**Key differences from current implementation:**
- Palette tap triggers `paintAtCursor()` synchronously (no need to wait for spree)
- Word-click only paints in spree mode
- `activeTagId` persists indefinitely — never cleared

---

## Painting Flow

### Normal mode — palette click paints (the main flow)

TrackBar's `handleTagClick` calls **Approach B**: module-level `paintAtCursor()` from `lyricsDOM.ts`.

```
handleTagClick(tag):
  1. setActiveTagId(tag.id)
  2. paintAtCursor(tag.id, currentLyricsText, tagColorMap)
     ├── serializeEditor(editorRef) → get current raw text
     ├── getSelectedCharRange(editorRef) → cursor position
     ├── null/no cursor → PATH 3: set pendingPaintRef = true, return currentRaw unchanged
     ├── start === end → PATH 1: expand to word boundaries, applyTagToWord()
     ├── start < end  → PATH 2: applyTagToSelection()
     └── returns newRaw (or unchanged for PATH 3)
  3. If newRaw !== lyricsText → setLyricsText(newRaw)
```

### Path 1: Cursor in/next to a word
1. `getSelectedCharRange(editorEl)` returns `{start, end}` with `start === end` (cursor)
2. Expand to word boundaries in raw text: backward `\S+$` + forward `^\S+`
3. Call `applyTagToWord(raw, wordStart, wordEnd, targetTag, tagColorMap)`
4. Returns updated raw. `setLyricsText(newRaw)` → DOM re-renders

### Path 2: Text selected (multiple chars)
1. `getSelectedCharRange(editorEl)` returns `{start, end}` with `start < end`
2. Call `applyTagToSelection(raw, start, end, targetTag, tagColorMap)`:
   - `endTag = findPrevTag(raw, selEnd)` — what tag governed the selection end
   - `raw = removeTagsInRange(raw, selStart, selEnd)` — strip interior voicing tags
   - `raw = applyTagToWord(raw, selStart, selStart, targetTag, tagColorMap)`
   - `raw = applyTagToWord(raw, adjEnd, adjEnd, endTag, tagColorMap)`
3. `setLyricsText(newRaw)` → DOM re-renders

### Path 3: No cursor (empty editor / end of text / blank line)
1. Palette tap → `pendingPaintRef.current = true`
2. User types first character → `onInput` fires
3. `serializeEditor` → capture raw with typed text
4. `applyTagToWord(raw, wordStart, wordEnd, activeTagId, tagColorMap)` → newRaw
5. `setLyricsText(newRaw)` → DOM re-renders with tag before typed word
6. `pendingPaintRef` cleared. Subsequent typing in same zone inherits CSS cascade.
7. `activeTagId` stays set.

---

## Cursor Preservation

**Normal paint (palette click, PATH 1/2):** Tolerable to lose cursor after `setLyricsText` re-render.
The user explicitly tapped a palette button — the cursor jump is an acceptable trade-off.

**PATH 3 (first keystroke):** The typed character is preserved in the new raw text.
Cursor is lost on re-render but the character and tag are visible.
After re-render: tag chip spans have `contentEditable=false`, user clicks to reposition.

---

## Section Tag Insertion

When the user taps a section tag button (e.g., `[Verse]`):

1. `serializeEditor` → current raw
2. `getSelectedCharRange` → cursor position
3. If cursor is mid-line (not at line start):
   - Find line start and end in raw: `lastIndexOf('\n', pos - 1) + 1` to `indexOf('\n', pos)` or end
   - `beforeCursor = raw.slice(lineStart, cursorPos)`
   - `afterCursor = raw.slice(cursorPos, lineEnd)`
   - If cursor is mid-word, the word is split (text before cursor stays, text after goes to next line)
4. New raw:
   ```
   before the line\n
   beforeCursor\n
   \n
   [SECTION_TAG]\n
   afterCursor\n
   rest of raw after the line
   ```
5. `setLyricsText(newRaw)` → re-render
6. Cursor should be on the empty line after `[SECTION_TAG]` (saved and restored if possible)

The section tag always follows an empty line (unless on line 1), and leaves an empty line after it.

---

## CSS Cascade Inheritance for Typing Colors

**HTML structure for each line:**
```html
<div data-line="0">
  <span class="inline voice-zone" style="background:#F6E05E; color:#1a1a1a">
    <span contenteditable="false" data-raw="[S]" style="background:#F6E05E">S</span>
    <span class="inline-block" style="background:#F6E05E; color:#1a1a1a">Hello</span>
    (space text node)
    <span class="inline-block" style="background:#F6E05E; color:#1a1a1a">world</span>
  </span>
  <span class="inline voice-zone" style="background:#F56565; color:#fff">
    <span contenteditable="false" data-raw="[A]" style="background:#F56565">A</span>
    <span class="inline-block" style="background:#F56565; color:#fff">foo</span>
  </span>
</div>
```

- Each contiguous block with the same voice tag is wrapped in a `.voice-zone` span
- `.voice-zone` carries `background` and `color` — these **cascade** to child text nodes
- New typed text within a `.voice-zone` automatically inherits the background color
- Tag chips explicitly set their own `background`/`color` to stay visible (override cascade)
- When the user types at a boundary between zones, the browser places text in one zone or the other

**Zero keystroke interception** for normal typing inside painted areas. The browser handles color inheritance natively.

---

## Tag Rendering Modes (`tagPreviewMode`)

Stored in Zustand: `tagPreviewMode: 'hidden' | 'chip' | 'full'` (default: `'chip'`).

| Mode | `[S]` renders as | `[T:1.23]` renders as |
|------|------------------|----------------------|
| `hidden` | `<span data-raw="[S]" style="display:none"></span>` | Same (always hidden) |
| `chip` | `<span data-raw="[S]" contenteditable="false" style="...">S</span>` | Zero-height/display-none span |
| `full` | `<span data-raw="[S]" contenteditable="false" style="color:#F6E05E">[S]</span>` | Same |

- Tags: always `contenteditable="false"`, always carry `data-raw` attribute for serialization
- `serializeEditor`: deep-walks `data-line` divs, collects `data-raw` from tag spans + text from text nodes, joins with `\n`
- Words: editable inline spans with background color when painted
- Spaces between words: plain text nodes (no background)
- Section tags: rendered as italic uppercase headers (block display, not in voice zone)
- Time tags: always d-none spans (raw data preserved for export, not editable)

---

## Contenteditable Lifecycle

| Event | What happens |
|-------|-------------|
| User types | Browser handles DOM natively. Zero React interference. Cursor stable. Color inherits from CSS cascade. |
| Blur editor | `serializeEditor(el)` → `setLyricsText(raw)` → store saved |
| Paint (palette tap, normal) | `paintAtCursor()` called from TrackBar → serializes → `applyTagToWord/Selection` → `setLyricsText(newRaw)` → re-render via `renderRawToDOM` |
| Paint (word click, spree) | `handleEditorPointerUp` → same flow as above |
| First keystroke after palette (PATH 3) | `onInput` fires → serialize → `applyTagToWord` → `setLyricsText` → re-render with tag |
| Anchor line | `serializeEditor` → insert `[T:x] ` at line start → `setLyricsText` → re-render |
| Section insert | `serializeEditor` → split line at cursor → insert section tag with empty lines → `setLyricsText` → re-render |

**Cursor preservation:** On paint actions (palette tap, spree word-click), cursor loss is tolerable — user explicitly triggered the action.
CURSOR IS SAVED BEFORE re-render and restored after `renderRawToDOM` for all paint paths to minimize disruption.

---

## File-by-File Changes

### 1. `src/lib/lyricsDOM.ts` — ADD `paintAtCursor()` export

Module-level `_editorRef` set by LyricsBuilder on mount in a `useEffect`.

```ts
let _editorRef: HTMLElement | null = null;
export function setEditorRef(el: HTMLElement | null) { _editorRef = el; }
export function getEditorRef() { return _editorRef; }

export function paintAtCursor(
  tagId: string,
  lyricsText: string,
  tagColorMap: Record<string, string>
): string | null {
  if (!_editorRef) return null; // no editor mounted
  const range = getSelectedCharRange(_editorRef);
  if (!range) return null; // PATH 3 — no cursor, signal to caller
  const currentRaw = serializeEditor(_editorRef);
  if (range.start === range.end) {
    return applyTagToWord(currentRaw, range.start, range.end, tagId, tagColorMap);
  } else {
    return applyTagToSelection(currentRaw, range.start, range.end, tagId, tagColorMap);
  }
}
```

Also fix `serializeNode` to deep-walk nested elements instead of using `.textContent` for non-`data-raw` elements.

### 2. `src/lib/lyricsCore.ts` — No changes needed

`applyTagToWord`, `applyTagToSelection`, `cleanupLyrics` already match main's `handleWordInteraction` exactly.

### 3. `src/lib/lyricsFormat.ts` — Already done

`rawToTabular`/`tabularToRaw` removed. `EXPANDED_TAG_MAP`, `normalizeVoicingTag` kept.

### 4. `src/store/useStore.ts` — No changes needed

Current state already has all required fields:
- `activeTagId`, `setActiveTagId` (persistent, never auto-clears)
- `tagPreviewMode`, `setTagPreviewMode`
- `isSpreeMode`, `setSpreeMode`
- `lyricsText`, `setLyricsText`
- `customTags`, `comboTagSeparator`, `sectionTags`

### 5. `src/components/LyricsBuilder.tsx` — MODIFY

**Changes from current implementation:**
- Add `onInput` handler for PATH 3 (first keystroke after empty palette tap)
- `handleEditorPointerUp`: only paints in spree mode (already gated on `isSpreeMode`)
- Import `setEditorRef` from `lyricsDOM.ts`, call in mount `useEffect`
- No changes to `handleBlur`/`handleKeyDown`
- Section tag insertion: split at cursor line instead of appending at end

**`onInput` handler (PATH 3):**
```ts
const handleInput = useCallback(() => {
  if (!editorRef.current) return;
  const state = useStore.getState();
  if (!pendingPaintRef.current || !state.activeTagId) {
    // Normal blur-equivalent save on every input
    const newRaw = serializeEditor(editorRef.current);
    if (newRaw !== state.lyricsText) {
      state.setLyricsText(newRaw);
    }
    return;
  }
  // PATH 3: first keystroke after palette tap with no cursor
  pendingPaintRef.current = false;
  const currentRaw = serializeEditor(editorRef.current);
  const range = getSelectedCharRange(editorRef.current);
  if (!range || range.start !== range.end) return;
  // Expand word boundaries
  const textBefore = currentRaw.slice(0, range.start);
  const textAfter = currentRaw.slice(range.start);
  const wordStartMatch = textBefore.match(/(\S+)\s*$/);
  const wordEndMatch = textAfter.match(/^(\S+)/);
  const wordStart = wordStartMatch ? range.start - wordStartMatch[1].length : range.start;
  const wordEnd = wordEndMatch ? range.start + wordEndMatch[1].length : range.start;
  if (wordStart === wordEnd) return; // no word found
  const newRaw = applyTagToWord(currentRaw, wordStart, wordEnd, state.activeTagId, tagColorMap);
  if (newRaw !== currentRaw) {
    setLyricsText(newRaw);
  }
}, [tagColorMap, setLyricsText]);
```

Wait — `onInput` fires ON EVERY input, including after `setLyricsText` re-renders. The key insight: after `setLyricsText` → React re-renders → `renderRawToDOM` replaces `innerHTML` → this does NOT fire `input`. So there's no re-entrant issue with `onInput` firing after the re-render.

But there IS an issue: after the re-render from PATH 3, the user's cursor is lost. They need to click to reposition. This is acceptable for PATH 3 (rare edge case — typing the very first character in an empty editor after a palette tap).

### 6. `src/components/TrackBar.tsx` — MODIFY

**`handleTagClick` — now calls `paintAtCursor` (Approach B):**
```ts
const handleTagClick = (tag: { id: string; color: string }) => {
  const state = useStore.getState();
  state.setActiveTagId(tag.id);
  const newRaw = paintAtCursor(tag.id, state.lyricsText, tagColorMap);
  if (newRaw !== null && newRaw !== state.lyricsText) {
    state.setLyricsText(newRaw);
  }
  // newRaw === null means PATH 3 — pendingPaintRef handles it
};
```

But wait — `paintAtCursor` sets a `pendingPaintRef` in LyricsBuilder. TrackBar doesn't have access to that ref directly. How?

The ref is in LyricsBuilder. `paintAtCursor` returns `null` when no cursor/selection (PATH 3). TrackBar gets `null` and can't set the flag.

Option: `paintAtCursor` also takes a `setPending` callback. Or the ref lives at module level in `lyricsDOM.ts`:

```ts
// lyricsDOM.ts
let _pendingPaintRef: { current: boolean } = { current: false };
export function setPendingPaintRef(ref: { current: boolean }) { _pendingPaintRef = ref; }
export function paintAtCursor(...): string | null {
  if (!_editorRef) return null;
  const range = getSelectedCharRange(_editorRef);
  if (!range) {
    _pendingPaintRef.current = true;
    return null; // PATH 3
  }
  ...
}
```

Then LyricsBuilder calls `setPendingPaintRef(pendingPaintRef)` in its mount effect alongside `setEditorRef`.

**Short/long press for spree:**
```ts
// Keep current handleTagPointerDown/Up/Leave
// On long press → toggle spree (reads fresh isSpreeMode at timer fire)
// On short press (timer still active) → handleTagClick (which now also paints)
```

For short press with Approach B, `handleTagPointerUp` should call `handleTagClick`:
```ts
const handleTagPointerUp = (tag: { id: string; color: string }) => {
  if (spreeLongPressTimer.current) {
    clearTimeout(spreeLongPressTimer.current);
    spreeLongPressTimer.current = null;
    handleTagClick(tag); // short press → set active + paint
  }
};
```

**Track button clicks:**
Track buttons should also paint:
```ts
const handleTrackTagClick = (track: any) => {
  const tagId = `[${getTrackTagLabel(track)}]`;
  const state = useStore.getState();
  state.setActiveTagId(tagId);
  const newRaw = paintAtCursor(tagId, state.lyricsText, tagColorMap);
  if (newRaw !== null && newRaw !== state.lyricsText) {
    state.setLyricsText(newRaw);
  }
};
```

### 7. `src/lib/lyricsDOM.ts` — Fix `serializeEditor` voice-zone walking (Bug 4)

Current `serializeNode` does deep walking correctly (line 139-153) — it recurses into non-`data-raw` elements instead of using `.textContent`. This should already handle voice-zone wrappers.

**But verify:** voice-zone wrapper spans have no `data-raw` attribute. `serializeNode` receives them as an HTMLElement without `data-raw`, so it recurses into their children. Children include:
- Tag span (has `data-raw`) → collects the raw attribute value
- Word spans (no `data-raw`) → recurses, gets textContent from text node children
- Space text nodes → gets nodeValue

This should produce correct output. If Bug 4 is still present, it's because `serializeNode` doesn't encounter the tag span's `data-raw` attribute (maybe the tag span is a direct child of a `.voice-zone` wrapper which is a child of the `data-line` div). But `serializeNode` walks `node.childNodes` which should include the voice-zone wrapper as a child, then recurse into it...

Actually, the issue might be: `serializeEditor` uses `root.querySelectorAll(':scope > [data-line]')`, then calls `serializeNode(lineDiv)`. Inside `serializeNode`, it walks `node.childNodes`. If the line structure is:
```
div[data-line]  →  span.voice-zone  →  span[data-raw]
                                      →  span.word
                                      →  text-node (space)
```

Then `serializeNode(lineDiv)`:
- child = `span.voice-zone` (HTMLElement, no data-raw)
- `serializeNode(span.voice-zone)`:
  - child = `span[data-raw]` (has data-raw) → collects raw tag text
  - child = `span.word` (no data-raw) → `serializeNode(span.word)` → child = text node "Hello" → collects
  - child = text node " " → collects
- Result: "[S] Hello " ✓

This should work. Let me verify by building after the changes.

### 8. `src/components/LyricsBuilder.tsx` — Fix `insertSectionTag` (cursor position)

Replace current line-append logic:
```ts
const insertSectionTag = (tagName: string) => {
  const tTag = `[${tagName}]`;
  const currentRaw = serializeEditor(editorRef.current);
  const range = getSelectedCharRange(editorRef.current);
  
  if (range && currentRaw.length > 0) {
    // Find the line containing the cursor
    const lineStart = currentRaw.lastIndexOf('\n', range.start - 1) + 1;
    const lineEnd = currentRaw.indexOf('\n', range.start);
    const lineEndIdx = lineEnd === -1 ? currentRaw.length : lineEnd;
    const lineContent = currentRaw.slice(lineStart, lineEndIdx);
    
    // Split line at cursor position within the line
    const cursorInLine = range.start - lineStart;
    const beforeCursor = lineContent.slice(0, cursorInLine);
    const afterCursor = lineContent.slice(cursorInLine);
    
    // Build new raw: before this line + beforeCursor + \n\n[TAG]\n + afterCursor + rest
    const beforeLine = currentRaw.slice(0, lineStart);
    const afterLine = currentRaw.slice(lineEndIdx);
    // Trim afterCursor leading space if splitting mid-word
    const cleanAfter = afterCursor.trimStart();
    newText = beforeLine + beforeCursor + '\n\n' + tTag + '\n' + cleanAfter + afterLine;
  } else {
    // No cursor or empty — prepend
    newText = tTag + '\n' + currentRaw;
  }
  
  setLyricsText(newText);
};
```

### 9. `src/App.tsx` — Already done

Space key excluded when `isContentEditable`.

---

## Section Tag Painting Immunity (Discussion — June 3)

### Problem
When spree-painting lands on a section tag (e.g. `[Verse 1]`), the voice tag should be applied to the **first real word after the section tag**, not to the tag itself.

### Detection: DOM-based (not raw-text)

`getSelectedCharRange` with `expandWords=true` uses `\S+` as word boundary. Tags can contain spaces (e.g. `[Verse 1]`), so the expanded range may only cover part of the tag — raw-text regex detection (`/^\[.*\]$/`) is unreliable.

**Approach:** Walk up from `sel.anchorNode` to check for a `section-tag` CSS class on the section tag's span element.

```ts
function isSectionTagNode(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node: Node | null = sel.anchorNode;
  while (node && node !== root) {
    if (node instanceof HTMLElement && node.classList.contains('section-tag')) return true;
    node = node.parentNode;
  }
  return false;
}
```

### Redirect: `findNextWord`

Scan raw text forward from the section tag's closing `]`:
- Skip `[...]` brackets (any nested bracket tag)
- Skip whitespace
- Return `{start, end}` of next `\S+` word
- Cross newlines (next word could be on any following line)
- Return `null` if no word found (no-op, paint skipped)

Used by both `paintAtCursor` (normal mode) and `handleEditorPointerUp` (spree mode).

### Rendering change

Add `section-tag` CSS class to section tag span in `renderElement`:
```ts
span.className = 'block section-tag text-[10px] font-bold text-zinc-500 italic tracking-[0.15em] mb-1 mt-2 select-none';
```

Remove `uppercase`. Keep existing `select-none`, `contentEditable="false"`, `data-raw`, and bracket-stripped text (`textContent = el.text.slice(1, -1)`).

### When redirect is triggered

```
handleEditorPointerUp / paintAtCursor:
  └─ getSelectedCharRange(root) → range
  └─ if isSectionTagNode(root):
       ├─ raw = serializeEditor(root)
       ├─ closeBracket = raw.indexOf(']', range.end)
       ├─ if closeBracket === -1 → no-op return
       ├─ nextWord = findNextWord(raw, closeBracket + 1)
       ├─ if nextWord:
       │    └─ applyTagToWord(raw, nextWord.start, nextWord.end, activeTagId, tagColorMap) → newRaw
       │    └─ setLyricsText(newRaw)
       └─ else → no-op (no word found after section tag)
       └─ return (skip normal paint)
```

Note: `range` uses default `expandWords=true`. Even though the expanded range may be incorrect for tagged content, `isSectionTagNode` is the primary detector — the raw position from `range.end` is used as an approximate anchor to find the nearest `]`.

### Section tag editing model (future, not implemented)

- Section tags render as styled `contentEditable="false"` chips by default
- Tag detection: typing `[` + content + `]` on a single line → parser classifies on next render (blur)
- Deleting a bracket → text reverts to normal lyrics, inherits the last active voicing tag
- Tap-to-expand (future): tap a section tag chip to expand it into raw editable text (brackets visible, cursor can land inside). If brackets are deleted, the text inherits the voicing that was active before the section tag
- Cursor key skipping already works natively — `contentEditable="false"` elements are skipped by arrow keys

---

## Implementation Order

1. `lyricsDOM.ts`: add `setEditorRef`, `paintAtCursor`, fix `serializeNode` if needed
2. `TrackBar.tsx`: `handleTagClick` calls `paintAtCursor`, track buttons also paint
3. `LyricsBuilder.tsx`: mount sets editor ref, `onInput` handler, fix `insertSectionTag`
4. Verify `tsc --noEmit` clean

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `onInput` fires on every keystroke, even after re-render | `innerHTML` replacement doesn't fire `input`. Safe. |
| PATH 3 re-render loses cursor after first keystroke | Rare edge case (empty editor + palette tap + first char). User clicks to reposition. Acceptable. |
| `paintAtCursor` serializes before `applyTagToWord` — double serialization cost | Acceptable. Raw text is small (<100KB). |
| Spree mode word-click handler fires on every pointer up | Gated on `isSpreeMode` check. |
| Section tag split loses word if mid-word | `afterCursor.trimStart()` removes leading space from the remainder. Word is cleanly split. |
