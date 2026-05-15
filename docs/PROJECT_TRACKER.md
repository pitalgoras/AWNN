# AWNN Development Project Tracker

## Features & Tasks

- [x] Adaptive Toolbar System
    - [x] State management for 3 proposals (1: Sidebar, 2: Top bar, 3: Compact tray)
    - [x] `L` key cycle (1->2->3->1), `D` key reset to default
    - [x] Responsive label toggling
- [x] Backtrack Energy Visualization (Lyrics Mode)
    - [x] Lightweight SVG/Canvas rendering
    - [x] Normalized 0-1 energy envelope
    - [x] Proper contrast/visibility
- [x] Metronome & UI Audit
    - [x] Compact metronome mute/unmute icon sharing toolbar space
    - [x] UI icon/label consistency
- [x] Raw Audio Engine
    - [x] `getUserMedia` raw capture toggle (defaults to raw)
    - [x] Advanced audio filters settings panel
    - [x] Latency calibration tool
- [x] Settings & Modal Mobile UX
    - [x] Compact settings layout with grid
    - [x] Reduced padding and margins on modals
    - [x] Flow sections horizontally in portrait settings
- [ ] UI Revamp (2026-05-15)
    - [x] Toolbar tier system (`showTier`, toolbarProposal 1/2/3)
    - [x] Elastic track heights (removed max cap, dynamic count)
    - [x] Logo menu unconditional (works in portrait + landscape)
    - [x] Settings in logo menu + tier 3 in landscape toolbar
    - [x] Header auto-height (`min-h-`, measured via ref)
    - [x] Edit Text button: portrait toolbar right area, landscape floating
    - [x] TrackToolbar horizontal sync (`Math.floor`)
    - [x] Tempo & metronome mute closer together
