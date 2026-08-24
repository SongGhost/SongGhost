# SongHost Strategic Plan v1

**Status:** Canonical reference — attach this doc to any fresh chat to recover full strategic context.
**Author:** GLM 5.2 strategic review with Larry, Aug 21 2026. Grounded Aug 22 2026 (Spotify blocked, YouTube current-state, Apple unvetted, runtime transport audit).
**Supersedes:** `docs/SONGHOST MUSIC PROVIDER HISTORY AND ANALYSIS.md` §3 (Self-Hosted R2 row reclassified from "Unviable at Scale" to "VIABLE — primary statutory path").

---

## 1. Executive Summary

SongHost is unblocked. The project was frozen because it appeared to require a $75K+/year B2B music API vendor. That was a category error. The §114 statutory license path does NOT require a B2B vendor. The audio source can be lawfully acquired music — purchased CDs, authorized downloads, DJ record pools, Play MPE promos — exactly how SomaFM, Radio Paradise, and Pandora have operated for 20+ years.

**Current live state (grounded Aug 22 2026):** The live dial already runs full-length music via **YouTube IFrame** (concessions accepted: visible video, ads for non-Premium, no pocket mode on mobile). DirectStreamProvider is built but serves 30-second iTunes previews only (Song Radio search). Pocket mode is already broken on the dial — this is the present state, not a future risk.

**Product shape:** Pandora-style personalized seed radio. Listener searches for an artist → SongHost generates a noninteractive station from that artist plus similar artists, with AI-hosted documentary commentary between tracks. Listener cannot select specific tracks or order. The performance complement (album cap 3/3hr, artist cap 4/3hr) is enforced programmatically.

**The moat:** Commentary quality and documentary depth, not catalog size. The end-to-end AI orchestration stack (search → seed → statutory queue → AI curator → script → TTS → mix-bus → ROU) is what beats AIRadio and Spotify AI DJ.

**Two open swing factors:**
1. **SoundExchange "channel" reading** for the $1,100 annual minimum. If 1 channel → statutory path bootstrap viable (~$4,200/month opex at 100 simultaneous listeners). If per-user-channel → not bootstrap viable (~$13,000/month opex). Awaiting written answer.
2. **Apple MusicKit viability** for BYOS pocket mode. If the deep dive clears Section 10 + quota + commercial use → Apple is the primary BYOS pocket-mode transport. If blocked → YouTube-concessions-only (no pocket mode on mobile) and statutory path is the only pocket-mode option.

**Transport verdicts (do not regress):** Spotify BYOS = BLOCKED (5-user cap + commercial ban). YouTube = current live state, concessions accepted. Apple = unvetted, the swing transport.

---

## 2. Legal Architecture (verified Aug 2026)

### Statutory licenses
- **17 U.S.C. §114** — public performance right for sound recordings via statutory license. Pay SoundExchange, follow programming rules, no label deals required.
- **17 U.S.C. §112** — ephemeral reproduction right. Source must be "lawfully acquired" (CD, authorized download, promo). Ephemeral copies for transmission, generally destroyed within 6 months unless preserved for archival purposes.

### Performance complement (§114(d)(2)(B)(i))
- **Artist cap:** Max 4 tracks by same featured artist in rolling 3-hour window; max 3 consecutive.
- **Album cap:** Max 3 tracks from same album in rolling 3-hour window; max 2 consecutive.
- **Compilation cap:** Max 4 tracks from same compilation/box set in 3-hour window.
- Enforced in `src/lib/queue/statutory-rules.ts`.

### Non-interactive requirements (§114(d)(2)(A))
- Listener cannot select specific tracks on demand.
- Webcaster (SongHost's AI) decides which tracks to play and when — listener provides a seed, not a command.
- No pre-published playlists (upcoming titles obfuscated in UI).
- No reverse scrub, no instant replay, no jump-to-index.
- Forward skip capped at 6 per 60-minute sliding window.

### Pillsbury law primer confirmation
> "It is acceptable for a webcaster to receive play requests as long as the webcaster decides which requests to play and when they will be played."

This is the legal basis for the Pandora model: user search = request, AI curator = decision maker.

### Whole-album play is NOT permitted under §114
The album cap (max 3 tracks from same album in 3 hours) specifically prevents whole-album play. Playing a whole album straight through on user request = interactive = requires direct licensing. **This is a feature, not a bug** — the album cap is what forces the "pocket documentary" format.

### 2026 royalty rates (CRB NAB settlement, Federal Register March 2026)
- Nonsubscription: **$0.0028 per performance**
- Subscription: **$0.0032 per performance** (rate being finalized by CRB for 2026–2030)
- Annual minimum: **$1,100 per channel/station**, recoupable, **$110,000 aggregate cap**
- PRO blankets (ASCAP/BMI/SESAC/GMR): ~$300–$5,000/year for small webcasters

### Filings required
- CRB Notice of Use — $50 filing fee
- SoundExchange Minimum Fee Statement of Account — $1,100/channel/year
- PRO blanket applications (ASCAP, BMI, SESAC, GMR)

---

## 3. The Open Question — Channel Reading

**The single swing factor in the plan.** Awaiting written answer from SoundExchange.

- **1-channel reading (Pandora model):** SongHost is one noninteractive webcast service. User search seeds a personalized listening session within that single service. Listener does not receive their own channel. Pay $1,100/year minimum. Bootstrap viable.
- **Per-user-channel reading:** Each user-generated seed station = a channel. Pay $1,100 × N/year, capped at $110,000. Not bootstrap viable at scale.

**Pandora precedent:** Pandora operates thousands of user-generated seed stations as one underlying service, one SoundExchange account. Suggests the 1-channel reading is defensible.

**Status as of Aug 21 2026:** Email sent to licenseerelations@soundexchange.com asking the factual question. Awaiting written reply.

**Fallback if no reply:** File Minimum Fee Statement of account through the wizard (https://licenseedirect.soundexchange.com/wizard), declare 1 channel, pay $1,100. SoundExchange processes in ~5 business days — either accepts (answer: 1 channel) or pushes back (answer: per-user). The form filing forces the answer.

---

## 4. Product Shape — Pandora-Style Personalized Seed Radio

### What search is
Search is a **seed**, not a command. User types "Radiohead" → SongHost generates a station from Radiohead + similar artists (The National, Grizzly Bear, Interpol, etc.). User cannot type "play Karma Police now." The AI curator decides tracks, order, and similar-artist mix.

### What the listener gets
A non-interactive documentary journey through the seed artist's universe — 2-3 tracks from the seed artist, mixed with similar artists, with AI-hosted commentary between tracks. Not an on-demand album play. Not a worse Spotify. A pocket documentary.

### Personalization within the service
- Skip (capped at 6/60min)
- Like / ban tracks (`TrackFeedbackControls`)
- Switch stations (new search)
- No track selection, no order dictation, no on-demand play

### Album Deep Dive format
A special format that plays up to 3 tracks from a single album in 3 hours, mixed with similar artists and commentary. Does NOT play a whole album straight through. Honors album cap and skip cap. Already in `ROADMAP.md` Phase 7.

---

## 4B. BYOS Multi-Transport (Free App, No Catalog, No Royalties) — grounded Aug 22 2026

**Bring Your Own Subscription.** SongHost is a commentary layer that works with the music subscription the listener already has. No walled garden. The platforms provide the catalog and pay the royalties; SongHost provides the AI documentary commentary on top.

**Grounded status:** Spotify BLOCKED (do not build). YouTube = current live dial transport (concessions accepted). Apple = unvetted, the swing transport for pocket mode. The dial already runs YouTube today; BYOS is not a new build from zero — it is a question of which transport adds pocket mode.

### Transports (grounded Aug 22 2026)
| Listener has | Transport | Experience | Status (verified Aug 22 2026) |
|---|---|---|---|
| Spotify Premium | Spotify Web Playback SDK (new adapter) | Ad-free, background play, full catalog, smooth Web Audio ducking | **BLOCKED — do not build** (see Spotify note) |
| Apple Music | MusicKit JS (new adapter) | Ad-free, full catalog, smooth Web Audio ducking | **UNVETTED — needs deep dive** (see Apple note) |
| YouTube (Premium or free) | YouTube IFrame (`useYouTubePlayer.ts`, already live) | Visible video, ads for non-Premium, no background play on mobile | **CONCESSIONS-ONLY — current live state, Larry accepts** (see YouTube note) |
| No premium account | YouTube free (degraded tier) | Ads, no background play | **CONCESSIONS-ONLY — same as above row, this IS the free tier** |

### Why Spotify is BLOCKED (do not regress)
Spotify Web Playback SDK is NOT a viable BYOS transport. Three hard barriers, verified Aug 22 2026:
1. **Dev Mode = 5-user permanent cap.** Spotify Developer Dashboard apps default to Dev Mode, capped at 5 authorized users. No self-serve path to raise this for a Streaming SDA (Streaming SDA = an app that streams music via Spotify's SDK).
2. **Extended Quota Mode is inaccessible for Streaming SDAs.** Extended Quota requires (a) 250K MAU, (b) commercial viability, (c) registered business entity — AND a separate commercial-use approval that Streaming SDAs are categorically barred from. The 250K MAU is a chicken-and-egg wall: cannot reach 250K users while capped at 5.
3. **Commercial use is prohibited for Streaming SDAs.** Spotify's Developer Terms bar Streaming SDAs from any commercial use — including ads, sponsorships, subscriptions, and even voluntary support (Patreon/tips). This kills the free-app monetization model entirely, not just a Pro tier.

**Verdict:** Spotify BYOS is permanently blocked for SongHost's product shape. Do NOT build a Spotify adapter. Do NOT re-examine unless Spotify's Developer Terms change in writing. Prior "VIABLE — primary BYOS transport" status was an under-vetted error; this correction is the verified truth.

### Why Apple is still in play (unvetted)
Apple MusicKit JS is the only remaining major BYOS transport that could serve the pocket-documentary product. It is UNVETTED — the prior quarantine rationales (Section 10 sync clause, mandatory media controls, background suspension) were written for the COMMERCIAL STATUTORY context and have not been re-examined for the free BYOS model. Open questions for the deep dive:
1. **Section 10 sync clause** — does it prohibit layering commentary over Apple Music streams? The "Pavlovian gap" approach (DJ talks in the gap between songs, signaled by intro/outro sounds, NO overlap with music) may sidestep the sync clause entirely. Needs verification against the current Apple Developer Agreement.
2. **Quota / dev-mode caps** — does MusicKit JS have a Spotify-style 5-user cap, or is it open to any Apple Music subscriber? If open, Apple becomes the primary BYOS transport.
3. **Commercial use restrictions** — does the free-app, voluntary-monetization model satisfy Apple's terms, or are sponsorships/Patreon barred like Spotify?
4. **Background play** — does MusicKit JS maintain audio on iOS/Android lock the way a native `<audio playsinline>` element does? This is the pocket-mode question.
5. **Audio element access** — does MusicKit JS expose a real audio element that Web Audio GainNode can duck, or is it a cross-origin iframe like YouTube (no Web Audio tap)?

**Verdict:** Apple is the swing transport for BYOS. If the deep dive clears Section 10 + quota + commercial use, Apple becomes the primary (and possibly only) BYOS pocket-mode transport. If any barrier holds, BYOS narrows to YouTube-concessions-only (no pocket mode on mobile) and the statutory path becomes the only pocket-mode option. **Deep dive is the next blocking task.**

### Why YouTube is OK (concessions accepted, current live state)
YouTube IFrame is the CURRENT live transport on the dial — not a new direction, not a future option. Grok's read-only audit (Aug 22 2026) confirmed: preset stations, Artist Radio, Album Radio, AI Curator, and `/api/station-tracks` all stamp `youtubeId` in production; `AudioPlayer` prefers YouTube over iTunes previews when `youtubeId` is present; `useYouTubePlayer` is a static import, always mounted, not behind the dev flag. Pocket mode is ALREADY BROKEN on the dial (cross-origin iframe, Web Audio can't tap, iOS/Android pause on lock).

Larry accepts the YouTube concessions because:
- The product already runs on YouTube today — this is the baseline, not a downgrade.
- Visible video is acceptable (the dial already uses a hidden offscreen host; making it visible is a UX change, not a policy violation if the player meets Required Minimum Functionality ≥200px×200px).
- Ads for non-Premium listeners are acceptable (YouTube serves them; SongHost does not gate or suppress).
- No pocket mode on mobile is the accepted tradeoff — desktop and foreground mobile listening work; the pocket-documentary format is delivered on the statutory path (DirectStreamProvider + owned catalog) or the Apple path (if vetted).
- YouTube is the FREE tier that needs no listener account or premium subscription to start listening. It is the top-of-funnel, not the destination.

**What is NOT OK with YouTube (do not regress):**
- Do NOT un-quarantine YouTube as a pocket-mode transport. It cannot do pocket mode. Period.
- Do NOT suppress ads, hide the video below Required Minimum Functionality, gate playback behind login/subscription, or charge for YouTube content. All are Developer Policies III.I violations.
- Do NOT rely on YouTube Premium cookie leakage for ad-free — it is not a contract and Chrome third-party cookie phase-out will break it.

**Verdict:** YouTube stays as the free, visible-video, ads-for-non-Premium, no-pocket-mode transport. It is the current live state and the top-of-funnel. Pocket mode is delivered by the statutory path or Apple (if vetted), not YouTube. Full audit: `canvases/youtube-byos-iframe-audit.canvas.tsx`. Policy sources: [Developer Policies](https://developers.google.com/youtube/terms/developer-policies), [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality).

### Revised addressable audience (Spotify blocked, YouTube current, Apple unvetted)
- ~~Spotify Premium: 293M global~~ — **BLOCKED (5-user cap + commercial ban), do not count**
- Apple Music: ~100M (~50M US) — **unvetted, potentially primary if deep dive clears**
- YouTube (Premium + free): ~2.5B global — **current live state, free top-of-funnel, concessions accepted**
- **Realistic BYOS pocket-mode audience: Apple Music ~100M IF vetted. Otherwise YouTube free-tier only (no pocket mode on mobile).**

### Why this path exists
- $0 catalog cost (platforms provide it)
- $0 SoundExchange royalties (platforms pay them)
- No 6-month rip question (no ephemeral copies)
- No $50K raise needed
- Channel-reading question irrelevant (not a §114 webcaster)
- No listener lock-in (works with what they have)

### Unit economics (BYOS, OpenAI tts-1, cached commentary)
- TTS: ~$300–675/month at 100 concurrent (cached by seed+track, not per-listener)
- LLM scripts: ~$200/month
- Hosting: ~$200/month
- **Total fixed: ~$700–1,075/month** — does NOT scale with listener count if commentary cached per-seed

### TTS caching (critical for cost)
Commentary keyed by seed-artist + track. Every listener searching "Radiohead" hears the same Radiohead commentary. 100 listeners on the same station = 1x TTS cost, not 100x. Tradeoff: shared commentary, not personalized per listener — but for a documentary product, shared commentary per seed-artist is the right design (the facts about Radiohead are the same for everyone).

### Revenue (free app, no paywall)
| Source | Realistic monthly at scale | How |
|---|---:|---|
| Patreon / listener support | $1,000–5,000 | SomaFM model; ~22 supporters at $50 = break-even |
| Sponsors / underwriting | $500–3,000 | "Brought to you by" mentions |
| Affiliate (Ticketmaster, Discogs, Amazon) | $50–500 | Contextual liner-note links |
| Tips ("Tip the Host") | $50–300 | Micropayments, $1 min (Stripe fee eats $0.25 tips) |
| **Break-even** | **~$1,400–1,750/month** | ~28–35 Patreon supporters at $50, or mix |

### Engineering (launch order, grounded Aug 22 2026)
1. ~~Spotify Web Playback adapter~~ — **REMOVED (BLOCKED: 5-user cap + commercial ban, see Spotify note above)**
2. **Apple MusicKit deep dive** — blocking research task before any adapter build. If cleared, Apple becomes primary BYOS pocket-mode transport.
3. **Apple MusicKit adapter** (conditional on deep dive) — new build, primary BYOS pocket-mode transport
4. **YouTube IFrame visible-video polish** — the dial already runs YouTube; the work is making the player meet Required Minimum Functionality (visible ≥200px×200px) rather than the current hidden offscreen host. NOT pocket mode. NOT un-quarantine.
5. **Transport selector** — listener connects Apple account (if vetted) or uses YouTube free tier; SongHost picks adapter
6. **Commentary caching layer** — key TTS by seed+track
7. **Freemium funnel** — YouTube free tier IS the funnel (no account needed, ads, no pocket mode). Apple Music (if vetted) is the pocket-mode upgrade. No Spotify.

### Risks
1. ToS risk x2 (YouTube current, Apple unvetted) — YouTube concessions are accepted; Apple risk is unknown until deep dive
2. Commentary quality is the entire moat — if mediocre, no reason to use SongHost over platform AI DJs
3. Platform competition — Spotify has AI DJ, Apple/YouTube testing; defense is commentary depth they won't invest in
4. Engineering complexity — 2 adapters max (Apple + YouTube), not 3 (Spotify removed)
5. Pocket mode is NOT available on the current live dial (YouTube IFrame). This is a known, accepted gap until the statutory path or Apple path ships.

> **RE-EXAMINATION COMPLETE (Aug 22 2026):** The Spotify and Apple quarantine rationales in `docs/SONGHOST MUSIC PROVIDER HISTORY AND ANALYSIS.md` were written for the COMMERCIAL STATUTORY context. Re-examination results:
> - **Spotify:** BLOCKED. The "likely MOOT" hypothesis was WRONG. Spotify's Developer Terms bar Streaming SDAs from commercial use entirely (including voluntary Patreon/tips), AND Dev Mode caps at 5 users with no self-serve path to scale. The free BYOS model does NOT save Spotify — the commercial-use ban is categorical for Streaming SDAs, not just for Pro tiers. Do not revisit unless Spotify's terms change in writing.
> - **Apple:** UNVETTED. The Section 10 sync clause, quota caps, and commercial-use restrictions all need verification against the current Apple Developer Agreement before any adapter build. The Pavlovian gap approach (no music/voice overlap) is the proposed workaround for Section 10 and must be validated. This is the next blocking task.
>
> **Bottom line:** Spotify is dead for BYOS (verified). Apple is the swing (unvetted). YouTube is the current live state (concessions accepted). Do not regress to re-examining Spotify or treating YouTube as a new option.

### Verdict
**Free app, full stop. No Pro tier.** Monetization is voluntary only: Patreon, sponsors, affiliates, tips — none gate playback. Bet is entirely on commentary quality (validated: wife found it refreshing). Tradeoff is platform dependency — tenant, not landlord.

**Grounded transport reality (Aug 22 2026):** The dial already runs YouTube IFrame (free tier, concessions accepted, no pocket mode on mobile). Spotify is BLOCKED — do not build. Apple is the only unvetted swing for BYOS pocket mode. If Apple clears the deep dive, BYOS pocket mode = YouTube free tier (top-of-funnel) + Apple (pocket mode). If Apple blocks, BYOS = YouTube-concessions-only and the statutory path is the only pocket-mode option. Statutory path (§4) is the v2 independence upgrade if BYOS gains traction and SoundExchange reply is favorable.

### Login policy (YouTube vs Apple)
- **YouTube**: login allowed for personalization (saved stations, memory presets, preferences, history) but PROHIBITED for gating playback. Listener must be able to play a track immediately on click with zero login. Clerk auth stays optional for personalization, not required for playback.
- **Apple** (if vetted): login required to access the listener's Apple Music account (that's the transport auth, not a gate). No additional gating restrictions beyond YouTube's. Personalization login same as YouTube — optional, not playback-gating.

### What "free app" means for monetization
- No Pro tier, no paid feature that gates music playback or commentary
- Revenue: Patreon (voluntary support), sponsors/underwriting ("brought to you by"), affiliate links (Ticketmaster, Discogs, Amazon), "Tip the Host" micropayments
- All voluntary, all contextual, none required to use the app

---

## 5. Unit Economics (OpenAI tts-1, 1-channel reading)

### Per-performance royalty (2026)
- Nonsubscription: $0.0028
- Subscription: $0.0032

### Per simultaneous listener per month (heavy user, 2 hrs/day)
- SoundExchange royalty: 240 performances × $0.0028 = **$0.67/listener/month**
- TTS (OpenAI tts-1): 240 breaks × $0.015 = **$3.60/listener/month**
- LLM scripts (GPT-4o-mini): **~$0.50/listener/month**
- Hosting share: **~$1/listener/month**
- **Total per active listener: ~$6–8/listener/month**

### At 100 simultaneous listeners, 1-channel reading
- SoundExchange royalties: ~$3,000/month
- SoundExchange minimum: $92/month ($1,100/year ÷ 12)
- PRO blankets: ~$300/month
- Hosting: ~$200/month
- TTS (OpenAI tts-1): ~$675/month
- LLM scripts: ~$200/month
- Catalog amortization: ~$330/month
- **Total opex: ~$4,200–5,000/month**

### Break-even at ~$4,200–5,000 MRR
- $4.99 Pro: ~850–1,000 Pro subscribers
- Voluntary tip jar (avg $50/supporter): ~85–100 supporters
- Hybrid: ~45 Pro + 40 tip-jar supporters

### If per-user-channel reading
- SoundExchange minimum: $9,166/month (capped at $110K/year)
- **Total opex: ~$13,000/month** — break-even at ~2,600 Pro subscribers. Not bootstrap-viable.

### Catalog CapEx (verified Aug 22 2026, post-second-run)
- Stated flagship canon: **18,300 tracks** (sum of §6 format targets)
- Cheap floor (used CD $0.30 / Bandcamp $5/album / Beatport $1.50): **$7,017** ≤ $10K
- **Recommended path (used CD $0.55 / Bandcamp $7.50/album / Beatport $2.00): $11,805** > $10K by $1,805
- Expensive end of §6 ranges: **$16,593**
- iTunes fill ceiling @ $1/track: **$18,162**
- Free-source tracks passing gates (4 sources, 6,990 fetched): **138** (0.75% of canon) — see §6 note; free sources are discovery tier only
- **$10K covers the cheap floor only. The $1,805 gap to the recommended path is closeable with Adopt-an-Album crowdfunding and CD donations dollar-for-dollar.**
- Amortized over 5 years, $11,805 = ~$197/month — under the $330/month catalog placeholder above.
- Most expensive formats: Electronic $2,380 (Beatport), Rock eras $1,648 (3,000 tracks), Classic rock $1,320 (2,400 tracks).
- Cheapest formats to seed (soft-launch candidates): Punk $603 (8.7% free-seeded), Alt-rock $650 (1.5% free), Jazz $659 (0.2% free).
- **Soft-launch subset option:** 3 cheapest formats (Punk + Alt-rock + Jazz) = ~$1,912 for ~3,600 tracks — well under $10K. Expand to full canon with revenue + Adopt-an-Album. See §12.
- Full data: `docs/CATALOG_ACQUISITION_REPORT.md`

---

## 6. Catalog Acquisition

### Three tiers
1. **Flagship catalog** (hand-curated, ~2,000–5,000 tracks): Canonical albums per station format. Deep lore. Purchased. The "documentary" surface.
2. **Discovery catalog** (AI-curated, ~5,000–10,000 tracks): Sourced from crawlers + Audius + Bandcamp free downloads. Quality-gated. Lighter lore. The "you might also like" surface.
3. **Audius live** (unlimited, real-time): The "search anything indie" surface. No lore, just play.

### Free sources (crawlers, ~20–30% of canonical catalog — UNVERIFIED, see note)
- Internet Archive (Netlabels, Live Music Archive) — CC-licensed, public domain, live concerts
- Free Music Archive (FMA) — curated CC-licensed indie
- Jamendo — CC-licensed indie, has API
- Audius — OML-licensed streams, cacheable with attribution, indie only
- Bandcamp free downloads — name-your-price-$0 tracks
- Musopen — public domain classical recordings

> **NOTE (Aug 22 2026, post-second-run, VERIFIED):** The 20–30% free-source seeding assumption is FALSE. Across 6,990 tracks fetched from 4 sources (Audius 800, Jamendo 5000, Internet Archive 1137, Musopen 53), only **138 tracks passed flagship gates (2.0%)** — all from Jamendo. IA, Musopen, and Audius passed 0%. Free sources seed **0.75%** of the flagship canon (138/18,300), not 20–30%.
>
> **Structural reason:** Free sources (CC/OML/public domain) can seed the independently-released canon (punk, alt-rock, electronic, folk, jazz — thin slices) but CANNOT seed the major-label canon (classic rock, country, R&B, old-school hip-hop, classical) because those rights holders do not free-license. This is a structural limit of free licensing, not a gate-calibration error. The gates are doing their job — keeping quality high. The cost is that free sources contribute little to the flagship canon.
>
> **Revised strategy:** Free sources are the discovery tier (§6 tier 3) only. The flagship canon is paid CapEx + Adopt-an-Album + CD donations. See `docs/CATALOG_ACQUISITION_REPORT.md` for the full data.

### Paid sources (one-time CapEx)
- Used CDs (Discogs) — ~$3–8/CD = ~$0.30–0.80/track
- Beatport downloads — electronic canon only, ~$1.50–2.50/track
- Bandcamp paid — indie canon, ~$5–10/album
- Amazon/iTunes downloads — fill, ~$1/track

### Creative acquisition campaigns
1. **"Adopt an Album" crowdfunding** — listeners fund specific albums into the library. Donor names appear in on-air liner notes. SongHost buys and owns. Community-driven catalog building.
2. **Artist & label direct donation** — artists donate masters, labels donate promo copies (Play MPE model). Free for them, free catalog for SongHost.
3. **Physical CD transfer** — listeners mail physical CDs they own. Ownership transfers with the media. First-sale doctrine. Donor gets liner notes credit.
4. **NOT accepted:** user-uploaded MP3 rips (no distribution rights).

### Catalog size for canonical formats (verified Aug 2026)
- Alt-rock canon: ~100 albums = ~1,200 tracks
- Punk/post-punk canon: ~100 albums = ~1,200 tracks
- Indie rock canon: ~100 albums = ~1,200 tracks
- Classic rock canon: ~200 albums = ~2,400 tracks
- Old-school hip-hop canon: ~100 albums = ~1,200 tracks
- Folk/Americana canon: ~100 albums = ~1,200 tracks
- Jazz canon: ~100 albums = ~1,200 tracks
- Classical: ~200 works, multiple recordings = ~1,500 tracks
- Electronic/EDM canon: ~100 albums = ~1,200 tracks
- Country (all generations — Outlaw, Nashville 70s, 90s neotraditional, Bro-Country, Americana-adjacent): ~150 albums = ~1,800 tracks
- Rock eras (50s rockabilly, 60s British Invasion, 70s stadium, 80s hair metal, 90s grunge, 2000s post-punk revival): ~250 albums = ~3,000 tracks
- R&B/Soul (Motown, Philly, 70s soul, Neo-soul): ~100 albums = ~1,200 tracks
- **Total flagship catalog across all canonical formats: ~1,400–1,800 albums = ~15,000–22,000 tracks**

**Scope rule:** The database analysis covers ALL canonical formats above. The 3-format limit (Classic Rock, Alt/Indie Discovery, Old-School Hip-Hop) applies ONLY to the soft-launch channel selection in §12 step 7 — it is a go-to-market decision, not an analysis decision. The catalog database must reflect the full breadth so the launch decision is made with real numbers.

### Crawler quality gates (critical)
- Last.fm listener counts (>100 plays)
- Audius play counts (>500 plays)
- MusicBrainz rating / tag density
- Genre fit with station formats
- AI curator fit score
- Without quality gates, crawlers give "random crap." With gates, crawlers give a constantly-refreshing curated discovery surface.

---

## 7. TTS Strategy

### Launch: OpenAI tts-1 (no ElevenLabs)
- $0.015/1K chars = ~$0.011–0.017 per 30–45s break
- 9 voices: onyx (male), nova/shimmer (female)
- No SSML; pacing via punctuation. For tone control, gpt-4o-mini-tts ($0.015/min, 13 voices, natural-language "instructions" parameter replaces SSML — "speak in a warm, conversational tone as if introducing a song to a friend")
- Cost at 100 simultaneous listeners: ~$675/month — affordable
- Quality: very good, not quite ElevenLabs but close enough for a documentary host

### Year 2: Self-hosted open source (eliminate per-character cost)
- **Kokoro** (Apache 2.0, MOS 4.2, 82M params, <1GB VRAM) — best naturalness per parameter, commercial-friendly
- **Fish Speech** (Apache 2.0, MOS 4.1, ~4GB VRAM) — strong multilingual voice cloning
- **StyleTTS2** (MIT, MOS ~4.0) — near-human English narration
- Run on a $200–300/month GPU server (H100 or A100 rental)
- Eliminates per-character TTS cost entirely — fixed infrastructure cost
- Tradeoff: GPU ops burden, quality slightly below OpenAI tts-1
- Swap is a backend change (`voice-settings.ts` + `VoiceNode` already abstract the provider)

### The hook is the script + pacing, not the voice
A great script with great pacing on a mid-tier voice beats a generic script on a premium voice. The product is the documentary commentary; the voice is the delivery vehicle.

---

## 8. Competitive Landscape (verified Aug 2026)

### Direct competitor
- **AIRadio (airadiohost.com)** — launched 2024, unfunded/bootstrapped, free iPhone app, 24/7 AI-hosted stations across decades and genres. Built in a weekend as a prototype. They are where SongHost is trying to go. Commentary depth is their weakness.

### Incumbents with distribution
- **Spotify AI DJ** — launched 2023, bundled with Premium ($11.99/mo), Spotify catalog, Sonantic voice. User reception: 34% negative vs 26% positive (SMU 2024 study). Complaints: repetitive commentary, misaligned recommendations, irritating voice, mispronounced names.
- **YouTube AI music hosts** — testing in 2025, augment user playlists with commentary. Limited test, not shipped.

### The wedge
Spotify's AI DJ is a feature bolted onto a streaming product, not the product. AIRadio is a weekend-project-turned-product with no deep lore engine. YouTube is testing, not shipping. **SongHost's "pocket documentary" is the product.** Commentary quality and anti-repetition lore history are the moat.

---

## 9. Customer Segments

| Segment | Listening pattern | Station format | Commentary style | Size |
|---|---|---|---|---|
| Late-night deep listeners | 11pm–3am, 1–2 hr, ambient, deep dives | "Insomniac" — slow, atmospheric, lore-heavy | Soft, slow, long-form | Small but loyal, superfans |
| Road trippers | 2–6 hr, driver + passengers | "Road Trip" — genre-mixed, era-spanning | Energetic, story-driven | Medium, seasonal |
| Offices | 8hr background, low commentary | "Office Hours" — non-distracting | Sparse, short | Large, low willingness to pay |
| Gyms | 1–2 hr high energy | "Workout" — high-BPM | Energetic, short bursts | Medium, willing to pay |
| Music nerds | 1–3 hr deep dives, evenings | "Discogs Mode" — deep cuts, trivia | Dense, fact-heavy | Small, high willingness to pay, superfans |

Music nerds and late-night listeners are the superfans — small in number, high willingness to pay, the adopt-an-album and Patreon-support crowd. Offices and gyms are the volume markets — large in number, lower willingness to pay, but generate the listener-hours that fund the catalog.

---

## 10. Monetization (free app, no Pro tier, no display ads, no gating)

**Free app, full stop.** No Pro tier, no paid feature that gates music or commentary. All monetization is voluntary and contextual — museum gift shop, not billboard.

Ranked by fit with the mission:
1. **Patreon-style "SongHost Supporter"** — voluntary tip jar like SomaFM/Radio Paradise. Average $50/supporter. ~22 supporters = break-even on fixed opex.
2. **Sponsors / underwriting** — "SongHost's classic rock hour is brought to you by [sponsor]" mentions, not ads. $500–3,000/month at scale.
3. **Concert ticket affiliate (Ticketmaster)** — already integrated. Contextual, not interruptive. Listener opts in by clicking.
4. **Vinyl/merch affiliate (Discogs, Bandcamp)** — "This album is available on 180g vinyl" in liner notes.
5. **Book Amazon affiliate** — when the host references a biography, link it.
6. **"Tip the Host" micropayments** — $1 min (Stripe fee eats $0.25 tips). Tip a specific AI host for a great break.
7. **B2B licensing** — sell the AI radio engine to gyms/offices/coffee shops. $99–299/mo per location.
8. **Adopt-an-Album crowdfunding** (statutory v2 only) — community funds catalog additions. Donor names in on-air liner notes.

**Unifying principle:** Every monetization is voluntary (listener chooses to pay, never required) and contextual to the music the listener just heard. Never interruptive, never gating. Museum gift shop, not billboard.

---

## 11. What's Already Built (do not regress)

### Built and live in production
- §114 statutory queue engine (`useStationQueue`, `statutory-rules.ts`, `skip-limiter.ts`)
- ROU logger (`performance-commit.ts`, `user_play_logs`, `export-rou.ts`)
- AI curator (`/api/recommendations`, Last.fm similarity, MusicBrainz ISRC, `factEngine`, anti-repetition lore history)
- Clerk auth, Postgres cloud sync, Free/Pro metering, Stripe Checkout + webhooks, Clean Mode
- PWA installability, Error Boundaries, Health Endpoint
- Station Blueprint Builder (`/studio`), Memory Dial Presets (1–6), Shared Link cards (`/s/[id]`)

### Built but NOT the live dial transport (grounded Aug 22 2026, Grok audit)
- **DirectStreamProvider bus** — built with zero-frame `launchHoldActive` + isolated prefetch buffers, but in production it serves **30-second iTunes previews only** (Song Radio search path). It is NOT the full-length music bus on the dial.
- **Mix-bus sidechain ducking** (DUCK_RATIO 0.18 / 300ms / 1500ms restore) — built, but only reaches DirectStream (Song Radio previews). It does NOT reach the YouTube IFrame on the dial (cross-origin; Web Audio can't tap; only coarse `setVolume` ducking works there).

### The ACTUAL live dial transport (grounded Aug 22 2026)
- **YouTube IFrame** (`useYouTubePlayer` → `YouTubeTrackProvider`) is the live full-length music bus on: preset stations, Artist Radio, Album Radio, AI Curator, and `/api/station-tracks`. Hardcoded `youtubeId`s in `station-seeds.ts` / `extra-genres.ts` / `extra-decades.ts` feed it; ungated `resolveTrackVideoId` stamps ids on the other paths in production.
- `useYouTubePlayer` is a static import, always mounted (`yt-player-host` always rendered), not behind the dev flag. `NEXT_PUBLIC_ENABLE_DEV_TOGGLE` being unset does NOT switch the dial off YouTube — the seeds already have `youtubeId`.
- **Pocket mode is ALREADY BROKEN on the live dial** — cross-origin YouTube IFrame, Web Audio can't tap it, iOS/Android pause on lock. This is the present state, not a future risk.
- Nothing in the live app writes a full-length `streamUrl`. `catalog-tools/` is standalone and does not touch the app. `itunesSongToStationTrack` never writes `streamUrl`. Spotify companion is hard-disabled (`companionActive: false`).

### What this means for the paths
- **YouTube concessions-only is the CURRENT state of the dial**, not a new direction. Keeping it = do nothing. The work is making the player meet Required Minimum Functionality (visible ≥200px×200px).
- **Statutory path requires a transport swap** — switch the dial FROM YouTube IFrame TO DirectStreamProvider with real `streamUrl`s from the owned catalog. This is real engineering, not just CD acquisition.
- **Apple BYOS (if vetted) also requires a transport swap** — from YouTube IFrame to DirectStreamProvider + MusicKit.

---

## 12. Next Steps (as of Aug 22 2026, grounded)

**Strategic direction: FREE APP, no Pro tier.** The dial already runs YouTube IFrame (concessions accepted: visible video, ads for non-Premium, no pocket mode on mobile). The open question is which transport delivers POCKET MODE: the statutory path (DirectStreamProvider + owned catalog) or the Apple BYOS path (if vetted). Spotify is blocked — do not revisit.

### Completed (do not redo)
- **YouTube IFrame audit + policy research — COMPLETE.** YouTube is the current live dial transport, concessions accepted. Not pocket mode. Full audit: `canvases/youtube-byos-iframe-audit.canvas.tsx`.
- **Spotify BYOS deep dive — COMPLETE.** BLOCKED (5-user cap + commercial ban). Do not build a Spotify adapter.
- **Grok runtime code audit (Track 1) — COMPLETE.** Confirmed: dial = YouTube IFrame from hardcoded `youtubeId`s; DirectStreamProvider = 30-sec previews only (Song Radio); pocket mode already broken on dial. See §11.
- **Catalog database — COMPLETE.** `catalog-tools/` retained for v2 statutory path. `docs/CATALOG_ACQUISITION_REPORT.md` generated.

### Blocking tasks (in order)
1. **Apple MusicKit deep dive (GLM 5.2, BLOCKING)** — research the current Apple Developer Agreement: Section 10 sync clause (does the Pavlovian gap approach sidestep it?), quota/dev-mode caps (5-user cap like Spotify, or open?), commercial-use restrictions (Patreon/sponsors OK?), background play (iOS/Android lock), audio element access (real element for Web Audio ducking, or cross-origin iframe?). If cleared → Apple is the primary BYOS pocket-mode transport. If blocked → BYOS narrows to YouTube-concessions-only and the statutory path is the only pocket-mode option.
2. **Await SoundExchange written reply** on channel reading + §112 rip-once retention (email sent Aug 21). Needed for the statutory path decision, not for the YouTube-concessions launch.
3. **Live empirical test (Track 3, manual) — harness shipped Aug 24 2026, results pending.** Header **YT View** toggle (left of FREE MODE) shows or hides the live IFrame in the dock at 320×200 without remounting. Protocol: turn **YT View** on first, then play or skip to a new song. Compare Account A (Premium) vs Account B (no Premium), visible vs hidden. Confirm no ad blocker. Compare video IDs (app prefers Official Audio / Topic). Copy `[YouTubeViewer]` console lines. See `docs/MUSIC_PROVIDER_ANALYSIS_YOUTUBE.md` §10.

### After blocking tasks resolve
4. **Product design review (separate chat, GLM 5.2 + this doc)** — refine the transport UX, transport selector (YouTube free tier + Apple if vetted), login-for-personalization (not gating), commentary caching, search → seed → station flow, Pavlovian gap sound design. Ask questions before implementing.
5. **TTS provider swap (Grok 4.6, after design review)** — replace ElevenLabs with OpenAI tts-1 (onyx + nova) in `voice-settings.ts` and `VoiceNode`. Verify mix-bus ducking still holds on DirectStream. Needed for both paths.
6. **Path decision (after Apple deep dive + SoundExchange reply):**
   - If Apple cleared AND SoundExchange favorable → dual path: YouTube free tier (top-of-funnel) + Apple BYOS (pocket mode) + statutory v2 (independence).
   - If Apple cleared AND SoundExchange unfavorable → BYOS-only: YouTube free tier + Apple BYOS (pocket mode). No statutory v2.
   - If Apple blocked AND SoundExchange favorable → statutory-first: YouTube free tier (interim) + statutory path (pocket mode via owned catalog). Apple dropped.
   - If Apple blocked AND SoundExchange unfavorable → YouTube-concessions-only: free app, no pocket mode on mobile, desktop/foreground only. Pocket documentary delivered on desktop.
7. **Launch (after path decision + design review + TTS swap):**
   - YouTube IFrame visible-video polish (meet Required Minimum Functionality ≥200px×200px) — the dial already runs YouTube; this is UX, not a new transport
   - Apple MusicKit adapter (conditional on deep dive) — new build, pocket-mode transport
   - Commentary caching layer (key TTS by seed+track)
   - Transport selector (YouTube free tier + Apple if vetted)
   - Login optional for personalization (saved stations, preferences), NOT required for playback
   - Launch free with Patreon + affiliates + sponsors + tips (no Pro tier, no gating)
8. **Statutory v2 (if SoundExchange favorable + BYOS gains traction):** catalog acquisition, statutory filings, transport swap from YouTube IFrame to DirectStreamProvider with real `streamUrl`s from owned catalog.

---

## 13. Open Questions

1. **SoundExchange channel reading** — 1 channel or per-user? (awaiting written reply; blocking for statutory path only)
2. **Apple MusicKit viability** — does the deep dive clear Section 10 (Pavlovian gap), quota caps, commercial use, background play, and audio element access? (blocking for BYOS pocket mode)
3. **TTS migration timing** — launch on OpenAI tts-1, migrate to Kokoro in Year 2 or after break-even?
4. **Flagship format count** — 3 channels to soft-launch (Classic Rock, Alt/Indie Discovery, Old-School Hip-Hop) or different 3? (statutory path only)
5. **Geo-fencing** — US-only at launch, or include Canada/EU from day 1?
6. **YouTube visible-video UX** — test harness shipped Aug 24 2026 (**YT View** toggle). Default remains the hidden 320×180 host. Empirical ads result is still open. Do not polish this into a product surface until the test is evaluated.

---

## 14. Model Roles (clarified Aug 21 2026)

- **GLM 5.2 (this model):** Strategic product design review, market analysis, moat definition, unit economics, doc authoring, **bug audit + fix proposal** (writes out the exact code change but does NOT apply it). Never touches `.ts`/`.tsx` files. Fresh chat with this doc attached recovers full context.
- **Cursor Grok 4.6:** Implementation — applies the fixes GLM 5.2 proposes, builds the catalog database, API crawlers, TTS provider swap, statutory filings prep, seed catalog rip/upload scripts. Owns code doc updates (`ARCHITECTURE.md`, `ROADMAP.md`, `AUDIO_ORCHESTRATION_SPEC_2.md`).
- **Gemini Flash 3.6 Extended Learning:** Visual/UX design, design system, component mockups, design review companion to GLM 5.2 strategic chat.

**Split rule:** GLM 5.2 thinks and proposes (strategy, design reasoning, market, moat, bug audit + fix proposal in writing). Cursor Grok 4.6 builds and applies (code, APIs, databases, scripts, applies the fix GLM 5.2 proposed). Gemini Flash 3.6 visualizes (UI mockups, design system). GLM 5.2 never edits code; Grok never reasons about strategy.

**Bug workflow (canonical):**
1. Fresh chat with GLM 5.2 + `STRATEGIC_PLAN_V1.md` + `WORKFLOW.md` + bug description + console log.
2. GLM 5.2 reads the files directly (Read/Grep/Glob in Cursor) and produces a structured audit: exact file paths, line numbers, root cause, Step 2 alignment plan. No relay through Grok — GLM 5.2 has file access.
3. GLM 5.2 writes the proposed surgical fix in the same structured format (SOP rules, tasks with exact modifications, verification requirements). In writing, NOT applied.
4. User approves (or pushes back).
5. Fresh chat with Cursor Grok 4.6 + same files + GLM 5.2's proposed fix.
6. Grok applies the fix, updates code docs (`ARCHITECTURE.md`, `ROADMAP.md`, `AUDIO_ORCHESTRATION_SPEC_2.md`).
7. GLM 5.2 updates strategic docs (`STRATEGIC_PLAN_V1.md`, `WORKFLOW.md`) if the fix has strategic implications.

**Safety valve:** For gnarly audio-engine bugs (DirectStreamProvider FSM, mix-bus sidechain, statutory queue races), user may hand GLM 5.2's audit to Grok 4.6 for a second-opinion pass before Grok applies. Default is GLM 5.2 audits directly; the valve is user-pulled, not automatic.

**Audit quality bar:** GLM 5.2's audit output must match the structure of the prior Gemini-relay prompts — SOP rules, audit targets with file lists, trace steps, required diagnostic output, surgical fix tasks with exact modifications and verification requirements. No vague "around line 955" — exact paths, exact line numbers, root cause, fail-closed fix.
