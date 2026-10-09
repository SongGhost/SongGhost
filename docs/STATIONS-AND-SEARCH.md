# Stations and search

How a listener starts a station from search, and how a song is allowed to play. Checked against the code on Oct 9 2026.

## Artist Radio

Artist Radio is mode `mixed` on `/api/artist-radio`. The pill says **Artist Radio**. **Artist only** is mode `artist-only`: that artist, no neighbors.

A wide station is about 50 songs (`MIX_STATION_SIZE`). Song 1 is the song they tapped, or one strong song by the artist. The seed artist returns through the hour (8 songs, including song 1). Closer artists get more songs. Deeper artists get one.

| Tier | Artists | Songs each | Songs |
|---|---|---|---|
| Seed artist | 1 | 8, including song 1 | 8 |
| Closest | 6 | 3 | 18 |
| Strong peers | 8 | 2 | 16 |
| Deeper acts | 8 | 1 | 8 |

The list is woven. Seed songs land about every six positions. The same artist does not play twice in a row. Neighbors do not open the show.

Neighbors come from one `gpt-4o` judgment of Last.fm similar artists (`assembleMixNeighbors` in `src/lib/mix-neighbors.ts`). Last.fm is evidence of who listeners also play. The model can drop a high score that fails the sound, and it can add a real collaborator Last.fm missed. A name stays when iTunes has a real song and the genre is not a hard world clash (hip-hop against alternative, and the same split for country, jazz, classical, metal, and electronic). A missing genre tag does not drop the name. There is no 18-year wall and no single rock bucket.

The pool is cached for 7 days. The next launch of the same artist keeps 3 of the closest names, replaces the other closest, and moves the deeper shelf the most. The hour is not identical. It stays in the same world.

If the model or Last.fm fails, the station plays Last.fm names with a match of at least 0.4, then the curated anchors. A shorter honest station is allowed. It is not padded with strangers.

Songs are Last.fm top tracks that clear 20% of that artist's number one (`fetchLastFmTopTracks` and `filterGreatSongs`). iTunes confirms the recording. YouTube plays it. If Last.fm has no tracks, iTunes search fills in.

The click starts on beat 1: song 1, plus the next songs that resolve within 8 seconds after the artist list is known (at least the following 14 when they are ready). The rest of the same planned titles arrive as beat 2 and are appended. Song 1 does not move. If beat 2 fails, the songs already playing are the station. A cold `gpt-4o` call can take about 12 seconds. The search label says it is building the neighborhood.

Asking again sends the stored pool, so a fresh tab does not call the model when that pool is still inside 7 days and has at least 12 names.

## Artist only

Artist only is mode `artist-only`. The queue is that artist. Neighbors are not added. A picked song is still song 1. The rest comes from that artist's great songs, shuffled, capped at 30.

## AI Curator

A prompt that names one artist ("The National", "artists like The National") uses that artist's neighborhood and the same 50-song weave. A scene or genre ("90s Atlanta hip-hop") asks `gpt-4o` for artists with the same four vectors. No artist gets 8 songs. The closest get 3, peers get 2, and the rest get 1. Every song has to match an iTunes recording. A short list is allowed, and the description says so.

## A song row in search

In the Songs list (`SongResultRow` in `src/components/search/SmartSearchBar.tsx`):

- Tapping the row starts Artist Radio. That is `launchSeededSong` with mode `mixed`. The station label is "{title} Radio". The picked song is first. The National (or whoever) comes back later in the hour, not as a block.
- The "Artist only" chip starts mode `artist-only`. The label is "{artist} only". The picked song is first. Every other song is that artist.

An artist row works the same way. The row starts Artist Radio. The **Artist only** button starts artist-only. The button takes the click. The row does not follow the pill.

`launchSeededSong` calls the same artist-radio URL the artist buttons use, with `seedTitle` and the iTunes track id when the search row has one.

## `/api/song-radio`

This route no longer builds its own Last.fm mix. It forwards to `/api/artist-radio` (`src/app/api/song-radio/route.ts`).

- `artist` is passed through.
- `seedTitle` wins; otherwise the `title` query is the seed.
- `mode` is `artist-only` only when the query says `artist-only`. Anything else becomes `mixed`.
- `itunesTrackId`, `excludeNeighbors`, `excludeYoutubeIds`, and `exclude` are forwarded when present.

Search Songs / Radio / Artist only call `/api/artist-radio` directly. The song-radio URL is the old entry that now lands on the same builder.

## Songs filter

The Songs filter pages until that artist’s catalog is used up, then opens a “Similar artists” section (`src/lib/song-search-catalog.ts`, `/api/search/songs`).

One page is 25 songs (`SONG_PAGE_SIZE`). The first page is one iTunes search window. Later pages walk, in order:

1. iTunes search, until offset 1000 or Apple stops returning rows.
2. iTunes lookup by artist id (at most 200 songs, no offset).
3. MusicBrainz recording browse (100 per request) after the iTunes caps.
4. Neighbor songs from the stored neighborhood pool. This phase sets `similarOpen`. The UI heading is “Similar artists”. It does not start a new model pass.

`exhausted` is true when the cursor phase is `done`. `similarOpen` is true once neighbor songs have started, including after the list is finished.

## Playback

Album-art YouTube uploads play. YouTube error 5 is an HTML5 complaint on a still cover plus audio. It is not a reason to skip. Error 153 (missing embedder identity) is not a dead id either.

These codes skip the video: 2, 100, 101, and 150 (`youtubeErrorIsTerminal` in `src/lib/audio/opener-ready.ts`).

A video that never becomes playable is skipped after 20 seconds (`FAIR_LOAD_MS` is 20000). A still cover with a real duration is loaded media. It is not an instant skip. A listener who paused is not treated as a dead video (`stallSkipWhileOpening`).

Refresh, pause, and sticky start (`mayStartMusic` in `src/lib/player/playback-gate.ts`, from `b6e89bf`):

- Refresh may show the last station. It is not Play. Hydrate, video load, two-ahead warmup, and ensure-playback do not start music.
- Pause stays paused until the listener hits Play or Next, or picks a new station.
- The host finishing, or a stall recovery, may start the song only if the listener already asked to play and is not paused.
- A new station the listener chose does start.

The sticky handoff flag has to clear once the opener is the song after replenish. Leaving it armed stalls track 2 (`finishStationHandoff` in `src/components/AudioPlayer.tsx`).

When the host speaks before a song, that song stays silent until the line is finished. The YouTube clip is cued and muted (`setLaunchHold` in `YouTubeTrackProvider`) so a play flicker cannot leak a blip. The hold is armed before play when a break is likely: the welcome, the first handoff, a talkative station, an always-announce names line, or a pacing slot that is due (`hostMaySpeakBeforeMusic`). Music-only, and a song that is still inside the quiet gap, start at full volume right away.

The song starts at full volume only after the line (or the chime) has finished. A release while the host is still talking is ignored (`musicReleaseWouldCutSpeech`). The log for a finished handoff is `music released`. It means the song is allowed to start. It does not cut a line that is still playing.

While a song should be loud, the player is told that full level on a short timer. YouTube otherwise puts a remembered quiet level back about a minute in, and its own volume reading can still say "full". A quiet level is not reapplied unless the host is actually on the air, and a timer from an earlier break cannot open the mute.

The first Host Studio stamp at launch does not throw away a warmup that has not started. A later real settings change drops the old warmup and arms it again.
