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

## 3. Recording, Pre-roll & Punch-In Logic
*   **Pre-roll:** To allow users to establish a groove before recording, a 1-bar pre-roll is automatically applied. When recording starts, the timeline seeks to 1 bar *before* the punch-in point, and playback begins. The recorded audio is then destructively trimmed by this 1-bar duration so the final clip starts exactly at the intended punch-in time.
*   **Default Mode:** Punch-in recording is the default behavior.
*   **Latency Compensation:** Recorded clips are automatically offset by a global latency value (configurable in settings) to ensure they align with the backing tracks. This is calculated in conjunction with the pre-roll trim.
*   **Visual Splitting:** When a user records a new take over an existing clip, the underlying clip is visually split into two distinct pieces (pre-punch and post-punch).
*   **Metronome:** A dedicated metronome track provides a click track. It plays during the pre-roll and standard playback. It can be muted or its volume adjusted, but it cannot be recorded onto. The timeline includes a "fake 00:00:00" with a "Pre" bar to visually represent the pre-roll period. The metronome track is rendered as a 1-bar clip laid consecutively (appended dynamically) to save memory and allow for future tempo/signature changes. The metronome track is thinner (40px) and has no text label on its clips.
*   **Cues & Navigation:**
    *   **Cues:** Users can add markers (cues) to the timeline. Cues are visible in the transport bar and the sidebar.
    *   **Bar.Beat Display:** The transport bar features a digital display showing the current position in `Bar.Beat` format (e.g., `1.1`, `2.3`). The first bar is labeled `PRE`.
    *   **Cues Panel:** A toggleable sidebar panel for managing cues, including adding and deleting them.

## 4. Selection & Interaction
*   **Intelligent Phrase Selection:** Double-clicking on a track identifies the phrase (clip) currently under the playhead (`currentTime`) and selects it. This allows for quick access to clip-specific settings like manual offsets or deletion.
*   **Track Expansion:** Selecting a track while the Envelope Lock is disabled expands the track height (from 100px to 160px) to facilitate precise automation editing. Waveforms are automatically re-centered vertically within the new height.

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
