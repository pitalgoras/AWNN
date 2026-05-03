# Adaptive UI Modules - Technical Documentation

## Overview

The adaptive UI system dynamically adjusts toolbar layouts, label abbreviations, and element visibility based on:
- **Screen size** (CSS pixel breakpoints): Small (<768px), Medium (768-1280px), Large (>1280px)
- **Orientation**: Portrait or Landscape
- **Available space**: Per-item width for horizontal toolbars, total width for vertical toolbars

## Viewport-Anchored Chrome Rule

The application shall maintain **viewport-anchored chrome** — all non-content UI elements (toolbars, control surfaces, buttons) must remain within the visible viewport boundaries at all times.

- **Content vs. Chrome**: Content regions (lyrics editor, multitrack timeline, audio tracks) may implement independent scrolling to accommodate their full extent, but **no interactive control shall require scrolling to access**.
- **Full Viewport Occupation**: The application view must occupy the full viewport with a clear **chrome/content separation**: fixed-position chrome surfaces and scrollable content regions.
- **Key Technical Terms**:
  - **Viewport-anchored chrome** — UI controls fixed within viewport boundaries
  - **Chrome/content separation** — clear distinction between fixed UI and scrollable content
  - **Always-accessible controls** — no scroll-to-reach interaction elements
  - **Independent content scrolling** — content regions scroll without affecting chrome
- **Implementation Requirement**: All toolbars, sidebars, and control panels must use `fixed`, `sticky`, or flex layout within viewport height (`h-screen`, `h-full`) — never exceed viewport bounds requiring scroll to access controls.

---

## Module1: `useToolbarContext.ts`

### Purpose
Detect screen size (CSS pixel breakpoints), orientation, and toolbar type.

### Key Implementation Details
```typescript
// CSS pixel breakpoints (replaces inch-based calculations)
const SMALL_SCREEN_PX = 768;   // < 768px = small
const MEDIUM_SCREEN_PX = 1280; // 768-1280px = medium

// Types
export type ScreenSize = 'small' | 'medium' | 'large';
export type Orientation = 'portrait' | 'landscape';
export type ToolbarType = 'horizontal' | 'vertical';

// Return value
interface ToolbarContextValue {
  screenSize: ScreenSize;      // 'small', 'medium', 'large'
  orientation: Orientation;    // 'portrait' | 'landscape'
  toolbarType: ToolbarType;    // 'horizontal' | 'vertical'
  isPortrait: boolean;
  isLandscape: boolean;
}
```

### How it works
1. Uses `window.innerWidth` to get viewport width in CSS pixels
2. Uses `window.matchMedia('(orientation: portrait)')` to detect orientation
3. Returns `getScreenSize(widthPx)`:
   - `< 768px` → `'small'`
   - `<= 1280px` → `'medium'`
   - `> 1280px` → `'large'`
4. Listens to `resize` and `orientationchange` events to update reactively

### Usage
```typescript
const context = useToolbarContext('horizontal');  // or 'vertical'
// context.screenSize → 'small' | 'medium' | 'large'
// context.isPortrait → true | false
```

### Per-Component Logic Requirement
**All components importing `useToolbarContext` MUST use the return values** to drive UI decisions:

1. **Button Sizing**: Use `screenSize` to set button sizes (stored in Zustand store, editable in Advanced Settings):
   ```tsx
   const { smallBtnSize, mediumBtnSize, largeBtnSize } = useStore();
   const btnClassBase = screenSize === 'small' 
     ? `min-h-[${smallBtnSize}px] p-1 text-[9px]` 
     : screenSize === 'medium' 
     ? `min-h-[${mediumBtnSize}px] p-1.5 text-[10px]` 
     : `min-h-[${largeBtnSize}px] p-2 text-xs`;
   const getBtnClass = (isSquare = false) => cn(btnClassBase, isSquare ? 'aspect-square' : '');
   ```

2. **Special Palette Button Sizing**: Voice palette buttons use fixed small sizes (no min-w constraints):
   ```tsx
   const paletteBtnSize = screenSize === 'small' ? 'h-8 w-8 min-h-0 text-[9px]' : 'h-10 w-10 min-h-0 text-[10px]';
   ```

3. **Padding & Text**: Scale proportionally with button size:
   | screenSize | Button Size | Padding | Text Size | Icon Size |
   |------------|-------------|---------|-----------|-----------|
   | small      | 36px (default) | p-1     | text-[9px] | size={12} |
   | medium     | 44px (default) | p-1.5   | text-[10px] | size={14} |
   | large      | 52px (default) | p-2     | text-xs   | size={16} |

4. **Button Shape Rules**:
   - **Square (aspect-square)**: Voice buttons (short `[]` label), Transport buttons, Mute/Record buttons
   - **Rectangular**: Text buttons ("Pre-roll", "Metro", "Cues", "Settings", etc.) - must fit text
   - **No min-w constraints**: Buttons may shrink to fit available space

5. **Text Sizing**: Use `screenSize` for label text:
   ```tsx
   const textSizeClass = screenSize === 'small' ? 'text-[9px]' 
                       : screenSize === 'medium' ? 'text-[10px]' 
                       : 'text-xs';
   ```

### Configurable Button Sizes (Advanced Settings)
- Values stored in Zustand store: `smallBtnSize` (default 36), `mediumBtnSize` (default 44), `largeBtnSize` (default 52)
- Setter functions: `setSmallBtnSize`, `setMediumBtnSize`, `setLargeBtnSize`
- Editable via Advanced Settings page
- Changes apply immediately via `useToolbarContext` per-component logic

### Components Required to Use `useToolbarContext`
| Component | Path | Status |
|-----------|------|--------|
| `App.tsx` | `src/App.tsx` | ✅ Implemented - `getBtnClass()` pattern, 3-area header for small portrait |
| `TrackToolbar.tsx` | `src/components/TrackToolbar.tsx` | ✅ Implemented - uses `screenSize` from `useToolbarContext('vertical')` |
| `AudioEditorView.tsx` | `src/components/AudioEditorView.tsx` | ✅ Implemented - `getSidebarBtnClass()` with store values |
| `LyricsBuilderView.tsx` | `src/components/LyricsBuilderView.tsx` | ✅ Implemented - `getLyricsBtnClass()` with store values |
| `LyricsBuilder.tsx` | `src/components/LyricsBuilder.tsx` | ✅ Implemented - voice palette split, `getBtnClass()` pattern |

---

## Module 2: `useAdaptiveLabels.ts`

### Purpose
Automatically abbreviate labels when space is constrained using ResizeObserver.

### Key Implementation Details
```typescript
// CSS pixel thresholds (replaces inch-based calculations)
const VERTICAL_ABBREVIATION_THRESHOLD_PX = 50;  // Vertical toolbar width < 50px → abbreviate
const HORIZONTAL_ITEM_THRESHOLD_PX = 30;         // Horizontal toolbar per-item width < 30px → abbreviate

interface UseAdaptiveLabelsReturn {
  isAbbreviated: boolean;
  getLabel: (full: string, abbreviated: string) => string;
}

export function useAdaptiveLabels(
  toolbarRef: React.RefObject<HTMLElement>,
  toolbarType: ToolbarType,
  itemCount: number
): UseAdaptiveLabelsReturn
```

### How it works
1. **Vertical toolbar**: Measures `el.offsetWidth` → if `< 50px` → `isAbbreviated = true`
2. **Horizontal toolbar**: Measures `el.offsetWidth`, calculates `availableWidthPerItem = (totalWidth - (itemCount-1) * gap) / itemCount` → if `< 30px` → `isAbbreviated = true`
3. Uses `ResizeObserver` to re-check on container size changes
4. `getLabel(full, abbreviated)` returns `abbreviated` if `isAbbreviated`, else `full`

### CRITICAL: Must Call `getLabel()` for All Labels
**All components importing `useAdaptiveLabels` MUST use `getLabel()`** for every visible label:

```tsx
// App.tsx example
<span>{mainToolbarLabel('Pre-roll', 'Pre')}</span>
<span>{mainToolbarLabel('Cues', 'Cues')}</span>
<span>{mainToolbarLabel('Settings', 'Set')}</span>

// TrackToolbar example  
<span>{getLabel('Mute', 'M')}</span>
<span>{getLabel('Record', 'R')}</span>

// LyricsBuilderView example
<span>{lyricsLabel('Edit Text', 'Edit')}</span>
```

### Usage
```typescript
const { isAbbreviated, getLabel } = useAdaptiveLabels(ref, 'horizontal', 15);

// In JSX:
<span>{getLabel('Tempo', 'BPM')}</span>
{!isAbbreviated && <span>Full label text</span>}
```

### How it works
1. Calculates `window.innerWidth / PIXELS_PER_INCH` to get screen width in inches
2. Uses `window.matchMedia('(orientation: portrait)')` to detect orientation
3. Returns `getScreenSize(inches)`:
   - `< 6.7"` → `'small'`
   - `<= 10.7"` → `'medium'`
   - `> 10.7"` → `'large'`
4. Listens to `resize` and `orientationchange` events to update reactively

### Usage
```typescript
const context = useToolbarContext('horizontal');  // or 'vertical'
// context.screenSize → 'small' | 'medium' | 'large'
// context.isPortrait → true | false
// context.screenWidthInches → number (e.g., 13.3)
```

### Per-Component Logic Requirement
**All components importing `useToolbarContext` MUST use the return values** to drive UI decisions:

1. **Button Sizing**: Use `screenSize` to set minimum tap targets (stored in Zustand store, editable in Advanced Settings):
    ```tsx
    const { smallBtnSize, mediumBtnSize, largeBtnSize } = useStore();
    const btnSize = screenSize === 'small' ? smallBtnSize : screenSize === 'medium' ? mediumBtnSize : largeBtnSize;
    const btnSizeClass = `min-h-[${btnSize}px] min-w-[${btnSize}px]`;
    ```

2. **Padding & Text**: Scale proportionally with button size:
    | screenSize | Button Size | Padding | Text Size | Icon Size |
    |------------|-------------|---------|-----------|-----------|
    | small      | 36px (default) | p-1     | text-[9px] | size={12} |
    | medium     | 44px (default) | p-1.5   | text-[10px] | size={14} |
    | large      | 52px (default) | p-2     | text-xs   | size={16} |

3. **Button Shape Rules**:
   - **Square (aspect-square)**: Voice buttons (short `[]` label), Transport buttons, Mute/Record buttons
   - **Rectangular**: Text buttons ("Pre-roll", "Metro", "Cues", "Settings", etc.) - must fit text

4. **Text Sizing**: Use `screenSize` for label text:
    ```tsx
    const textSizeClass = screenSize === 'small' ? 'text-[9px]' 
                        : screenSize === 'medium' ? 'text-[10px]' 
                        : 'text-xs';
    ```

### Configurable Button Sizes (Advanced Settings)
- Values stored in Zustand store: `smallBtnSize` (default 36), `mediumBtnSize` (default 44), `largeBtnSize` (default 52)
- Setter functions: `setSmallBtnSize`, `setMediumBtnSize`, `setLargeBtnSize`
- Editable via Advanced Settings page
- Changes apply immediately via `useToolbarContext` per-component logic

### Components Required to Use `useToolbarContext`
| Component | Path | Status |
|-----------|------|--------|
| `App.tsx` | `src/App.tsx` | ✅ Implemented - `getBtnClass()` pattern, 3-area header for small portrait |
| `TrackToolbar.tsx` | `src/components/TrackToolbar.tsx` | ✅ Implemented - `getToolbarBtnClass()` with store values |
| `AudioEditorView.tsx` | `src/components/AudioEditorView.tsx` | ✅ Implemented - `getSidebarBtnClass()` with store values |
| `LyricsBuilderView.tsx` | `src/components/LyricsBuilderView.tsx` | ✅ Implemented - `getLyricsBtnClass()` with store values |
| `LyricsBuilder.tsx` | `src/components/LyricsBuilder.tsx` | ✅ Implemented - voice palette left/right split, `getBtnClass()` pattern |

---

## Module 2: `useAdaptiveLabels.ts`

### Purpose
Automatically abbreviate labels when space is constrained using ResizeObserver.

### Key Implementation Details
```typescript
const ABBREVIATION_THRESHOLD_INCHES = 0.8;  // Trigger abbreviation below 0.8"

interface UseAdaptiveLabelsReturn {
  isAbbreviated: boolean;
  getLabel: (full: string, abbreviated: string) => string;
}

export function useAdaptiveLabels(
  toolbarRef: React.RefObject<HTMLElement>,
  toolbarType: ToolbarType,
  itemCount: number
): UseAdaptiveLabelsReturn
```

### How it works
1. **Vertical toolbar**: Measures `el.offsetWidth / 96` → if `< 0.8"` → `isAbbreviated = true`
2. **Horizontal toolbar**: Measures `el.offsetWidth`, calculates `availableWidthPerItem = (totalWidth - (itemCount-1) * gap) / itemCount`, converts to inches → if `< 0.8"` → `isAbbreviated = true`
3. Uses `ResizeObserver` to re-check on container size changes
4. `getLabel(full, abbreviated)` returns `abbreviated` if `isAbbreviated`, else `full`

### CRITICAL: Must Call `getLabel()` for All Labels
**All components importing `useAdaptiveLabels` MUST use `getLabel()`** for every visible label:

```tsx
// App.tsx example
<span>{mainToolbarLabel('Pre-roll', 'Pre')}</span>
<span>{mainToolbarLabel('Cues', 'Cues')}</span>
<span>{mainToolbarLabel('Settings', 'Set')}</span>

// TrackToolbar example  
<span>{getLabel('Mute', 'M')}</span>
<span>{getLabel('Record', 'R')}</span>

// LyricsBuilderView example
<span>{lyricsLabel('Edit Text', 'Edit')}</span>
```

### Usage
```typescript
const { isAbbreviated, getLabel } = useAdaptiveLabels(ref, 'horizontal', 15);

// In JSX:
<span>{getLabel('Tempo', 'BPM')}</span>
{!isAbbreviated && <span>Full label text</span>}
```

---

## Module 3: `MoreIconDropdown.tsx`

### Purpose
Overflow dropdown ("+" icon) for items that don't fit in the toolbar.

### Props
```typescript
interface MoreIconDropdownProps {
  toolbarType: ToolbarType;  // 'horizontal' | 'vertical'
  children: React.ReactNode;    // Overflow items
  className?: string;
}
```

### How it works
1. Renders a "+" button (via `Plus` icon from lucide-react)
2. Clicking toggles dropdown visibility
3. **Vertical toolbar**: Dropdown appears to the **right** (`left-full top-0 ml-1`)
4. **Horizontal toolbar**: Dropdown appears **below** (`top-full left-0 mt-1`)
5. Clicking outside closes the dropdown (via `mousedown` event listener)
6. Children are the overflow items

### Usage
```tsx
<MoreIconDropdown toolbarType="horizontal">
  <button>Pre-roll</button>
  <button>Zoom</button>
</MoreIconDropdown>
```

---

## Module 4: Lyrics/Multitrack Toggle (`App.tsx`)

### Purpose
Switch between multitrack workspace (audio editing) and lyrics builder view.

### How it works

#### 1. Store State (`src/store/useStore.ts`)
```typescript
interface AppState {
  appMode: 'mixer' | 'lyrics';  // ← NOTE: 'mixer' NOT 'multitrack'!
  setAppMode: (mode: 'mixer' | 'lyrics') => void;
}

// Default
appMode: 'mixer' as const,
```

#### 2. Toggle Button (in header, Tier 1 - always visible)
```tsx
<button
  onClick={() => setAppMode(appMode === 'mixer' ? 'lyrics' : 'mixer')}
  title={appMode === 'mixer' ? "Switch to Lyrics Mode" : "Switch to Multitrack Mode"}
>
  {appMode === 'mixer' ? (
    <><FileText size={14} /> Lyrics</>
  ) : (
    <><Mic size={14} /> Multitrack</>
  )}
</button>
```

#### 3. Conditional Rendering (KEY INSIGHT: Keep engine alive!)
```tsx
<main className="flex-1 flex overflow-hidden relative">
  
  {/* Lyrics mode: Render on top with z-index */}
  {appMode === 'lyrics' && (
    <div className="absolute inset-0 z-[100] bg-zinc-950">
      <LyricsBuilder />
    </div>
  )}
  
  {/* Multitrack: ALWAYS render (engine stays alive), hide with CSS if in lyrics mode */}
  <div className={cn(
    "flex-1 flex flex-col overflow-hidden",
    appMode === 'lyrics' && "opacity-0 pointer-events-none"  // Hide visually, keep running
  )}>
    <TrackToolbar handlers={{...}} />  {/* Left sidebar */}
    <section>...</section>  {/* Waveforms */}
  </div>
</main>
```

**Critical:** The multitrack workspace is **always rendered** (so the audio engine is never destroyed/recreated). In lyrics mode, it's hidden with `opacity-0 pointer-events-none` but still running in the background.

#### 4. Components
- **`TrackToolbar.tsx`**: Handles left sidebar track controls (imported in `App.tsx`)
- **`LyricsBuilder.tsx`**: Lyrics editing view (imported in `App.tsx`)

---

## TrackToolbar Special Rules

### Single-Row Layout
- Triggered when `trackHeight < 80px` (not screen size)
- Label + Mute/Record buttons side-by-side in one row
- Two rows otherwise (label row, M/R row below)

### Left-Edge Positioning
- Fixed to left viewport edge (`left-0`)
- Scrolls independently of content
- Never exceeds viewport bounds

### Lock/Unlock Buttons
- Visible **only** when `appMode === 'mixer'`
- Hidden in lyrics mode

---

## Priority Tier System

### Tier1: Always Visible
- Move Lock, Envelope Lock, Lyrics/Multitrack Toggle
- Never hidden, regardless of screen size

### Tier2: Visibility by Screen Size + Orientation
- Pre-roll, Cues toggle, Settings
- **Small portrait**: Moved to 3-area header layout (see below), distributed by usability
- **Medium/large, landscape**: Visible in main toolbar row via `sm:flex`

### Tier3: Large Screens Only
- Zoom slider
- Visible only on `lg:` (≥1024px)
- On smaller screens: overflow to `MoreIconDropdown`

### Small Portrait Header Layout (3-Area Design)
When `screenSize === 'small' && isPortrait`:
- **Header becomes 2 rows** with 3 areas:
  - **Left area**: 2 rows of items (Tier 2 + other items by usability)
  - **Center area**: Transport controls (Play, FF, Rewind) spanning **full 2-row height**, made **bigger** (min-h-[44px] or larger)
  - **Right area**: 2 rows of items (Tier 2 + other items by usability)
- Items distributed by **usability criteria**, NOT by Tier

### Implementation Pattern
```tsx
// Check for small portrait
const isSmallPortrait = screenSize === 'small' && isPortrait;

// Conditional rendering
{isSmallPortrait ? (
  // 3-area layout: left (2 rows) | center (transport, 2 rows tall) | right (2 rows)
  <div className="flex items-stretch">
    <div className="flex flex-col justify-between">{/* Left items */}</div>
    <div className="flex items-center">{/* Transport - bigger, centered */}</div>
    <div className="flex flex-col justify-between">{/* Right items */}</div>
  </div>
) : (
  // Normal single-row layout
  <div className="flex items-center gap-1">
    {/* Tier2 items with hidden sm:flex */}
  </div>
)}
```

---

## Voice Palette Layout (Lyrics Mode)

### Sidebar Layout (Landscape/Desktop)
- **Left Section** (`.filter(v => !v.trackId)`): Non-single voices (`[ALL]`, `[S&A]`, `[T&B]`) — single column, no mute/record
- **Right Section** (`.filter(v => v.trackId)`): Single voices (`[Acc]`, `[S]`, `[A]`, `[T]`, `[B]`) — two rows (voice button → M/R below)

### Bottom Bar Layout (Portrait Small)
- Single voices form **vertical columns** (voice button + M/R below each)
- Multiple-voicing buttons (`[ALL]`, `[S&A]`, `[T&B]`) flow to the **right** in a row
- No single-row fallback — always columns for single voices

### Button Sizing
- **Palette buttons**: Fixed small size (`h-8 w-8` small, `h-10 w-10` medium+)
- **M/R buttons**: Compact size (`h-6 px-2` small, `h-7 px-2` medium+)
- No min-w constraints — buttons shrink to fit

---

## File Locations

| Module | Path |
|--------|------|
| `useToolbarContext.ts` | `src/hooks/useToolbarContext.ts` |
| `useAdaptiveLabels.ts` | `src/hooks/useAdaptiveLabels.ts` |
| `MoreIconDropdown.tsx` | `src/components/MoreIconDropdown.tsx` |
| `LyricsBuilder.tsx` | `src/components/LyricsBuilder.tsx` |
| `TrackToolbar.tsx` | `src/components/TrackToolbar.tsx` |
| Store (appMode) | `src/store/useStore.ts` |
| Main App | `src/App.tsx` |

---

## Common Pitfalls

1. **Mode strings**: Use `'mixer'` and `'lyrics'` (NOT `'multitrack'`)
2. **Keep engine alive**: Always render multitrack, hide with CSS `opacity-0 pointer-events-none`
3. **Tailwind v4**: Uses `@import "tailwindcss"` (NOT `@tailwind base/components/utilities`)
4. **Build errors**: If `npx vite build` fails with PostCSS errors, restore `index.css` from zip and ensure correct Tailwind version
5. **ResizeObserver**: Must observe the toolbar container element, not individual items
6. **No inch calculations**: All screen size detection uses CSS pixel breakpoints (768px, 1280px)
7. **No min-w constraints**: Buttons may shrink to fit available space

---

## Testing Checklist

1. [ ] Toggle button switches between mixer (multitrack) and lyrics modes
2. [ ] Multitrack mode initializes audio engine (no infinite "Initializing Engine" spinner)
3. [ ] Lyrics mode shows `LyricsBuilder` component
4. [ ] Labels abbreviate at <50px vertical width or <30px horizontal per-item width
5. [x] Tier2 items hide on small screens (<768px width)
6. [x] Tier3 items hide below 1024px width
7. [x] `MoreIconDropdown` shows overflow items on small screens
8. [x] Build passes: `npx vite build`
9. [x] **`useToolbarContext` per-component**: App.tsx uses `getBtnClass()` pattern
10. [x] **`useToolbarContext` per-component**: TrackToolbar.tsx uses `screenSize` from `useToolbarContext('vertical')`
11. [x] **`useToolbarContext` per-component**: AudioEditorView.tsx uses `getSidebarBtnClass()` with store values
12. [x] **`useToolbarContext` per-component**: LyricsBuilderView.tsx uses `getLyricsBtnClass()` with store values
13. [x] Button sizes respond to `screenSize`: small=36px, medium=44px, large=52px (configurable in Advanced Settings)
14. [x] TrackToolbar single-row when `trackHeight < 80px`
15. [x] Voice palette bottom bar: single voices as columns, multiple-voicing buttons to the right
16. [x] No min-w constraints on buttons

---

## Recent Implementation Summary (2026-05-03)

### Completed Changes
1. **Store (useStore.ts)**: Added `smallBtnSize` (36), `mediumBtnSize` (44), `largeBtnSize` (52) + setters
2. **App.tsx**: 
   - Implemented `getBtnClass(isSquare)` pattern
   - 3-area header layout for small portrait (left/center/right)
   - Lock/Unlock buttons conditioned on `appMode === 'mixer'`
   - Added button size configuration UI to Advanced Settings
   - Removed `toolbarProposal` cycling and related state
3. **TrackToolbar.tsx**: 
   - Fixed missing `screenSize` from `useToolbarContext('vertical')`
   - Single-row layout based on `trackHeight < 80px`
   - Left-edge positioning (`left-0`)
4. **AudioEditorView.tsx**: Removed `min-w` constraints from buttons
5. **LyricsBuilderView.tsx**: Removed `min-w` constraints from buttons
6. **LyricsBuilder.tsx**:
   - Voice palette left/right split (non-single left, single right)
   - Bottom bar layout: single voices as vertical columns, multiple-voicing buttons flow right
   - Added `paletteBtnSize` (fixed small buttons) and `smallBtnClass` (compact M/R)
   - Removed `min-w` constraints
7. **useToolbarContext.ts**: Simplified to CSS pixel breakpoints (<768px small, 768-1280px medium, >1280px large)
8. **useAdaptiveLabels.ts**: Replaced inch-based calculations with CSS pixel thresholds (50px vertical, 30px horizontal per-item)

### Build Status
- ✅ Build passes: `npx vite build` (~1772 modules, ~492-494 kB JS)
- ✅ All inch-based calculations removed
- ✅ No `toolbarProposal` references remain
- ✅ No `min-w` constraints on buttons
