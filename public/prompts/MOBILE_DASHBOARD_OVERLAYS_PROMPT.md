# MOBILE_DASHBOARD_OVERLAYS_PROMPT — Memory rail cue, teleprompter overlap, sheet chevron, decade sub-tabs

**Target:** Grok 4.6 High Fast (coder). Surgical, directive-only. No opportunistic refactors. Do not touch audio, mix-bus, DirectStream, statutory queue, ROU, `TrackProvider`, `useYouTubePlayer`, `DriveModeOverlay`, `SearchSection`, `SmartSearchBar`, the search API route, or any Phase 2+ code. This prompt is file-disjoint from `MOBILE_SEARCH_OVERLAY_PROMPT` — both can run in the same pass.

## Context (verified by GLM 5.2 this session, guest, 360×800, current deploy)

Four mobile bugs. Root causes verified:

1. **MEMORY rail shows ~1 preset, no scroll cue.** `src/components/MemoryToolbar.tsx:207` is `no-scrollbar min-w-0 flex-1 overflow-x-auto` (scrollable, but `no-scrollbar` hides the native scrollbar). Each preset is `min-w-[72px] shrink-0` (line 220), so on 360px only ~1 preset is visible with no visual indication that more exist. The presets ARE reachable by scrolling — the user just can't tell.
2. **TELEPROMPTER covers prev/play/next.** `src/components/teleprompter/ScriptTeleprompter.tsx:89` is `fixed bottom-[calc(env(safe-area-inset-bottom)+7rem)] right-4 z-[60]`. The expanded `MobilePlayerSheet` (`src/components/player/MobilePlayerSheet.tsx:256`) is also `z-[60]` and contains `TransportControls` (line 330) in its scrollable body. The teleprompter floats over the sheet and covers the transport (Play is cut in half, taps hit the panel). A prior fix bumped the offset to `7rem`; it did not clear the transport, which sits higher in the sheet body.
3. **Expanded-player ⌄ chevron does nothing.** `src/components/player/MobilePlayerSheet.tsx:270-277` — the chevron close button is a child of the drag-handle div (line 261) whose `onPointerDown={handleDragStart}` calls `event.currentTarget.setPointerCapture?.(event.pointerId)` (line 143). Pointer capture on the parent div steals the synthesized `click` from the chevron, so `onClick={close}` never fires. Only Escape (line 118) closes the sheet, unusable on a phone.
4. **DECADES sub-tabs slide under the sticky header and have no scroll cue.** `src/components/studio/StationBrowser.tsx:357` and `:391` — the decade/genre sub-pill scroll arrows are `hidden sm:flex` (hidden below 640px), and `scrollbar-none` hides the native bar, so on mobile there is no scroll cue. The sub-pills row also scrolls with the page and goes under the sticky header (z-50), becoming unclickable when you scroll down to the cards.

## Fixes (one per bug, surgical)

### A. MEMORY rail scroll cue (`src/components/MemoryToolbar.tsx`)

The presets row is the `<div className="no-scrollbar min-w-0 flex-1 overflow-x-auto">` at line 207. Wrap it so a fade-edge cue appears when more content exists on either side.

- Keep the `overflow-x-auto` scroll behavior and `no-scrollbar` (do not bring back the native scrollbar).
- Reduce each preset's `min-w-[72px]` (line 220) to `min-w-[64px]` so two presets fit on 360px.
- Add left and right fade-edge overlays as siblings of the scroll container (absolutely positioned, `pointer-events-none`, `w-6 from-transparent to-[#09090b]`). Show the left fade only when the row is scrolled past the start; show the right fade only when more content exists to the right. Track scroll state with a `useState` + `onScroll` handler on the scroll container (compare `scrollLeft` to `scrollWidth - clientWidth`). Hide both fades when the content fits without scrolling.
- This is a visual cue only — no behavior change to preset tune/save/clear.

### B. TELEPROMPTER reposition on mobile (`src/components/teleprompter/ScriptTeleprompter.tsx`)

The panel root is line 89. On mobile (<768px), anchor it to the TOP, below the header, instead of bottom-right, so it never overlaps the bottom transport. On desktop (≥768px), keep the current bottom-right position exactly.

- Add a mobile MQ check (`window.matchMedia("(max-width: 767px)")`) with state, same pattern as `SearchSection` uses.
- Mobile className: `fixed left-2 right-2 top-[calc(env(safe-area-inset-top)+3.25rem)] z-[65] w-auto max-h-[40vh] overflow-y-auto rounded-2xl border border-accent/20 bg-zinc-950/85 shadow-2xl backdrop-blur-xl`. The `z-[65]` puts it above the expanded `MobilePlayerSheet` (z-[60]) so it stays visible. `top-[calc(env(safe-area-inset-top)+3.25rem)]` clears the sticky header (~3rem tall).
- Desktop className: keep the existing `fixed bottom-[calc(env(safe-area-inset-bottom)+7rem)] right-4 z-[60] w-[min(24rem,calc(100vw-2rem))] ...` exactly.
- No other change to the teleprompter's content, cues, onClose, or subscription logic.

### C. Sheet chevron close (`src/components/player/MobilePlayerSheet.tsx`)

The chevron button is lines 270-277. Add `onPointerDown` and `onPointerUp` stopPropagation so the parent drag-handle does not capture the pointer for a chevron tap.

- On the chevron `<button>` (line 270), add: `onPointerDown={(e) => { e.stopPropagation(); }}` and `onPointerUp={(e) => { e.stopPropagation(); }}`. Keep `onClick={close}` unchanged.
- Do NOT move the chevron out of the drag-handle div. Do NOT change the drag handlers, `handleDragStart`/`handleDragMove`/`endDrag`, or the `touch-none` class on the parent.
- This is the minimal fix: the parent no longer captures the pointer when the chevron is the target, so the synthesized click reaches `close`.

### D. DECADES / GENRE sub-tabs sticky + scroll cue (`src/components/studio/StationBrowser.tsx`)

Two parts:

1. **Show the scroll arrows on mobile.** Lines 357 and 391: change `${arrowBtnClass} hidden sm:flex` to `${arrowBtnClass} flex` for both the decade sub-pill arrows and the genre sub-pill arrows. (Find the matching genre sub-pill arrow buttons — they use the same `hidden sm:flex` pattern — and apply the same change.) This gives a visible scroll cue on mobile.

2. **Make the sub-pills row sticky below the header so it stays tappable while scrolling cards.** For the decade sub-pills container (the `<div className="flex items-center gap-2">` at line 352 that wraps the arrows + the `decadeSubRef` scroll row) and the equivalent genre sub-pills container: add `sticky top-[calc(env(safe-area-inset-top)+2.75rem)] z-30 bg-[#09090b]` so the row sticks just below the header. Add `py-1` if needed for breathing room. The `z-30` keeps it below the header (z-50) so it tucks under the header cleanly, and above the cards so it stays tappable. Add a solid `bg-[#09090b]` (match the page bg) so cards don't show through when stuck.

- Do NOT change the top pills (All / Decades / Genres / My Mixes / My Stations) — they are separate and not in scope.
- Do NOT change the card carousels or their snap behavior.

## Implementation rules

- **Mobile-only where specified.** Desktop must look and behave identically to today, except the MEMORY rail fade cue (which is width-responsive and harmless on desktop) and the sub-pill sticky (which is also fine on desktop — sticky is a no-op when content fits).
- **No new dependencies.** No libraries. Use existing Tailwind utilities and `window.matchMedia` for the MQ check.
- **SSR safety:** any `window`/`matchMedia` access must be guarded (`typeof window !== "undefined"`) and set in `useEffect` to avoid hydration mismatch — copy the pattern from `src/components/studio/SearchSection.tsx` (the `MOBILE_MQ` matchMedia effect).
- **Do not change:** any audio/DJ/queue logic, `runStationLaunch`, launch handlers, preset tune/save/clear logic, teleprompter content/cue logic, sheet drag physics, or any doc.

## Verification (run before reporting done)

1. `npx tsc --noEmit` — no new errors.
2. Manual reasoning at 360×800 (state each):
   - MEMORY row: two presets visible, a right fade appears when more exist, fades update as you scroll left/right. Tapping a preset still tunes; Save still works.
   - Expand now playing → open TELEPROMPTER from Host Controls: the teleprompter panel appears at the TOP (below the header), NOT over the bottom transport. Prev/Play/Next are fully tappable. Close the teleprompter; transport still works.
   - Expand now playing → tap the top-left ⌄ chevron: the sheet collapses (closes). Confirm it now works from the chevron, not only Escape.
   - DECADES → scroll down to the station cards: the 50S/60S/… sub-pills stay stuck below the header and remain tappable. The left/right arrows are visible on mobile; tapping them scrolls the sub-pills. Later decades scroll into view.
3. Desktop (≥768px) at 1280×800: teleprompter is bottom-right (unchanged), sub-pills behave as before, MEMORY rail fades are unobtrusive. No visual regression.

## Files in scope

- `src/components/MemoryToolbar.tsx` — MEMORY rail fade cue + min-width.
- `src/components/teleprompter/ScriptTeleprompter.tsx` — mobile top-anchor + z-[65].
- `src/components/player/MobilePlayerSheet.tsx` — chevron pointer stopPropagation.
- `src/components/studio/StationBrowser.tsx` — sub-pill arrows on mobile + sticky sub-pill row.

No other files. Do not edit `src/app/page.tsx`, `globals.css`, `ControlDeck.tsx`, or any doc.

## Report back

Plain-language summary: what changed per file, the exact className strings used for the teleprompter mobile anchor / sticky sub-pill row / fade overlays, how the fade scroll-state is tracked, and the tsc result. Do not commit or push.
