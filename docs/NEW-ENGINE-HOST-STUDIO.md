# New engine in Host Studio

New is the host a first visit hears. Classic is still in the app. A listener has to choose it.

The host speaks in the quiet between songs. The song then starts at full volume. The host does not talk over the YouTube song.

This file is the current contract for that host. Older notes in `AUDIO_ORCHESTRATION_SPEC_2.md` and `ARCHITECTURE.md` that say Classic is the default, or that Time Capsule speaks two or three facts, are out of date.

## Which engine is on

A brand-new save and a shared link use New (`DEFAULT_DJ_ENGINE` in `src/types/dj.ts`).

Saves from the Classic-default era are moved once, on the account. `DJ_ENGINE_EPOCH` is `2`. If a saved preference has no epoch, or an epoch below 2, the account document’s engine becomes New and the epoch is stamped (`migrateAccountDjEngine` in `src/lib/user/preferences.ts`). That step changes the engine only. Persona, voice, lore, and pace stay as they were. After that stamp, a listener who picks Classic stays on Classic.

An API call is stricter. `resolveDjEngine` enters New only when the body says `"new"`. A missing field stays Classic, so an older client does not flip by accident (`src/types/dj.ts`). The live player sends the listener’s engine.

Free accounts that ask for Roots, Time Capsule, or Director’s Cut are written as Standard (`resolveNewWordsFromBody` in `src/lib/dj/wordsEngine/handleRequest.ts`).

## Pipeline

One break is built while the song is still playing, or in the gap if it is not ready yet.

| Step | File | What it does |
|---|---|---|
| Fact sheet | `src/lib/dj/wordsEngine/sheet.ts` | Looks up this song and the next song. Stops waiting and keeps whatever is already true. |
| Fact budget | `src/lib/dj/wordsEngine/factPack.ts` | Picks what this break may teach, in priority order. |
| Prompt | `src/lib/dj/wordsEngine/prompt.ts` | Tells the writer to sound like a person who loves this music, to say one true fact, and that a short reaction is allowed. Praise stated as fact is banned. |
| Gate | `src/lib/dj/wordsEngine/gate.ts` | Rejects a line that invents a name, misses the shape, or states unsourced praise as fact. A short reaction such as “I love this one” passes. |
| Compose | `src/lib/dj/wordsEngine/compose.ts` | If the writer’s line already passes, that line is spoken. Otherwise the fact and a short reaction are kept, and the show adds the song name. |
| Voice | `src/lib/dj/wordsEngine/synthesize.ts` | Asks `/api/generate-script` for the words, then `/api/generate-voice` for the clip. |
| Playback | `src/lib/dj/wordsEngine/playNewBreak.ts` | Plays the chime only when the line has a real fact, then the speech. The caller starts the song at 100%. |

`resolveNewWordsFromBody` in `handleRequest.ts` runs sheet, pack, prompt, one write, one retry, then compose. `/api/generate-script` calls it when `djEngine` is `"new"`.

A gap waits about 1 second (`SHEET_GAP_WAIT_MS` is 1000). A warmup while the song is still playing waits up to 20 seconds (`SHEET_WARM_WAIT_MS` is 20000). The lookup keeps going in the background after the wait.

Song 1 does not use this fact writer. See below.

## Fact sources

The sheet may use only what these lookups return. Nothing is invented.

**MusicBrainz.** The artist is locked to a MusicBrainz id before the recording is looked up (`fillBand` then `fillSong` in `sheet.ts`). Requests are at least 1.1 seconds apart (`MIN_INTERVAL_MS` in `src/lib/catalog/musicbrainz.ts`). The recording lookup asks for an official studio master (`studioMaster: true`). Live recordings and bootlegs are skipped. A place whose name is an arena, hall, stadium, or similar live room is not stored as “recorded at” (`isLiveVenueName` in `src/lib/catalog/recordingPlace.ts`). Credits are kept when the recording is on the album already known for the track. A credit whose role is only the word “instrument” is dropped. A parenthetical such as “(drum set)” is not spoken.

**Wikidata.** Band facts, a member’s siblings when both people are in the band, and a person’s origin when the artist is a person (`wiki.ts`, called from `sheet.ts`).

**Wikipedia.** The lead of the page, plus the sections that carry a story, are mined into short claims. A band page keeps formation, members, and history. An album or song page keeps background, writing, recording, meaning, reception, and chart notes. The paragraph itself is not stored (`relevantProse` and `claimsFromProse`). A song page that is about someone else only keeps sentences that name this artist. A film or TV credit keeps the title and stops before “and on episodes…”. A nationality in front of a writer’s name is not spoken as the writer.

**iTunes.** Release year, album title, and track number, used when the row and MusicBrainz did not already supply them (`fillSong` in `sheet.ts`). The track number stays on the sheet as support. The gate does not let the host say “track 12”.

**Cache.** Sheets live in memory for this server process. The band sheet is reused by MusicBrainz artist id. A song job is reused by artist, title, and album (`sheet.ts`). The station also remembers, in that same kind of map, the facts already used (one id per real fact, so “Long Pond” and “Long Pond studio” are the same, and “wrote the lyrics” and “has written lyrics” are the same), the connector phrases already used, the sentence shapes already used, and the kind of fact from the last few breaks (`stationMemory.ts`). A tease spends its fact in the gate, not only in the prompt. The next break does not say it again. The browser sends that list back, because the next request may hit another server. None of this is written to a database.

Genre tags and era tags are not facts.

## How a fact is worded

The writer does not get a template to finish. Each fact is already a normal sentence, or a clean field, before the prompt is built (`claims.ts`, `factPack.ts`).

An album number is a word inside that sentence, with the full album title: “Their ninth studio album is First Two Pages of Frankenstein.” The sheet only keeps that sentence when the Wikipedia line starts with this album’s title, so “eighth” cannot be stuck onto the ninth album. A last-word shortcut (“Frankenstein is the ninth”, “Find is the eighth”) is not stored.

A label line and a bare “X produced it” are not the fact on their own. A producer can be the one fact only when the sheet has no guest, story, or player, or the second fact when it is the same person as the first.

## What gets picked

`leadRank` in `factPack.ts` decides the order. A thin fact never jumps ahead of a real story, even when the last few breaks used that kind of story. The kinds are people, the song’s story, the album’s story, a place, a chart or single, a collaboration, and something you can hear. The last three breaks are the ones that count, inside the facts that are actually worth saying.

1. The featured guest on this track. A “(feat. …)” in the title counts.
2. The song’s story, then the album’s story (where it was recorded, what the album is, how it came to be).
3. A person with a story. A founding member who left comes after the song’s own story, and is not spoken as someone you will hear on this track.
4. Hometown, or where and when the band formed. A player on this track can be the fact when nothing above is left.
5. Last resort, and only when nothing above is left: a release year on its own, “is the musician behind it,” or a bare credit with no story.
6. A label is never the fact by itself.

A credit is spoken as a sentence. “William Swan plays the trumpet on this one.” The sheet does not say “is credited on Soul Meets Body for trumpet.”

A fact already used on this station is not picked again. A tease spends its fact as soon as it is spoken, including a paraphrase (“wrote the lyrics” and “has written lyrics” are one fact, and “Gibbard wrote” is the same fact as “Ben Gibbard wrote”). A different first name is a different fact: Aaron Dessner and Bryce Dessner do not block each other. Director’s Cut may keep a second fact only when it is the same person or the same place as the first. Otherwise the break teaches one fact.

## The gate

A line is kept only if `scriptPassesGate` accepts it.

- A capitalized name that is not ordinary speech must already be on this song’s sheet or the next song’s sheet, including the tease and the payoff. A name from a sheet fact this break did not pick fails.
- A year, a number, or an instrument must be on those sheets. A track number in the spoken line fails.
- When the break is teaching a fact, the line names the upcoming song somewhere and, if a tease is listed, ends on that tease (`threeBeatsHold`). It may end on the fact. Director’s Cut may run to 5 sentences. Other depths stop at 4.
- Each persona has a required move (`personaMoveHolds`). Catchphrases “listen for this”, “worth your ear”, and “hold onto this” fail.
- A tease may promise only a fact already on the next song’s sheet. The last sentence is a hook that starts with “Stick around”. “After that, <fact>” fails. “Up next” may name only the song that is about to play. The teased fact is marked used before the next break is planned. The gate rejects the next break if it says that fact again, including a paraphrase.
- Broken ordinals fail: “the number of the album is eighth”, “album number”, “this is album number ninth”.
- An album title in the line has to be the full title on the sheet. “Frankenstein is the ninth studio album” fails when the sheet says “First Two Pages of Frankenstein”.
- Label praise and press-kit praise fail even as glue: “recognized for”, “known for its”, “influential roster”, “acclaimed”, “critically acclaimed”, “legendary”, “one of the greatest”, “iconic”.
- A short reaction in the DJ’s own voice passes: “I love this one”, “turn this up”. That is a feeling, not a fact. It may not smuggle a new name, year, place, or instrument. Saying it again on a later break is allowed. It is not a fact this station has to retire.
- “You’ll hear” is only for a sound on this track. A member who left, and a guest who is only on the album, are not spoken that way.
- Two credit sentences with no link (“same”, “who”, “also”, “while”, “where”, “because”) fail.
- Press-kit and filler words are banned even as glue. The list in the prompt includes unique, resonates, showcasing, talents, depth, iconic, groundbreaking, timeless, journey, vibe, haunting, soundscape, and the longer set in `buildNewWordsPrompt` (evolution, growth, milestone, distinctive, and the rest). The old Guide closer is also banned: “when the song opens”, “because that is the part to hear”, “so listen for”.
- These closers are banned even once: “That’s the part worth knowing”, “That’s the record this song is on”, “That’s where they got started”, “which is where you’ll find this track”. Any other connector sentence used earlier on this station fails.
- A sentence that is only the artist, only the title, or only “Title by Artist” fails.
- A hearable cue is woven into the fact sentence (“that’s the trumpet you’ll hear”). A sentence that is only “Hear the trumpet.” or “Listen for the guitar.” fails. A studio, a label, a year, an album, or the bare word “instrument” still cannot be a listen-for.
- “The song is X, from Y” fails. “X is credited on Y for Z” fails.
- Each spoken sentence is reduced to a shape: names, titles, and numbers become a blank. A shape already used on this station fails. The writer gets one retry. If that also fails, `oneFactLine` speaks one true sentence that follows the same rules.

## How many facts

| Depth | Featured facts |
|---|---|
| Standard | None. Title and artist only. At most 32 words. |
| Roots & Branches | One surprise. 12–50 words when a story fact exists. At most 40 words when it does not. |
| Sonic Time Capsule | One surprise. Same word window as Roots. |
| Director’s Cut | At most two featured facts, still one arc. The second fact has to be the same person or the same place as the first. An album title is not that link. Otherwise only one fact is spoken. Word window is 12–75 when the sheet has some story, 12–90 when it has four or more story claims, and at most 40 when it has none. The floor is one true telling. A long sheet does not force a longer line. |

The caps are `NUGGET_CAP` and `lengthFor` in `factPack.ts`. The prompt tells the writer to keep it short and stop when the fact is told. Director’s Cut may be two or three sentences. A thin sheet is not padded (`minWords` is 0 when there is no story fact).

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
| The Guide | `warm-companion` | People and the story. If the fact is something you can hear, that cue stays inside the fact sentence. |
| The Critic | `sarcastic-critic` | One fair judgment tied to a player, instrument, producer, or studio on the sheet. Said like a person. The gate does not require the words “earns” or “holds”. |
| The Archivist | `the-musicologist` | Lineage: where this sits, who is credited, or what came before. The gate does not require the word “lineage”. |
| Standard Broadcast | `standard-broadcast` | One strong fact, then a clean handoff. A short reaction is allowed. |

Guide’s five shapes rotate with `shapeVariant` (`prompt.ts`). The title line is optional. “Here’s Title.” is only one of the five, and a station does not use that shape twice. The other shapes open on the fact, on “Coming up,” or on “Up next,” and they can end on the fact or on the tease. None of them is “The song is X, from Y.”

A hearable cue (an instrument, a guest’s voice, or part of the arrangement) is part of the fact sentence. A studio, a label, a year, and an album are not sounds. Guide does not say “the album number is ninth” or “4AD is the label here.”

The writer is told to sound like a person who loves this music, telling a friend one true thing. A short reaction is part of that voice. Six example breaks in the prompt are about other songs, and the writer is told not to copy those names or that wording. The draft is a legal line the writer may say in their own voice. The five shapes still rotate when the show has to finish a line, and any shape already spoken on this station is rejected.

## What gets spoken

If the writer’s line already passes the gate, that line is what airs (`airedDraft` in `handleRequest.ts`). The show does not rebuild it.

If it does not pass, `prepareWriterLine` keeps the sentences that carry the fact, and one short reaction (“I love this one”, “turn this up”) when the writer wrote one. It drops a sentence that is only color (“you can hear his work”). The show then adds the song-name line and, when there is one, the next-song tease, from shapes this station has not used. A sentence that is only the artist or the title is not kept. A copied tease is replaced so it stays last. If the fact’s usual sentence shape was already used, the same fact is said in a new sentence that keeps the verb (`freshFactSentence` in `variety.ts`). `composeNewBreak` keeps a passing line. It does not add a station label. “The song is X, from Y” is not used. A “(feat. …)” in the title is not spoken. The guest is the fact instead. A station name that contains a colon, such as “Artist Radio: The National”, is not read on a fact break. Song 1’s welcome still uses the station name. A real stinger can still say a station name that has no colon.

The writer gets one retry. The retry names the failed rule, the sentence, and the one change. It does not say “try again,” and it does not hand back a line that already failed. If both drafts fail, the fallback is still a full break: the fact, the song name, and the tease when there is one.

On 8 Oct 2026 a live sample of 40 Guide breaks, Roots depth, across rock, hip-hop, pop, country, jazz, classical, electronic, metal, R&B, K-pop, Latin, oldies, folk, indie, and two thin sheets: 19 passed on the first write, 1 retried, 20 fell back. Six of the fallbacks came back blank because the last-resort line was an empty string once every sentence shape had been used. That blank is fixed: the host still names the song. The breaks that passed sound like a person (“I love this one. Buckingham wrote Go Your Own Way.”). The ones that fell back are still a fact plus a handoff. “I love this one” shows up often. Some facts are thin (a birthplace, a member who left) or clipped (“is about an illiterate”). A classical year can be a later recording (“Clair de Lune came out in 2003”).

## Writer and voice

Every New depth is written by `gpt-4o-mini` (`newWordsWriterModel` in `handleRequest.ts`) at temperature 0.55, so the line is not a copy of the fact sentence. A switch to `gpt-4.1-mini` for Director’s Cut only exists as `DIRECTORS_CUT_WRITER_MODEL`. It is `null`, so it is off.

The cloud voice is OpenAI `gpt-4o-mini-tts` (`OPENAI_TTS_MODEL` in `src/lib/tts.ts`, used by `/api/generate-voice`). Host Studio can still pick a laptop voice slot. That path is separate. ElevenLabs remains in the voice route and is not the New writer’s model.

## Earcons

The lore chime plays only when the spoken line uses a real fact (`newBreakWantsEarcon` in `playNewBreak.ts`). A names-only line, an identity-only line, and an ungrounded mood line do not get the chime. Weather, concert, and teaser cues are unchanged.

## What is not done yet

Verified against the code on Oct 8 2026. These are gaps, not plans.

- Spoken lines can still add a compliment the gate does not list. “Legendary”, “critically acclaimed”, and “one of the greatest” are now on the list. Other praise words can still slip through.
- The fallback still exists if both drafts fail. On the 8 Oct 2026 sample of 40 breaks it was used 20 times. Six of those were blank before the empty-string fix. A fallback is still a fact plus a handoff, not the writer’s own line.
- A sheet with no story fact becomes a short identity line. Rosyln’s sheet was only the 2009 release, so the year was the right last resort. There is no second source that fills a thin sheet.
- Tours, reviews, and interviews are not sources. The sheet builders call MusicBrainz, Wikidata, Wikipedia, and iTunes. A Wikipedia sentence about a tour is dropped (`sheetCraft` test: “hard tour” is not kept).
- Fact sheets and the station’s spoken-fact list are in-memory maps. They are not saved to a database. A new server process starts empty. The browser does send the spoken list back on the next break.
- One next-song promise can be paid off on the following song (`openTease` in `stationMemory.ts`). Paying it off means a new fact, not a repeat of the tease. There is no longer arc that sets up a fact on break one and pays it off several songs later.
- Automated tests, Vitest, Oct 8 2026: **0 failed, 1417 passed, 21 skipped** (1438 tests). 104 files passed, 1 skipped (105 files). The live proof stays skipped unless `NEW_HOST_PROOF=1`. Lint and the production build both completed with no errors. Existing warnings in other files were already there.
