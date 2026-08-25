# SongHost — YouTube Music Provider: Current Status & Empirical Findings

**Date:** Aug 24, 2026 (updated with live test results the same day)
**Purpose:** Hand-off summary for cross-review and for the next chat. Code facts in §1 were verified against the tree. Empirical ads results in §2–§4 come from Larry’s Chrome consoles in this session.

## 1. What the app does today (verified against code)

SongHost's live dial plays full-length music through the **YouTube IFrame Player API**. Verified facts:

- **API:** Official YouTube IFrame Player API, script loaded from `https://www.youtube.com/iframe_api` (`src/lib/audio/TrackProvider.ts`). Not a hand-built iframe; not `youtube-nocookie.com` (no references found).
- **Embed parameters** (`TrackProvider.ts` playerVars): `autoplay=0`, `controls=0`, `modestbranding=1`, `rel=0`, `fs=0`, `disablekb=1`, `enablejsapi=1`, `playsinline=1`, `origin=window.location.origin`. No ad-related params; no `iv_load_policy`, `cc_load_policy`, etc.
- **Player visibility (production default)** (`src/components/AudioPlayer.tsx`): the host div is `fixed -left-[9999px] top-0 h-[180px] w-[320px] overflow-hidden opacity-0 pointer-events-none`, `aria-hidden="true"`. The player is **off-screen, invisible, 320×180**.
- **Test harness (not a product surface):** Header **YT View** restyles the same iframe into the dock at **320×200** and calls `player.setSize`. It does not remount. See §6 and decision D4.
- **No ad-blocking code exists anywhere in `src/`.** Verified by search for `ad`, `ads`, `adblock`, `skipAd`, etc. The only ad-adjacent param is `modestbranding=1` (branding reduction, not ad suppression).
- **Volume floor** `MIN_PLAYER_PERCENT=1` — player is never muted to zero; audio is audible. Ducking still uses `player.setVolume`.
- **ID resolution:** `resolveTrackVideoId` (`src/lib/youtube/resolver.ts`) searches via YouTube Data API v3 (if `YOUTUBE_API_KEY` set) or an Innertube fallback, ranks candidates, and checks embeddability. Search queries are `"Artist - Title Official Audio"` then `"Artist - Title Topic"`.
- **Where IDs are stamped in production:** `/api/station-tracks`, `/api/artist-radio`, `/api/album-radio`, `/api/curate-playlist` all call `resolveTrackVideoId` unconditionally. Preset seeds carry hardcoded `youtubeId`s. `/api/song-radio` and `/api/recommendations` only stamp when the dev-gated `youtubeFallback=true` is on (**Full Songs (Dev)**). Artist Radio does **not** need that toggle.
- **Provider selection:** `resolveDirectStreamUrl` returns `undefined` for any row with a `youtubeId`, so `AudioPlayer` falls through to `YouTubeTrackProvider`. Priority: DirectStream > Preview > YouTube.

## 2. Empirical tests run Aug 24 2026 (Larry, Chrome)

### Test 1 — SongHost embed, YT View on, logged out of everything

**Conditions (as reported):** Chrome; **not signed into YouTube**; **not signed into SongHost**; free mode; **Full Songs (Dev)** on; **YT View** on. Taylor Swift Artist Radio (`artistRadioLaunched`, 30 tracks, host Nova). User watched the videos in the dock and heard no ads. DJ commentary worked. One ~30s edge song was heard in the session; it is **not** in the console excerpt (shortest logged YouTube duration is 157.5s).

**Harness confirmed:** `[YouTubeViewer] layout hidden 320x180` on restore, then `[YouTubeViewer] layout visible 320x200` before launch. After launch, every playing row logged `visible=true`.

**Playback pattern (no pre-roll signature):** `UNSTARTED → BUFFERING → PLAYING → ENDED` with content duration present at first `PLAYING`, and `ENDED pos` matching `dur`. The §10 pre-roll fingerprint (`pos` sitting at `0.0` in `PLAYING`/`BUFFERING` for ~15–30s) did **not** appear.

**Videos actually embedded** (IDs copied from `[YouTubeViewer] video=`; titles via YouTube oEmbed, not assumed from youtube.com search):

| ID | What it is | Logged duration |
|---|---|---|
| `Oknf3cfrcR0` | Bad Books – Forest Whitaker (**Topic**). Restored leftover; loaded while still hidden | not played in the launch |
| `z9Q9OzL_wI8` | Sabrina Carpenter – Taste (**Official Lyric Video**, SabrinaCarpenterVEVO) | 157.5s |
| `fvg01l43XBc` | Taylor Swift – Enchanted (**Topic**) | 352.2s |
| `BP9HosBWr6M` | “Olivia Rodrigo – drop dead (Full Official Audio)” on **valentynevideosVEVO** (not Olivia’s official channel) | 225.1s |
| `ic8j13piAhQ` | Taylor Swift – Cruel Summer (**Official Audio**, Taylor Swift channel) | 179.4s |
| `lwxAovpSLh8` | Sabrina Carpenter – House Tour (**Official Lyric Video**) | 169.3s |
| `mWCQU-Spw9A` | Maisie Peters – History Of Man (**lyrics channel**, not official) | 208.1s |
| `O3wlMR0y4a4` | Taylor Swift – How Did It End? (**Official Lyric Video**) | 242.2s |

The resolver’s Official Audio / Topic preference is doing what the code says. That mix is **not** always the Vevo music-video page a listener would open by searching the song on youtube.com. Taste (`z9Q9OzL_wI8`) is still a real VEVO official lyric video — a strong ads comparison ID.

**DJ / legal-relevant traces in the same session:** `hard_pause` and `intro_ramp` fired; YouTube was paused/ducked so Nova could talk. That is still `setVolume` / pause overlay on YouTube audio (policy problem even with a visible player).

**Noise to ignore in that console:** MetaMask `contentscript.js` MaxListeners / ObjectMultiplex; missing Apple Music developer token; Clerk development keys; Windows WebGPU `powerPreference`. None of those are SongHost ad blocking.

### Test 2 — Same video ID on youtube.com watch (this chat)

**Conditions:** Same Taste ID `z9Q9OzL_wI8`. User searched `/results?search_query=z9Q9OzL_wI8`, opened `/watch?v=z9Q9OzL_wI8` (URL also had `start_radio=1`, so YouTube Mix was armed). **Larry reported an ad played.**

**What the watch-page console confirms:**

- It is the **same video id** as the SongHost embed that had no in-stream ad.
- The same DoubleClick conversion pixel fired: `googleads.g.doubleclick.net/pagead/viewthroughconversion/962985656/` with `label=followon_view`, CORS-blocked after a 302. That pixel also fired **during the embed session when no ad was seen**.
- MetaMask `contentscript.js` noise is present on youtube.com too — this Chrome profile has that extension on both surfaces.
- Other watch-page noise (`generate_204` preload, PWA `beforeinstallprompt`, `LegacyDataMixin`) is YouTube’s own page, not SongHost.

**Caveat:** The console does not print “ad started.” Larry’s eyes are the evidence that an ad played on the watch page. `start_radio=1` means Mix was on; the page was still the Taste watch URL.

## 3. What those two consoles prove

1. **The conversion pixel is not a proxy for “an in-stream ad played.”** It ran on the embed (no ad observed) and on the watch page (ad observed). It is YouTube measurement (`followon_view`), not a creative in the player. CORS failure is YouTube/Google, not SongHost blocking ads.

2. **The hidden-player hypothesis is not confirmed — and for this ID it is falsified as the sole cause.** §4 used to say: make the player visible ≥200×200 and see if ads appear. Test 1 did that. No in-stream ad. Then Test 2 showed the **same ID** is ad-eligible on youtube.com. Hiding the player is still a **terms** violation; it is not the explanation for zero ads in this run.

3. **A profile-wide ad blocker that strips all YouTube ads is unlikely.** The same Chrome profile showed an ad on youtube.com and no in-stream ad in the SongHost IFrame. MetaMask is on both. An embed-only blocker is still a residual possibility; it is no longer the simplest story.

4. **Embed vs watch page is the live question.** YouTube served an in-stream ad on `youtube.com/watch?v=z9Q9OzL_wI8` and did not serve one into the official IFrame embed of that same id, visible at 320×200, logged out of YouTube, `controls=0`. That is Google’s serving decision for this embed context. It is not a SongHost license and it is not a feature we can promise.

5. **“Same song has ads on youtube.com” is not enough without the ID.** The app often embeds Official Audio / Topic / lyric videos. Taste happened to be a VEVO lyric video and still showed the embed/watch split. Other rows in Test 1 would be a weaker comparison if someone only opened a different Vevo MV on youtube.com.

6. **Full Songs (Dev) did not decide Test 1.** Artist Radio always stamps YouTube IDs. That toggle only gates Song Radio / recommendations lookups.

## 4. Revised hypothesis (open)

**Primary (now):** IFrame embeds on a third-party origin often do not get the same in-stream ads as `youtube.com/watch`, even when the video is monetized, the player is visible, and the user is not Premium. Taste (`z9Q9OzL_wI8`) is one confirmed example.

**Still possible contributors (not proven, do not treat as product):**

- `controls=0` + 320×200 (minimum size, still small)
- Logged-out / low-targetability session
- Lyric / Official Audio vs “official music video” inventory
- Viewability rules that still fail inside our dock even at 200px tall
- An extension that affects third-party embeds only

**Falsified as the only explanation:** “Ads are absent because the player is hidden / 180px tall.” Visible 320×200 still had no in-stream ad for Taste.

**Do not productize.** Zero ads in the embed is Google’s choice today. It can change without a SongHost deploy. Shipping “ad-free YouTube for free, logged-out users” would be building on a serving quirk, not a right.

## 5. YouTube terms reality (unchanged by the ads result)

Prohibited, full stop:

- **Background player:** a player that is not displayed in the page/tab/screen the user is viewing. Production default (off-screen 320×180, `opacity-0`) is this. **Phone-in-pocket / screen-locked = background = violation.**
- **Audio separation / modification:** ducking via `setVolume`, pausing their player to talk over it, overlaying DJ audio. Test 1 did this (`hard_pause`, `intro_ramp`). Web Audio still cannot tap the cross-origin iframe.
- **Selling your own ads** on/within the YouTube player without written approval.

Required (Minimum Functionality):

- Embedded player ≥ **200×200** (production default 320×180 — below; YT View 320×200 — meets size).
- No overlays obscuring the player (`opacity-0` in production — violation).
- Autoplay must not start until the player is visible and >50% on-screen.

Allowed in principle: commercial use of an API client **if** none of the prohibited actions occur and you don’t sell ads inside the YouTube player. Ads on embeds “honor the same ad enablement settings as videos on youtube.com” — that means eligibility, not “every playback gets the same ad as the watch page.” The site owner earns no ad revenue share. There is no supported way to disable ads on embeds only.

**This test does not make the current product legal.** Production is still hidden. Pocket mode is still a terms wall. DJ ducking/pause is still a terms wall. No-ads-in-embed is not a license.

## 6. Current compliance status

| Surface | Size / visibility | Ads observed | Terms |
|---|---|---|---|
| Production default | Hidden 320×180, `opacity-0` | Historically none (user-reported) | Violates background + size + overlay |
| YT View harness | Visible 320×200 in dock | Test 1: no in-stream ad (logged-out Chrome) | Size OK while on-screen; DJ duck/pause still prohibited; not a shipped UX |
| youtube.com watch | YouTube’s page | Test 2: ad played on Taste `z9Q9OzL_wI8` | YouTube’s own product |

- **Not violating:** no ad-blocking code, no audio extraction attempted.
- **If made visible + foreground:** closer on size/overlay/background *while the screen is on*; still cannot do pocket/lock-screen; still cannot duck/talk over the stream.

## 7. Strategic implication for SongHost

- **YouTube can be a lean-forward video radio** (visible player, screen on): the listener is watching YouTube’s official player on our page. Premium users should be ad-free. Non-Premium users **may** get ads; this Chrome run did not, but youtube.com did for the same id. Product must assume ads can appear in a legal embed and must not promise they won’t.
- **YouTube cannot be pocket / lock-screen radio.** That is a terms wall, not a code wall.
- **YouTube is not a §114 statutory catalog.** Playing their IFrame is their license, in their player. It does not replace SoundExchange / owned files / DirectStream.
- **DJ over YouTube remains non-compliant** even when the picture is visible. A legal YouTube mode would need a DJ design that does not modify their audio (e.g. talk only in gaps YouTube already allows — which their player does not give us as a supported API — or don’t talk over their stream).
- Therefore YouTube alone is **not a complete music provider**. It can be one mode. Pocket mode needs Apple native, owned catalog, or a statutory path.

## 8. Confidence labels

- **Verified (code):** §1 — player API, sizes, resolver queries, no adblock in `src/`.
- **Verified (terms):** §5 — published Developer Policies / Minimum Functionality.
- **Verified (this session’s consoles):** Test 1 `[YouTubeViewer]` lines; Test 2 watch URL + same conversion pixel; oEmbed titles for the IDs above.
- **User-reported:** no ads seen in the dock; an ad played on the Taste watch page. Not independently reproduced by the model.
- **Open:** remaining matrix in §9.

## 9. Remaining tests (for the next chat)

Do not redo Test 1+2 unless the code or origin changes. Copy `[YouTubeViewer]` lines every time.

1. **Hidden vs visible, same ID, same profile** — YT View off, load `z9Q9OzL_wI8` (or skip to a new resolve of Taste). Already know visible had no in-stream ad; this only documents the hidden control.
2. **YouTube Premium (Account A)** — expected no ads on watch and embed; confirms the harness doesn’t *add* ads.
3. **Official music video (Vevo MV), not lyric/Official Audio/Topic** — pick a known-monetized MV, note `video=` in SongHost, open **that exact id** on youtube.com. Tests whether lyric/audio inventory is why the embed was dry.
4. **Confirm no embed-only blocker** — Chrome extensions list; disable MetaMask once as a control (it is not an ad blocker, but it is the only extension noise in both logs).
5. **Mobile Chrome / Safari, YT View on, screen on** — then screen off (expect pause; confirms pocket is dead).
6. **Do not** treat a dry embed as a shipping feature. If ads start appearing in the embed, that is the legal visible-player world asserting itself.

**Pass/fail that is already closed:** “Ads appear when visible and not when hidden → viewability was the cause.” **Failed** for Taste: visible and still no in-stream ad, while watch page had an ad.

## 10. Test harness (unchanged mechanically)

**Status:** Code is in. Empirical ads result is **in** (§2–§4). This is **not** a product feature. Default remains hidden.

**What shipped:** Header **YT View** (left of FREE MODE). Off = hidden 320×180. On = same iframe in the dock at 320×200, clicks enabled. `player.setSize`; no remount. Storage key `songhost_youtube_viewer`.

**What it does not change:** `controls=0`, ducking via `setVolume`, Innertube fallback, pocket/lock-screen, provider selection. Full Songs (Dev) is a different toggle (Song Radio lookups only).

**How to run further tests:** Turn **YT View** on **before** starting or skipping (ads are usually decided at video load). Note `video=` in `[YouTubeViewer]` lines. Compare that exact id on youtube.com. During a real pre-roll, `pos` often sits at `0.0` while state is `PLAYING` or `BUFFERING`.

## 11. Handoff for a new chat

Read this file first, then `docs/DECISIONS.md` D4 (harness) and D5 (this result). Do not re-audit whether we block ads — we don’t. Do not reopen “hidden player is why Taste had no ads.” Next work is the remaining matrix in §9, DJ-over-YouTube policy, or other providers — not relitigating this Taste embed/watch split unless new console evidence contradicts it.
