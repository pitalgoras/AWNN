## ADAPTIVE UI CLARIFICATION ADDITIONS

### Viewport-Anchored Chrome Rule
- **Principle**: The application shall maintain **viewport-anchored chrome** — all non-content UI elements (toolbars, control surfaces, buttons) must remain within the visible viewport boundaries at all times.
- **Content vs. Chrome**: Content regions (lyrics editor, multitrack timeline, audio tracks) may implement independent scrolling to accommodate their full extent, but **no interactive control shall require scrolling to access**.
- **Full Viewport Occupation**: The application view must occupy the full viewport with a clear **chrome/content separation**: fixed-position chrome surfaces and scrollable content regions.
- **Key Technical Terms**:
  - **Viewport-anchored chrome** — UI controls fixed within viewport boundaries
  - **Chrome/content separation** — clear distinction between fixed UI and scrollable content
  - **Always-accessible controls** — no scroll-to-reach interaction elements
  - **Independent content scrolling** — content regions scroll without affecting chrome
- **Implementation Requirement**: All toolbars, sidebars, and control panels must use `fixed`, `sticky`, or flex layout within viewport height (`h-screen`, `h-full`) — never exceed viewport bounds requiring scroll to access controls.

### Label‑Inside‑Button Rule
- **What**: Short tokens (`[S]`, `[A]`, `[T]`, `[B]`, `[S&A]`, `[T&B]`, `[ALL]`, `[Acc]`) are rendered *inside* the colored button or circle, instead of a separate label. This is true for:
  1. Voice palette in `LyricsBuilder` (both landscape & portrait).
  2. Track rows in `TrackToolbar`.
- **Why**: Maximizes vertical space, keeps controls touch‑friendly.
- **Accessibility**: Each button has a **minimum tap target of 44 px height** and the button’s background contrasts the label (calculated via `getContrastColor`).

### Voice Palette Layout (Lyrics Mode)
- **Split into Two Sections**:
  - **Left Section** (`.filter(v => !v.trackId)`): Non‑single voices (`[ALL]`, `[S&A]`, `[T&B]`) — no trackId, **single row**, no mute/record buttons.
    - **Alignment**: Items align to **top** of section, fill available space from top (not vertically centered)
  - **Right Section** (`.filter(v => v.trackId)`): Single voices (`[Acc]`, `[S]`, `[A]`, `[T]`, `[B]`) — **two rows**: voice button → mute & record buttons below.
- **Order**:
  - Left section: `[ALL] [S&A] [T&B]`
  - Right section: `[Acc] [S] [A] [T] [B]` (Accompaniment/Backtrack is **first** in single voices group).
- **Dynamic Width**: Both sections use `flex-1` and wrap internally (`flex-wrap`) as needed.
- **Implementation Status**: Needs implementation in LyricsBuilder.tsx (currently renders all voices in single container without split).

### `[Acc]` (Accompaniment/Backtrack) Button
- **Track ID**: Uses `'1'` (Backtrack track), same color as track ID `'1'` (`#4a5568` gray).
- **Buttons**: Has **mute** button below (since `trackId: '1'` exists), but **NO record** button (Backtrack never recorded).
- **Color**: Matches track color in multitrack mode (`#4a5568`).
- **TODO**: Replace all "Backtrack" references later with "Accompaniment".

### Portrait‑Bottom Placement (Lyrics Mode)
- In portrait small screens (screen size `small` and orientation `portrait`), the entire voice palette toolbar is **hidden from the left sidebar** and **re‑rendered as a horizontal bar fixed at the bottom** of the viewport.
- The bottom bar is `fixed bottom-0 left-0 right-0`, has a `z-50` stack level, and contains:
  - Left section (non‑single voices) with single row.
  - Right section (single voices) with **two rows** (voice button + mute/record below).
- **Single‑Row Fallback Rule**: When there is **insufficient horizontal space** (small portrait), **all controls for one item** (voice button + mute + record) **must share ONE row** side‑by‑side (`flex-row`, `flex-1`), not stacked vertically.
- **Two‑Row Rule**: When there is adequate space, use two rows: voice button on top, mute/record below.

### Fixed/Scaled Toggle in Anchoring Stripe
- The toggle button (`“Fixed” / “Scaled”`) is **removed from the top toolbar**.
- Instead it is inserted **at the bottom** of the anchoring stripe (`w-8 md:w-10 …` area between energy stripes and lyrics text area).
- It is **hidden when the user is in Edit mode** (`isEditMode` is true).
- The button inherits the same styling as the one that used to live in the left toolbar: **shorter** (`p-0.5 px-1 rounded text-[8px]`).

### Lock/Unlock Buttons in Top Toolbar
- The movement lock and envelope lock controls are **visible only when `appMode === 'mixer'`.** In `Lyrics` mode they are omitted entirely.
- The rendering condition is implemented in `App.tsx` and only adds a `div` containing the lock buttons if `appMode === 'mixer'`.

### Miscellaneous UI Adaptations
- **Button sizing via `useToolbarContext.screenSize`**: All buttons use per-component logic to set sizes:
  - `small` (portrait): `min-h-[36px] min-w-[36px] p-1 text-[9px]` (square for icons, rectangular for text)
  - `medium`: `min-h-[44px] min-w-[44px] p-1.5 text-[10px]`
  - `large`: `min-h-[52px] min-w-[52px] p-2 text-xs`
- **Icon sizes**: Scale with button (small=12px, medium=14px, large=16px)
- **Configurable**: Values stored in Zustand store (`smallBtnSize`, `mediumBtnSize`, `largeBtnSize` with defaults 36/44/52), editable in Advanced Settings
- **Button shape**: Square for icon-only (voice buttons with `[]` label, transport, Mute/Record), rectangular for text buttons ("Pre-roll", "Metro", etc.)
- **Current Status**:
  - `LyricsBuilder.tsx`: Has hardcoded values (needs update to use store values)
  - `TrackToolbar.tsx`: Has hardcoded values (needs update to use store values)
  - `App.tsx`: Has responsive classes (needs update to use store values)
  - `AudioEditorView.tsx`: Has responsive classes (needs update to use store values)
  - `LyricsBuilderView.tsx`: Has responsive classes (needs update to use store values)
- Contrast of button text versus background is automatically calculated using a simple luminance check (`getContrastColor`).
- **Floating "Edit Text" button**: When **NOT** in edit mode, a floating button appears at **top‑left** (`fixed top-4 left-4`).
- **Floating "Done" button**: When **IN** edit mode, a floating button appears at **top‑left** (`fixed top-4 left-4`).
- No additional components were added; all changes modify existing files in place.

---

## 12. Voicing Palette Flow Criteria (ADDED)

### Layout Principle
- **Maximize horizontal space**: Buttons stretch to fill available width (`flex-1` or `w-full`)
- **Minimize toolbar height**: Use compact padding (`p-1` not `p-2`), small gaps (`gap-1`), and avoid unnecessary vertical elements.
- **Portrait small screens**: Voice palette fixed at bottom, **dynamic rows** (single row if no space, two rows if space allows).

### Correct Flow Implementation
| Mode | Toolbar Position | Button Layout | Height Strategy |
|------|------------------|----------------|---------------|
| **Landscape / Desktop** | Left sidebar (256px wide) | Two rows: colored button full width, mute/record below | Compact vertical, `p-1`, `gap-1` |
| **Portrait (small screens)** | Fixed bottom bar | **Dynamic**: single row if no space, two rows if space allows | Minimal height: `p-1`, auto-height |

### Button Sizing Rules
- **Minimum tap target**: 44px height/width (accessibility)
- **Label inside button**: Short token (`[S]`, `[A]`, etc.) rendered inside colored circle/button
- **Contrast**: Text color automatically calculated via `getContrastColor()` for readability.

### Single‑Row Fallback Rule
- **When vertical space is limited** (portrait small):
  - **Voice buttons WITH trackId** ([Acc], [S], [A], [T], [B]): All buttons for one voice (voice + mute + record) **must be on the SAME row** side‑by‑side (`flex-row`, `flex-1`).
  - **Voice buttons WITHOUT trackId** ([ALL], [S&A], [T&B]): Single row only.
- **When vertical space is adequate** (landscape/desktop):
  - Two rows: voice button row (full width), mute/record row below.

### Specific Implementation Details
- **`[Acc]` button**:
  - Color: `#4a5568` (same as Backtrack track ID '1')
  - Has mute button below (trackId exists), **NO record button**
  - Label: `[Acc]` inside button
- **Left/Right split**:
  - Left: `.filter(v => !v.trackId)` → `[ALL] [S&A] [T&B]`
  - Right: `.filter(v => v.trackId)` → `[Acc] [S] [A] [T] [B]`
  - Both sections: `flex-1 flex-wrap`
- **Anchoring stripe**: Extended to **full height** (`h-full` on parent)
- **Fixed/Scaled toggle**: Made **shorter** (`p-0.5 px-1 rounded text-[8px]`)

---

**End of Specification**
