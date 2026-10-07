# Stations and search

How a listener starts a station from search, and how a song is allowed to play. Checked against the code on Oct 7 2026.

## Artist Mix

Artist Mix is mode `mixed` on `/api/artist-radio`.

It opens on one song by the seed artist (`MIX_SEED_SONGS` is 1 in `src/lib/artist-mix.ts`). Neighbors come from the model (`gpt-4o-mini`), not from Last.fm’s top circle (`assembleMixNeighbors` in `src/lib/mix-neighbors.ts`).

A neighbor name is kept only when the catalog has a real song by that artist and that song sits in the seed’s era and feel (an 18-year window, and the same scene buckets in `mix-neighbors.ts`). A name that fails that check is dropped. The station is not padded with strangers.

Last.fm is a backup. It may add at most 4 names (`MIX_BACKUP_CAP`), and only when the model kept fewer than 6 (`MIX_BACKUP_MIN`). Each kept neighbor contributes up to 2 songs (`MIX_SONGS_PER_NEIGHBOR`).

Asking for the same mix again runs a new model pass. Neighbors already used are skipped when other keepable names still exist (`excludeNeighbors`). If the neighbor step fails, the seed song can still open. If the seed artist has no playable song, the route returns an empty list.

## Artist Radio and Artist only

Artist Radio is mode `artist-only`. The queue is that artist. Neighbors are not added.

A picked song can start either mode. The row and the chip are below.

## A song row in search

In the Songs list (`SongResultRow` in `src/components/search/SmartSearchBar.tsx`):

- Tapping the row starts Radio. That is `launchSeededSong` with mode `mixed`. The station label is “{title} Radio”. The picked song is first. Then the same wider mix Artist Mix uses: one seed song (the pick), then neighbors.
- The “Artist only” chip starts mode `artist-only`. The label is “{artist} only”. The picked song is first. The rest of the queue is that artist only.

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
4. Neighbor songs. This phase sets `similarOpen`. The UI heading is “Similar artists”.

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
