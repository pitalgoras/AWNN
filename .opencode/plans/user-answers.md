# User Answers — Painting Model for Contenteditable Lyrics

## Question 1: What triggers painting?

**Q**: Does palette tap paint immediately (A: insert tag right before cursor word), or does it set activeTagId and
word-click paints (B)?

**A**: Normally A — palette tap inserts tag right BEFORE the word at cursor (not at cursor, but word boundary). B is for spree mode.

- **Normal mode**: palette click → paint at word boundary. Word-click = cursor movement only.
- **Spree mode**: palette click = same as normal. Word-click = paint with activeTagId.
- activeTagId is persistent, never auto-clears.
- Palette shows ring on active tag always.

## Question 2: Empty editor — first paint?

**Q**: Editor empty, user taps palette. What happens?

- A: Nothing visible. First keystroke → tag applied → `[S] Hello`.
- B: Immediately inject `[S] ` so a voice zone appears.

**A**: A. Nothing visible yet. First keystroke triggers the paint.

## Question 3: Typing inside existing voice zone

**Q**: Editor has `[S] Hello [A] World`. Cursor after "Hello" (inside `[S]` zone). User types " there". What serializes?

- A: CSS cascade colors the typed text. Serialize → `[S] Hello there [A] World`. No new tag.
- B: A new `[S]` tag is inserted. Serialize → `[S] Hello [S] there [A] World`.

**A**: A. Typed text inherits zone color via CSS cascade. No new tag.

## Question 4: No selection — cursor in a blank line

**Q**: Editor has `Hello\n|\nWorld` (cursor on empty line 2). User taps palette with `[A]` active.

- A: Nothing happens. First keystroke on that line paints → `[A] there`.
- B: A tag `[A] ` is inserted on the blank line immediately.

**A**: A. Nothing visible. First keystroke triggers the paint.

## Question 5: Branch choice?

**Q**: Build on `new-lyrics` or start fresh on `main`?

**A**: `new-lyrics`.

## Question 6: Cursor preservation after paint

**Q**: Palette click paints → `setLyricsText` → re-render → cursor jumps. Acceptable?

**A**: Tolerable, but ideally should stay where it was before.

## Question 7: Palette-click paint mechanism

**Q**: How does TrackBar trigger painting in LyricsBuilder? Proposed: paint counter in store + useEffect watcher.

**A**: (pending)
