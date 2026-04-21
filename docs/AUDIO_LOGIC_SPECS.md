# Audio Engine & Interaction Specifications

This document outlines the comprehensive logic, edge cases, and user experience decisions for the multitrack audio engine.

## 1. Global Locks & Interaction Modes
To prevent accidental destructive edits during playback and mixing, the application utilizes global lock toggles in the main toolbar:
*   **Clip Movement Lock (Padlock):** Disabled by default. When locked, clicking and dragging on the tracks scrolls the view. When unlocked, users can click and drag clips to reposition them on the timeline.
*   **Envelope Lock:** Disabled by default. Prevents accidental modification of volume automation nodes. When unlocked, the track expands to provide a larger canvas for automation editing.

## 2. Envelope Automation Logic
*   **Interpolation:** Volume is calculated using linear interpolation between nodes.
*   **Hold Values:** Before the first node and after the last node, the volume level is held constant at the value of that node. This is visually represented by dashed lines in the editor.
*   **Relative Volume:** Envelope values (0.0 to 1.0) act as a multiplier for the track's base volume slider.
*   **Clip Sync:** When a clip is moved on the timeline, any envelope nodes located within that clip's time range are automatically shifted by the same amount to maintain synchronization between audio and automation.
*   **Drag-to-Delete:** Nodes can be deleted by dragging them vertically far outside (60px+) the track boundaries.

## 3. Recording, Pre-roll & Tempo Logic
*   **Pre-roll (Count-in) Behavior:**
    *   **When stopped:** A 1-bar pre-roll is applied to recordings if the `preRollMode` is set to 'always' or 'recording'. The engine begins recording 1 bar earlier, and this pre-roll portion is "hard trimmed" upon stopping, ensuring the final clip starts exactly at the intended punch-in time. If `preRollMode` is 'none', recording starts immediately without a count-in.
    *   **When already playing:** If the user presses record while playback is already active, recording starts immediately at the current playhead position without any count-in, regardless of the `preRollMode` setting. This allows for seamless "punch-in" recording during playback without interrupting the flow.
*   **User Time vs. Real Time:** The project "Real Time" starts at -1 bar (Bar 0), but "User Time" 0:0:0 corresponds to Bar 1 (labeled "1.1"). All phrase `startPosition` values are stored relative to User Time 0.
*   **Tempo Control (BpmInput):**
    *   **Interaction:** Supports direct typing (3-digit), vertical scrubbing (drag-to-change), and arrow keys (Up/Down).
    *   **Responsiveness:** The UI prioritizes input responsiveness. Metronome regeneration is debounced (500ms) to prevent audio processing from interrupting the user's input flow.
    *   **State Sync:** Uses a `key={bpm}` prop on the `BpmInput` component to force re-initialization from global state, preventing infinite render loops while ensuring the local input is always accurate.
*   **Metronome Settings:**
    *   **Specialized Modal:** A dedicated modal for BPM, Time Signature, and Metronome Volume.
    *   **Track Isolation:** The metronome track does not trigger the standard "Track Settings" modal, maintaining its specialized nature.
*   **Timeline Grid Performance:**
    *   **Virtualization:** The grid only renders beat/bar lines that are currently visible in the viewport, maintaining 60fps performance even at high zoom levels.
*   **Audio Integrity:** Audio clips are stored at their absolute time in seconds/milliseconds. Changing the BPM shifts the grid and metronome but does NOT stretch or move existing audio clips.
*   **Metronome:** A dedicated metronome track provides a click track. **There is no "manual" metronome; it is always a pre-rendered audio track.** This track is the single source of truth for project synchronization. It plays during the pre-roll and standard playback. It can be muted or its volume adjusted, but it cannot be recorded onto. The metronome track is rendered as a 1-bar clip laid consecutively (appended dynamically) to save memory. The metronome track is thinner (40px) and has no text label on its clips.
*   **Cues & Navigation:**
    *   **Cues:** Users can add markers (cues) to the timeline. Cues are visible in the transport bar and the sidebar.
    *   **Bar.Beat Display:** The transport bar features a digital display showing the current position in `Bar.Beat` format (e.g., `1.1`, `2.3`). User Time 0:0:0 corresponds to Bar 1.1.
    *   **Cues Panel:** A toggleable sidebar panel for managing cues, including adding and deleting them.

## 4. Selection & Interaction
*   **Intelligent Phrase Selection:** Double-clicking on a track identifies the phrase (clip) currently under the playhead (`currentTime`) and selects it. This allows for quick access to clip-specific settings like manual offsets or deletion.
*   **Track Expansion:** Selecting a track while the Envelope Lock is disabled expands the track height (from 50px to 80px) to facilitate precise automation editing. Waveforms are automatically re-centered vertically within the new height.

## 3. Dragging, Trimming & Extending
*   **Trimming/Extending Edges:** Users can drag the left or right edges of a clip to trim silence or extend the clip.
*   **Strict Bounds:** Extending a clip is strictly bound by the original audio recording length. Users cannot extend a clip past its original recorded duration (no looping or empty space generation).
*   **Collisions:** If extending a clip causes it to collide with an adjacent clip, it triggers the Overlap Solver menu.

## 4. Overlap Resolution & The Solver Menu
When a clip is dragged and dropped (or extended) so that it partially overlaps another clip, the **Overlap Solver** floating menu appears.

### Complete / Multiple Overlaps (Destructive)
*   If a clip is dropped such that it completely swallows another smaller clip, or overlaps multiple clips simultaneously, the underlying clips are destructively overwritten (deleted/trimmed) to maintain predictable, tape-style logic.

### Partial Overlaps (The Floating Menu)
For simple edge overlaps, a dismissible floating menu appears offering the following choices:
*   **Left over Right (Icon):** Applies a 0.5s fade-out to the Left clip and a 0.5s fade-in to the Right clip at the transition point.
*   **Left under Right (Icon):** Applies a 0.5s fade-out to the Right clip and a 0.5s fade-in to the Left clip.
*   **Undo:** Reverts the drag/drop or punch-in action completely.
*   **Record same take again:** Deletes the newly recorded/dropped clip, moves the playhead back to the original start time of that clip, and immediately arms/starts recording again.

### Menu Mechanics
*   **Envelopes:** The crossfades are achieved using volume envelopes (automation curves). The clips remain visually overlapping so the user can see the underlying audio.
*   **Dismissal & Default:** The menu is dismissible by clicking anywhere outside of it. 
    *   If the user has already clicked a choice (e.g., "Left over Right"), clicking away simply closes the menu and leaves that choice applied.
    *   If the user clicks away *without* ever making a choice, the **default overlap choice** is automatically applied: **The new clip fades IN over the old clip at its start, and fades OUT under the old clip at its end.** (Essentially, the new clip sits "on top" in the middle, but tucks under at the edges).
*   **Double Overlaps (Bridging):** If a clip is dropped such that it partially overlaps *two* different clips (e.g., bridging a gap and overlapping both edges), the system will trigger the Overlap Solver menu twice in sequence. The first menu resolves the left overlap; once dismissed, the second menu appears to resolve the right overlap. Both default to the standard logic if ignored.
*   **Envelope Tweaking:** While the menu is active (and after a choice is made), Envelope Lock is temporarily bypassed, allowing the user to manually tweak the 0.5s crossfade nodes.

## 5. Focus Mode Playback
When a user selects an overlap resolution choice from the floating menu, the system automatically previews the result using **Focus Mode**.
*   **Playback Bounds:** Playback automatically starts 1.5 seconds before the 0.5s crossfade envelope, and stops 1.5 seconds after the envelope ends (3.5 seconds total preview).
*   **Audio Ducking & Persistence:** During Focus Mode, the track currently being edited plays at normal volume. All other non-muted tracks in the project are temporarily ducked by 30% to allow the user to critically monitor the crossfade. **Focus Mode (and the 30% ducking) remains active for as long as the user is in the Overlap Solver menu**, allowing them to repeatedly preview and tweak the envelopes without the full mix interfering.

## 6. Performance Optimizations & Environment Limitations

### Audio Engine Rendering
*   **Differential Updates:** The `wavesurfer-multitrack` instance is initialized once per project structure change (e.g., adding/removing a track or phrase). It is **not** destroyed and recreated for non-structural changes like zooming, volume adjustments, or moving a clip (`startPosition`).
*   **Dynamic Syncing:** Track properties (volume, mute, solo) and clip positions are synced dynamically using library methods (e.g., `setTrackStartPosition`, `zoom`) to prevent expensive canvas redraws and UI flickering.
*   **Throttled State Updates:** The `currentTime` of the transport is polled and updated in the global store every 100ms (10fps). This provides a smooth visual playhead while significantly reducing the React render cycle overhead compared to higher frequency updates.
*   **Component Isolation:** High-frequency UI elements like the `TransportTimeDisplay` and `PlayheadSlider` are isolated into their own React components. This prevents the main `App` component from re-rendering on every `currentTime` tick.

### Development Environment (Monaco Editor)
*   **Web Worker Restriction:** The application development environment runs within a sandboxed iframe. This security measure prevents the Monaco Editor from spawning Web Workers.
*   **Main Thread Impact:** Because Web Workers are blocked, Monaco is forced to perform heavy operations (like syntax highlighting, parsing, and formatting) on the main UI thread.
*   **UI Freezes:** This limitation causes noticeable UI freezes and unresponsiveness ("long pauses") when editing code, especially in large files. This is an environmental constraint, not a flaw in the application's React or Audio Engine architecture.

## 6. Lyrics Alignment & Onset Detection

### Auto‑Alignment Algorithm
1. Compute RMS energy envelope per track.
2. Normalize to [0,1] using maximum peak.
3. Adaptive threshold based on noise floor (median of first 2s).
4. Onset detection via energy rise and sustain.
5. Snap segment start to nearest onset in prioritized track (±1s fallback).

### Manual Correction
- **Drag:** Drag left edge of text line; snaps to onset within 0.3s.
- **Tap‑to‑Cue:** Set start time at playhead, then snap to closest onset.

### Instrumental Gap Handling
- Gaps > threshold (default 4s, adjustable) show spacer with progress bar in Scaled View.
