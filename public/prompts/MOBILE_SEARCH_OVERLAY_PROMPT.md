# MOBILE_SEARCH_OVERLAY_PROMPT — Full-screen portaled mobile search

**Target:** Grok 4.6 High Fast (coder). Surgical, directive-only. No opportunistic refactors. Do not touch audio, mix-bus, DirectStream, statutory queue, ROU, `TrackProvider`, `useYouTubePlayer`, `DriveModeOverlay`, `MobilePlayerSheet`, the search API route, or any Phase 2+ code.

## Context (verified by GLM 5.2 this session)

Mobile search (<768px) has five user-reported bugs at 360×800. Root causes verified:

1. **The "full-screen" overlay is NOT full-screen and renders UNDER the header.** `SearchSection` becomes `fixed top-0 z-[60]` when `drawerOpen`, but it is mounted inside `<div className="relative z-10 mx-auto max-w-6xl ...">` in `src/app/page.tsx:3370`. That `relative z-10` creates a stacking context at z-10, so the overlay's `z-[60]` is trapped inside a z-10 layer. The header `<header className="sticky top-0 z-50 ... backdrop-blur-xl">` in `src/components/ControlDeck.tsx:272` lives in the root stacking context at z-50. Since 10 < 50 at root level, the entire content layer (overlay included) paints UNDER the header. Same class of bug as Drive Mode T38 (stacking/containing-context trap), different trigger.
2. **`position: fixed` does not react to the on-screen keyboard.** The overlay reserves `bottom-[calc(8rem+220px)]` (~348px) for the dock, so the results area is a tiny strip; when the keyboard opens it covers that strip. Results can't be seen (#4) and can't be scrolled (#5).
3. **Mic on its own row.** `SmartSearchBar.tsx:893` is `flex flex-col xs:flex-row`. `xs` = 480px (`src/app/globals.css:25`). At 360px it is `flex-col`, so input, mic, and PLAY each get a full-width row.
4. **Rotating help is a native `placeholder`** (`SmartSearchBar.tsx:930`) — browsers truncate it with ellipsis. It cannot be animated/marquee'd. Needs a custom overlay element.
5. **`< CLOSE` text button** (`SearchSection.tsx:197`) takes a row.

## Design (the fix)

On mobile (<768px), search opens as a **true full-screen overlay portaled to `document.body`**, escaping the z-10 stacking-context trap. Desktop (≥768px) is UNCHANGED — keep the existing `absolute z-[100]` dropdown and current layout exactly.

### A. Portal the overlay to document.body (escape the z-10 trap)

In `src/components/studio/SearchSection.tsx`:
- When `drawerOpen` is true, render the overlay via a React portal at `document.body` (`createPortal` from `react-dom`). The overlay MUST NOT be a child of the `relative z-10` content wrapper.
- Overlay root className (mobile only): `fixed inset-0 z-[200] flex flex-col bg-[#09090b]` plus inline style `height: 100dvh` (dynamic viewport height — shrinks when the mobile keyboard opens, so the results list gets the visible space above the keyboard). Add safe-area padding: `pt-[env(safe-area-inset-top)]` and `pb-[env(safe-area-inset-bottom)]` via Tailwind arbitrary values.
- `z-[200]` is above the header (z-50) and the dock (z-50 / z-[210] only during Drive Mode — search is not reachable while Drive Mode is on, so no conflict; do not change Drive Mode z values).
- Keep `role="dialog"`, `aria-modal="true"`, `aria-label="Search"` on the overlay root.
- Keep the existing body-scroll lock effect (`document.body.style.overflow = "hidden"` while `drawerOpen`) — it already exists.
- The non-drawer (closed) state stays exactly as today: `relative z-30 ...` card, `sticky top-0 z-40` on mobile when not active. Do NOT change the closed-state layout.

### B. Redesign the control rows inside the overlay (fix mic row)

In `src/components/search/SmartSearchBar.tsx`, change the controls wrapper (line ~893, currently `flex flex-col xs:flex-row gap-2`):
- New layout, ALWAYS `flex-row` for the input+mic row on mobile inline mode:
  - **Row 1:** a `flex flex-row gap-2` containing the input (wrap in `relative flex-1 min-w-0`) and the mic button (`h-11 w-11 shrink-0`). One row at all widths. Remove `flex-col` / the `xs:flex-row` split for this row.
  - **Row 2:** the PLAY/GENERATE launch button as a full-width button (`w-full`) below row 1. Keep its current styling/label logic.
  - The Advanced Tuning (`SlidersHorizontal`) button: keep it gated on `onToggleTuner` (the dashboard does not pass it, so it stays hidden — unchanged). If ever present, place it in row 1 after the mic; do not give it its own row.
- This must apply ONLY to the mobile inline (`inlineResults === true`) layout. Desktop (`inlineResults === false`) keeps the existing single `flex` row (input + mic + tuner + launch all inline) UNCHANGED. Gate the new two-row layout on `inlineResults`.
- Mic button: keep `h-11 w-11`; no longer full-width. No behavior change.

### C. Marquee rotating help (fix cut-off help)

In `src/components/search/SmartSearchBar.tsx`:
- Add a custom hint overlay shown ONLY when `inlineResults && !query.trim() && !isLaunching && !inputFocused && rollingPromptText`. (When focused or typing, fall back to the existing `placeholder` = mode default — unchanged.)
- Render it as an absolutely-positioned `<span>` over the input: `pointer-events-none absolute left-9 right-3 top-1/2 -translate-y-1/2 truncate font-mono text-sm text-zinc-500` (left-9 clears the mode icon at left-2; mirror the input's `pl-9`/`sm:pl-10`).
- Apply the existing `songhost-marquee` animation (defined in `src/app/globals.css`) ONLY when the text overflows: use a `ResizeObserver` (or a ref + `useEffect` measuring `scrollWidth > clientWidth`) to add the marquee class conditionally, exactly like the `TrackMetadata` marquee. Respect `prefers-reduced-motion` — match what `TrackMetadata` does.
- Give the span `aria-label={rollingPromptText}` so screen readers get the full text.
- Keep the existing 5s rotation timer (`IDLE_PLACEHOLDER_MS`) and `rollingPromptText` state — just change how it's rendered on mobile inline. Desktop placeholder behavior is unchanged.
- When the prompt text changes (every 5s), the marquee should restart from the left. A `key={rollingPromptText}` on the span forces remount → restarts the animation cleanly.

### D. Replace the text CLOSE button with a small X (fix close button)

In `src/components/studio/SearchSection.tsx`:
- Remove the `< CLOSE` text button (lines ~197-208).
- Add a single small icon button in the overlay, top-right: an `X` from `lucide-react`, `className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200"`, `aria-label="Close search"`, `onClick={dismissMobileSearch}`. Use `onMouseDown={(e) => e.preventDefault()}` to avoid stealing focus.
- Keep the existing Escape handler and the tap-outside / focus-out dismiss handlers (they already call `dismissMobileSearch`). Do NOT remove those dismiss paths — the X is additive.

### E. Results region actually scrolls (fix #5)

In `src/components/search/SmartSearchBar.tsx`, the inline results container (line ~1022-1030) is already `mt-2 flex min-h-0 flex-1 flex-col overflow-hidden`. Inside it, `SearchResultsBody`'s list is `min-h-0 flex-1 overflow-y-auto overscroll-region p-1`. This is correct IF the parent chain has real height. With the portaled `100dvh` overlay (step A) and the two compact control rows (step B), the results region now gets the full visible height above the keyboard and will scroll. No change needed to `SearchResultsBody` itself — just confirm the parent `flex flex-col` chain from the overlay root down to the list is unbroken (every ancestor `min-h-0 flex-1` or `flex-1`, no fixed pixel heights in between). If the `SearchSection` inner `<div className="relative flex min-h-0 w-full flex-1 flex-col">` (line ~217-223) needs `min-h-0`, add it — do not add fixed heights.

## Implementation rules

- **Mobile-only changes are gated on `inlineResults` (mobile) vs not (desktop).** Desktop search must look and behave identically to today. Do not touch the desktop `absolute z-[100]` dropdown, its `max-h-[calc(100svh-21rem-220px)]`, or the desktop control row.
- **Portal is mobile-only.** On desktop, `SearchSection` stays in place (no portal). Gate the portal on `drawerOpen` (which is already `isMobile && mobileActive`).
- **No new dependencies.** Use `react-dom`'s `createPortal` (already available) and the existing `songhost-marquee` keyframe. Do not add a marquee library.
- **Reuse the `TrackMetadata` marquee measurement pattern** (ResizeObserver + conditional class + prefers-reduced-motion). Read `src/components/player/TrackMetadata.tsx` and copy that approach; do not invent a new one.
- **SSR safety:** `createPortal` and `document.body` access must be guarded (`typeof document !== "undefined"`); the portal target can be a `useState` set in `useEffect` to avoid hydration mismatch.
- **Do not change:** `runStationLaunch` `finally` → `onClose?.()` logic, `dismissMobileSearchAfterLaunch`, the `suppressFocusOpenRef` 300ms guard, the `onFocusCapture` open behavior, the `Cmd/Ctrl+K` handler, or any launch/API logic. These are correct.

## Verification (run before reporting done)

1. `npx tsc --noEmit` — no new errors.
2. Manual reasoning at 360×800 (state each):
   - Tap the search input → overlay opens, covers the SongHost logo and the bottom dock entirely (no logo visible, no dock visible).
   - Input + mic are on ONE row; mic is a 40px icon, not full-width.
   - PLAY button is full-width on its own row below.
   - Rotating help text scrolls left-to-right when it overflows; you can read the whole prompt before it advances.
   - Top-right has a single small X; tapping it closes the overlay. Escape also closes. Tapping outside the input area also closes.
   - Type "radiohead" → keyboard opens → overlay shrinks to the visible area above the keyboard → results list scrolls (swipe up reveals more results).
   - Tap a result → overlay closes, station launches (no scrim stuck).
   - Tap GENERATE STATION → overlay closes, no scrim stuck.
3. Desktop (≥768px) at 1280×800: search dropdown, control row, placeholder, and launch behavior are visually and behaviorally identical to before this change.

## Files in scope

- `src/components/studio/SearchSection.tsx` — portal overlay, remove `< CLOSE`, add X, ensure flex chain.
- `src/components/search/SmartSearchBar.tsx` — two-row mobile control layout, marquee hint overlay.
- No other files. Do not edit `src/app/page.tsx`, `ControlDeck.tsx`, `globals.css`, or any doc.

## Report back

Plain-language summary: what changed per file, the exact className strings used for the overlay root / X button / hint span, how the marquee is gated, and the tsc result. Do not commit or push.
