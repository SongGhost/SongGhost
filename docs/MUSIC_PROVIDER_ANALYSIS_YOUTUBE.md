# SongHost — YouTube Music Provider: Current Status & Open Question

**Date:** Aug 24, 2026
**Purpose:** Hand-off summary for cross-review by other AI models.

## 1. What the app does today (verified against code this session)

SongHost's live dial plays full-length music through the **YouTube IFrame Player API**. Verified facts:

- **API:** Official YouTube IFrame Player API, script loaded from `https://www.youtube.com/iframe_api` (`src/lib/audio/TrackProvider.ts:317`). Not a hand-built iframe; not `youtube-nocookie.com` (no references found).
- **Embed parameters** (`TrackProvider.ts:375-388`): `autoplay=0`, `controls=0`, `modestbranding=1`, `rel=0`, `fs=0`, `disablekb=1`, `enablejsapi=1`, `playsinline=1`, `origin=window.location.origin`. No ad-related params; no `iv_load_policy`, `cc_load_policy`, etc.
- **Player visibility** (`src/components/AudioPlayer.tsx:2462-2466`): the host div is `fixed -left-[9999px] top-0 h-[180px] w-[320px] overflow-hidden opacity-0 pointer-events-none`, `aria-hidden="true"`. The player is **off-screen, invisible, 320×180**.
- **No ad-blocking code exists anywhere in `src/`.** Verified by search for `ad`, `ads`, `adblock`, `skipAd`, etc. The only ad-adjacent param is `modestbranding=1` (branding reduction, not ad suppression).
- **Volume floor** `MIN_PLAYER_PERCENT=1` — player is never muted to zero; audio is audible.
- **ID resolution:** `resolveTrackVideoId` (`src/lib/youtube/resolver.ts:86-110`) searches via YouTube Data API v3 (if `YOUTUBE_API_KEY` set) or an Innertube fallback, ranks candidates, and checks embeddability (API `status.part=embeddable` or oEmbed probe). Search queries include `"Artist - Title Official Audio"` and `"Artist - Title Topic"`.
- **Where IDs are stamped in production:** `/api/station-tracks`, `/api/artist-radio`, `/api/album-radio`, `/api/curate-playlist` all call `resolveTrackVideoId` unconditionally. Preset seeds (`station-seeds.ts`, `stations.ts`, `extra-decades.ts`) carry hardcoded `youtubeId`s. `/api/song-radio` and `/api/recommendations` only stamp when the dev-gated `youtubeFallback=true` is on.
- **Provider selection** (`AudioPlayer.tsx:739-753, 1247-1251`): `resolveDirectStreamUrl` returns `undefined` for any row with a `youtubeId` (`DirectStreamProvider.ts:122`), so `AudioPlayer` falls through to `YouTubeTrackProvider`. Priority: DirectStream > Preview > YouTube. `suppressLocalAudio` is hardcoded `false` (`AudioPlayer.tsx:464`).

## 2. The observation (reported by the user, not independently reproduced by me)

- App is deployed on a **Vercel URL** (not localhost). Dev mode (`youtubeFallback` on) serves YouTube.
- Chrome, **Account A (YouTube Premium):** excellent experience, no ads (expected for Premium).
- Chrome, **Account B (no Premium):** watching the same songs on youtube.com → **gets ads**. Listening to the same songs **inside the app** → **has never heard an ad** (no audio ad whatsoever, across many sessions).

The user has ruled out the "localhost origin" theory because the app runs on a real Vercel domain, and considers the "non-monetized videos" theory unlikely because the same songs show ads on youtube.com.

## 3. The open question

**Why does the hidden YouTube embed serve zero ads (not even audio ads) to a non-Premium account, when the same videos are monetized on youtube.com?**

## 4. Leading hypothesis (not yet confirmed by live test)

**No ad is being *served* to the player at all — not merely hidden.** If an in-stream ad were served it would be audible (the player is unmuted and music is audible). The absence of audio means the ad request is not happening or YouTube is returning no ad.

Most likely cause: **the player is non-viewable**, so YouTube's ad system withholds/never requests an ad. Supporting evidence:
- Player is off-screen (`-left-[9999px]`), `opacity-0`, and **180px tall — below YouTube's own 200×200 minimum** for embedded players.
- YouTube's ad serving is viewability-gated; non-viewable players typically receive no in-stream ad.

Secondary possibility: the combination of `controls=0` + small size + API-detected non-render may suppress ad serving. This overlaps with the viewability cause.

## 5. YouTube terms reality (verified against published YouTube API Developer Policies & Required Minimum Functionality, Aug 2026)

Prohibited, full stop:
- **Background player:** "create, include, or promote features that play content… from a background player, meaning a player that is not displayed in the page, tab, or screen that the user is viewing." Our hidden player is exactly this. **Phone-in-pocket / screen-locked = background = violation.**
- **Audio separation:** "separate, isolate, or modify the audio or video components." (Web Audio can't tap a cross-origin iframe anyway — this is why SongHost's Pocket/ducking mode is broken on YouTube — but even if it could, it's prohibited.)
- **Selling your own ads** on/within the YouTube player without written approval.

Required (Minimum Functionality):
- Embedded player ≥ **200×200** (we're 320×180 — below).
- No overlays/frames obscuring the player (we use `opacity-0` — violation).
- Autoplay must not initiate until the player is visible and >50% on-screen.

Allowed: commercial use of an API client is generally permitted **if** none of the prohibited actions occur and you don't sell ads inside the YouTube player. Ads on embeds "honor the same ad enablement settings as videos on youtube.com"; the site owner earns no ad revenue share; there is no way to disable ads on embeds only (you'd have to disable embedding entirely).

## 6. Current compliance status of the YouTube implementation

- **Violating now:** background-player rule (hidden = background), minimum size (180 < 200), obscuring overlay (`opacity-0`).
- **Not violating:** no ad blocking, no audio extraction attempted.
- **If made visible + foreground:** compliant on size/overlay/background *while the screen is on*; still cannot do pocket/lock-screen (background); still cannot duck/tap audio (separation ban + cross-origin).

## 7. The definitive test (not yet run)

1. Confirm Account B's Chrome profile has **no ad blocker** (uBlock, AdGuard, Brave shields). If one exists and allowlists youtube.com, that alone explains it.
2. On the Vercel deployment, make the YouTube player **visible at ≥200×200, no overlay**, play a known-monetized official music video, with **Account B (non-Premium)**.
3. Observe whether **audio ads** appear.
   - If ads appear → hypothesis confirmed: the hidden/non-viewable player was suppressing ad serving. Production with a visible player will have ads for non-Premium users.
   - If no ads appear → deeper investigation needed (video-level monetization flags, embed vs. watch-page ad eligibility, or a player-config interaction).

## 8. Strategic implication for SongHost

- **YouTube can work as a foreground video radio** (visible player, screen on): Premium users ad-free, non-Premium users hear ads. The user is open to a visible-video experience and has product ideas around it.
- **YouTube cannot deliver the pocket / lock-screen radio** that is SongHost's core promise — that is a YouTube terms wall (background player), not a code wall. No amount of engineering makes screen-off YouTube listening compliant.
- Therefore YouTube alone is **not a complete music provider** for SongHost's full vision. It can be one mode (lean-forward video radio) but the pocket mode needs a different provider (Apple native, owned catalog, or a statutory license path).

## 9. Confidence labels

- **Verified (code):** §1 — all file:line references read this session.
- **Verified (terms):** §5 — quoted from YouTube's published Developer Policies / Minimum Functionality.
- **User-reported, not reproduced by me:** §2 — the no-ads observation.
- **Hypothesis, not confirmed:** §4, §7 outcome — pending the live test in §7 / §10.

## 10. Test harness (shipped Aug 24 2026 — results not yet collected)

**Status:** Code is in. Empirical ads result is still open. This is **not** a product feature.

**What shipped:** Header control **YT View** (left of FREE MODE). Default **off** = today's hidden 320×180 off-screen host. On = same iframe, still mounted, restyled into the bottom player dock at **320×200** (meets YouTube's 200×200 minimum), clicks enabled so Skip Ad can be used. `player.setSize` runs; the IFrame is not destroyed.

**What it does not change:** `controls=0`, ducking via `setVolume`, Innertube fallback, pocket/lock-screen, provider selection. Full Songs (Dev) is a different toggle (Song Radio lookups only).

**How to run the test:**
1. Confirm Account B Chrome has **no ad blocker**.
2. Turn **YT View** on **before** starting or skipping to a song (ads are usually decided at video load).
3. Play a known-monetized official music video. Note the `video=` id in the console — it may be an Official Audio / Topic upload, not the Vevo page you opened on youtube.com.
4. Repeat with **YT View** off, new song, same account.
5. Repeat both on Account A (Premium) and Account B (no Premium).
6. Copy console lines that start with `[YouTubeViewer]`. During a pre-roll, `pos` often sits at `0.0` while state is `PLAYING` or `BUFFERING`.

**Pass / fail for the hidden-player hypothesis:**
- Ads appear when visible and not when hidden → viewability was suppressing ads. A legal player will have ads for non-Premium.
- No ads even when visible, same video id as a monetized youtube.com watch → deeper embed/monetization question; do not treat that as a product feature.
