# Adaptive UI Modules - Technical Documentation

## Overview

The adaptive UI system dynamically adjusts toolbar layouts, label abbreviations, and element visibility based on:
- **Screen size** (inch-based): Small (<6.7"), Medium (6.7-10.7"), Large (>10.7")
- **Orientation**: Portrait or Landscape
- **Available space**: Per-item width for horizontal toolbars, total width for vertical toolbars
- **Priority Tiers**: Tier1 (always visible), Tier 2 (md+/landscape sm), Tier 3 (large only)

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

## Module 1: `useToolbarContext.ts`

### Purpose
Detect screen size (inch-based), orientation, and toolbar type.

### Key Implementation Details
```typescript
// Constants
const PIXELS_PER_INCH = 96;  // CSS pixels per inch
const SMALL_SCREEN_INCHES = 6.7;
const MEDIUM_SCREEN_INCHES = 10.7;

// Types
export type ScreenSize = 'small' | 'medium' | 'large';
export type Orientation = 'portrait' | 'landscape';
export type ToolbarType = 'horizontal' | 'vertical';

// Return value
interface ToolbarContextValue {
  screenSize: ScreenSize;      // 'small', 'medium', 'large'
  orientation: Orientation;    // 'portrait' | 'landscape'
  toolbarType: ToolbarType;  // 'horizontal' | 'vertical'
  isPortrait: boolean;
  isLandscape: boolean;
  screenWidthInches: number;
}
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
Overflow dropdown ("+" icon) for Tier 2/3 items that don't fit in the toolbar.

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
6. Children are the overflow items (Tier 2/3 buttons)

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

### How it works (from original `awnn0.9.1.zip`)

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

## Priority Tier System

### Tier 1: Always Visible
- Move Lock, Envelope Lock, Lyrics/Multitrack Toggle
- Never hidden, regardless of screen size

### Tier 2: Visibility by Screen Size + Orientation
- Pre-roll, Cues toggle, Settings
- **Small portrait**: Moved to 3-area header layout (see below), distributed by usability
- **Medium/large, landscape**: Visible in main toolbar row via `sm:flex`

### Tier 3: Large Screens Only
- Zoom slider
- Visible only on `lg:` (≥1024px)
- On smaller screens: overflow to `MoreIconDropdown`

### Small Portrait Header Layout (3-Area Design)
When `screenSize === 'small' && isPortrait`:
- **Header becomes 2 rows** with 3 areas:
  - **Left area**: 2 rows of items (Tier 2 + other items by usability)
  - **Center area**: Transport controls (Play, FF, Rewind) spanning **full 2-row height**, made **bigger** (min-h-[44px] min-w-[44px] or larger)
  - **Right area**: 2 rows of items (Tier 2 + other items by usability)
- Items distributed by **usability criteria**, NOT by Tier
- Order adjusted manually per usability (not automated tier logic)

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
    {/* Tier 2 items with hidden sm:flex */}
  </div>
)}
```

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

---

## Testing Checklist

1. [ ] Toggle button switches between mixer (multitrack) and lyrics modes
2. [ ] Multitrack mode initializes audio engine (no infinite "Initializing Engine" spinner)
3. [ ] Lyrics mode shows `LyricsBuilder` component
4. [ ] Labels abbreviate at <0.8" width threshold (use browser DevTools to simulate)
5. [x] Tier 2 items hide on small screens (<640px width)
6. [x] Tier 3 items hide below 1024px width
7. [x] `MoreIconDropdown` shows overflow items on small screens
8. [x] Build passes: `npx vite build`
9. [x] **`useToolbarContext` per-component**: App.tsx uses `mainToolbarContext` for btn/text sizing
10. [x] **`useToolbarContext` per-component**: TrackToolbar.tsx uses `toolbarContext` for btn/text sizing
11. [x] **`useToolbarContext` per-component**: AudioEditorView.tsx uses `leftSidebarContext` for btn/text sizing
12. [x] **`useToolbarContext` per-component**: LyricsBuilderView.tsx uses `lyricsContext` for btn/text sizing
13. [x] Button sizes respond to `screenSize`: small=36px, medium=44px, large=52px (configurable in Advanced Settings)

---

## Recent Implementation Summary (2026-04-30)

### Completed Changes
1. **Store (useStore.ts)**: Added `smallBtnSize` (36), `mediumBtnSize` (44), `largeBtnSize` (52) + setters
2. **App.tsx**: 
   - Implemented `getBtnClass(isSquare)` pattern
   - 3-area header layout for small portrait (left/center/right)
   - Lock/Unlock buttons conditioned on `appMode === 'mixer'`
   - Added button size configuration UI to Advanced Settings
3. **TrackToolbar.tsx**: Implemented `getToolbarBtnClass()` with store values
4. **AudioEditorView.tsx**: Implemented `getSidebarBtnClass()` with store values
5. **LyricsBuilderView.tsx**: Implemented `getLyricsBtnClass()` with store values
6. **LyricsBuilder.tsx**:
   - Voice palette left/right split (non-single left, single right)
   - Top-aligned non-single voices
   - Added `getBtnClass()` pattern with `useToolbarContext('vertical')`
   - Added `useAdaptiveLabels` hook and `getLabel()` calls
   - Added missing "Edit Text" floating button
   - Updated Fixed/Scaled toggle (shortened: p-0.5 px-1 text-[8px])
   - All buttons use responsive sizing from store

### Build Status
- ✅ Build passes: `npx vite build` (~1772 modules, ~492 kB JS)
