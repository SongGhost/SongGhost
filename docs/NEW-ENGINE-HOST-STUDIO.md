# New engine in Host Studio

New is the host a first visit hears. Classic is still in the app. A listener has to choose it.

The host speaks in the quiet between songs. The song then starts at full volume. The host does not talk over the YouTube song.

This file is the current contract for that host. Older notes in `AUDIO_ORCHESTRATION_SPEC_2.md` and `ARCHITECTURE.md` that say Classic is the default, or that Time Capsule speaks two or three facts, are out of date.

## Which engine is on

A brand-new save and a shared link use New (`DEFAULT_DJ_ENGINE` in `src/types/dj.ts`).

Saves from the Classic-default era are moved once. `DJ_ENGINE_EPOCH` is `2`. If a saved preference has no epoch, or an epoch below 2, `resolveListenerDjEngine` returns New and the save is stamped with epoch 2 (`src/lib/user/preferences.ts`). After that stamp, a listener who picks Classic stays on Classic.

An API call is stricter. `resolveDjEngine` enters New only when the body says `"new"`. A missing field stays Classic, so an older client does not flip by accident (`src/types/dj.ts`). The live player sends the listener’s engine.

Free accounts that ask for Roots, Time Capsule, or Director’s Cut are written as Standard (`resolveNewWordsFromBody` in `src/lib/dj/wordsEngine/handleRequest.ts`).

## Pipeline

One break is built while the song is still playing, or in the gap if it is not ready yet.

| Step | File | What it does |
|---|---|---|
| Fact sheet | `src/lib/dj/wordsEngine/sheet.ts` | Looks up this song and the next song. Stops waiting and keeps whatever is already true. |
| Fact budget | `src/lib/dj/wordsEngine/factPack.ts` | Picks the one surprise this break may teach. |
| Prompt | `src/lib/dj/wordsEngine/prompt.ts` | Tells the writer the sheet, the persona, the shape, and the banned words. |
| Gate | `src/lib/dj/wordsEngine/gate.ts` | Rejects a line that invents a name, misses the shape, or uses a banned phrase. |
| Compose | `src/lib/dj/wordsEngine/compose.ts` | Keeps a line that passed. Otherwise speaks one true sentence. |
| Voice | `src/lib/dj/wordsEngine/synthesize.ts` | Asks `/api/generate-script` for the words, then `/api/generate-voice` for the clip. |
| Playback | `src/lib/dj/wordsEngine/playNewBreak.ts` | Plays the chime only when the line has a real fact, then the speech. The caller starts the song at 100%. |

`resolveNewWordsFromBody` in `handleRequest.ts` runs sheet, pack, prompt, one write, one retry, then compose. `/api/generate-script` calls it when `djEngine` is `"new"`.

A gap waits about 1 second (`SHEET_GAP_WAIT_MS` is 1000). A warmup while the song is still playing waits up to 20 seconds (`SHEET_WARM_WAIT_MS` is 20000). The lookup keeps going in the background after the wait.

Song 1 does not use this fact writer. See below.

## Fact sources

The sheet may use only what these lookups return. Nothing is invented.

**MusicBrainz.** The artist is locked to a MusicBrainz id before the recording is looked up (`fillBand` then `fillSong` in `sheet.ts`). Requests are at least 1.1 seconds apart (`MIN_INTERVAL_MS` in `src/lib/catalog/musicbrainz.ts`). The recording lookup asks for an official studio master (`studioMaster: true`). Live recordings and bootlegs are skipped. A place whose name is an arena, hall, stadium, or similar live room is not stored as “recorded at” (`isLiveVenueName` in `src/lib/catalog/recordingPlace.ts`). Credits are kept when the recording is on the album already known for the track.

**Wikidata.** Band facts, and a person’s origin when the artist is a person (`wiki.ts`, called from `sheet.ts`).

**Wikipedia.** The page summary is mined into short claims. The paragraph itself is not stored (`claimsFromProse` in `src/lib/dj/wordsEngine/claims.ts`). A song page that is about someone else only keeps sentences that name this artist.

**iTunes.** Release year, album title, and track number, used when the row and MusicBrainz did not already supply them (`fillSong` in `sheet.ts`). The track number stays on the sheet as support. The gate does not let the host say “track 12”.

**Cache.** Sheets live in memory for this server process. The band sheet is reused by MusicBrainz artist id. A song job is reused by artist, title, and album (`sheet.ts`). What this station has already said, and one open next-song promise, is also an in-memory map keyed by station id (`stationMemory.ts`). The browser sends that list back, because the next request may hit another server. None of this is written to a database.

Genre tags and era tags are not facts.

## The gate

A line is kept only if `scriptPassesGate` accepts it.

- A capitalized name that is not ordinary speech must already be on this song’s sheet or the next song’s sheet, including the tease and the payoff.
- A year, a number, or an instrument must be on those sheets. A track number in the spoken line fails.
- When the break is teaching a fact, the line needs a hook, the fact, and a last sentence that names the upcoming song or pays off the next-song promise (`threeBeatsHold`). Director’s Cut may run to 5 sentences. Other depths stop at 4. At least 3 sentences when a fact is required.
- Each persona has a required move (`personaMoveHolds`). Catchphrases “listen for this”, “worth your ear”, and “hold onto this” fail.
- A tease may promise only a fact already on the next song’s sheet. “Up next” may name only the song that is about to play. The following song is “after that”.
- Press-kit and filler words are banned even as glue. The list in the prompt includes unique, resonates, showcasing, talents, depth, iconic, groundbreaking, timeless, journey, vibe, haunting, soundscape, and the longer set in `buildNewWordsPrompt` (evolution, growth, milestone, distinctive, and the rest). The old Guide closer is also banned: “when the song opens”, “because that is the part to hear”, “so listen for”.
- The writer gets one retry with a repair note. If that also fails, `oneFactLine` speaks one true sentence from the sheet, or a short identity line when the sheet has no story fact.

## How many facts

| Depth | Featured facts |
|---|---|
| Standard | None. Title and artist only. At most 32 words. |
| Roots & Branches | One surprise. 12–50 words when a story fact exists. At most 40 words when it does not. |
| Sonic Time Capsule | One surprise. Same word window as Roots. |
| Director’s Cut | At most two featured facts, still one arc. A second fact has to be a different kind of surprise. A credit counts as one, even here. Word window is 22–75 when the sheet has some story, 28–90 when it has four or more story claims, and at most 40 when it has none. |

The caps are `NUGGET_CAP` and `lengthFor` in `factPack.ts`. The prompt aims Director’s Cut at about 20–30 seconds, and Roots or Time Capsule at about 12–20 seconds. A thin sheet is not padded up to those aims (`minWords` is 0 when there is no story fact).

“That was” is allowed only on the break that airs when song 1 ends (`songOneExit`: the first-playlist flag, and not the session opener). Later breaks that say “That was” or “You just heard” fail the gate. Director’s Cut may add one album fact about that finished song, and only if the album is already on the row. No lookup for that past line.

## Song 1 welcome

Song 1 is a short station welcome from the existing templates (`stationWelcomeLine` → `getStationLaunchClips` in `src/lib/dj/scriptGenerator.ts`). It is not a fact break. No earcon. `playNewBreak` refuses a session opener so this liner stays on its own path.

Music Only never gets it (`hostOn` is false when chatter is `music_only`).

The welcome is spent only after it airs. These aborts do not spend it: `stall_skip`, `station_change`, `track_change`, `superseded`, `queue_advance` (`openingWelcomeStillOwed` in `src/lib/player/openingWelcome.ts`). The next song that actually plays still gets the welcome once.

A play/pause flicker must not cut the welcome off. While the opener is speaking and has not aired, `welcomeSpeechStillOnAir` stops `startSongAtFullVolume` from treating a YouTube playing-to-paused blip as the end of the liner (`AudioPlayer.tsx`).

## Personas

Guide, Critic, Archivist, and Standard Broadcast are postures. They are not catchphrases.

| Listener name | Id | Required move |
|---|---|---|
| The Guide | `warm-companion` | People and the story. A listen-for only when the fact is something you can hear. |
| The Critic | `sarcastic-critic` | One fair judgment (works, earns, thin, holds, lands) tied to a player, instrument, producer, or studio on the sheet. |
| The Archivist | `the-musicologist` | Lineage: where this sits, who is credited, or what came before. |
| Standard Broadcast | `standard-broadcast` | One strong fact, then a clean handoff. No invitation and no taste note. |

Guide’s five shapes rotate with `shapeVariant` (`prompt.ts`):

1. Open on the fact, then why it matters, then name the song.
2. Name the song first, then the fact, then why.
3. Up next and the song name, then why, then the fact.
4. Open on the artist, then the fact, then why, and name the song at the end.
5. Open on why the fact matters, then the fact, then name the song.

“Listen for”, “notice how”, or “hear” is allowed only when the featured fact has a hearable cue: an instrument, a guest, or the place the record was made (`earCue`). A hometown or a formed-in city is not a listen-for. If there is no hearable cue, Guide names the person or the story and must not invent a listen-for.

## Writer and voice

Every New depth is written by `gpt-4o-mini` (`newWordsWriterModel` in `handleRequest.ts`). A switch to `gpt-4.1-mini` for Director’s Cut only exists as `DIRECTORS_CUT_WRITER_MODEL`. It is `null`, so it is off.

The cloud voice is OpenAI `gpt-4o-mini-tts` (`OPENAI_TTS_MODEL` in `src/lib/tts.ts`, used by `/api/generate-voice`). Host Studio can still pick a laptop voice slot. That path is separate. ElevenLabs remains in the voice route and is not the New writer’s model.

## Earcons

The lore chime plays only when the spoken line uses a real fact (`newBreakWantsEarcon` in `playNewBreak.ts`). A names-only line, an identity-only line, and an ungrounded mood line do not get the chime. Weather, concert, and teaser cues are unchanged.

## What is not done yet

Verified against the code on Oct 7 2026. These are gaps, not plans.

- Spoken lines can still be stiff. The gate blocks a list of press-kit words and one old Guide closer. It does not score whether a passing line sounds like a person.
- The writer gets one retry, then a one-sentence fallback. How often that retry fires on real stations was not measured here.
- A sheet with no story fact becomes a short identity line. Some songs will only have a year, an album, or a track number. There is no second source that fills a thin sheet.
- Tours, reviews, and interviews are not sources. The sheet builders call MusicBrainz, Wikidata, Wikipedia, and iTunes. A Wikipedia sentence about a tour is dropped (`sheetCraft` test: “hard tour” is not kept).
- Fact sheets and the station’s spoken-fact list are in-memory maps. They are not saved to a database. A new server process starts empty. The browser does send the spoken list back on the next break.
- One next-song promise can be paid off on the following song (`openTease` in `stationMemory.ts`). There is no longer arc that sets up a fact on break one and pays it off several songs later.
- Automated tests, Vitest, Oct 7 2026: **5 failed, 1357 passed, 17 skipped** (1379 tests). 2 files failed, 99 passed, 1 skipped (102 files).
  - `src/data/__tests__/station-seeds.test.ts` — “labels a shared video the same way in every pool”: YouTube id `EaTjt_iIs2s` is “Erik Satie — Gymnopédie No. 1” in ambient-meditation and “Satie — Gymnopédie No. 1” in another pool.
  - `src/data/__tests__/station-seeds.test.ts` — “falls back for a station that has not been curated to depth”: `classical-masters` now has its own pool, so `seedTracksFor` does not return the fallback.
  - `src/lib/dj/__tests__/breakPlayheadGate.test.ts` — three cases (“still plays the New break when the queue moves…”, “plans one Every Song break, chime plus one line…”, “still reaches the same break when a playlist chip…”). They play a New break whose script is “One spoken line.” and do not set `includesRealFact`. The chime spy is called 0 times. The code plays the lore chime only when the line has a real fact.
