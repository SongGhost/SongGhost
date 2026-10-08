# Changelog

Plain-English notes for the New host, stations, search, and playback work. Dates are the commit dates. Current behavior is in `NEW-ENGINE-HOST-STUDIO.md` and `STATIONS-AND-SEARCH.md`. A later commit can override an earlier one.

## 2026-10-08

- A signed-in listener’s DJ settings stay on the account. Engine, host, voice, lore, pace, and the other host choices come back after a reboot, a new sign-in, or another browser. Signing in does not replace them with defaults. Two devices keep the newest save. The other device picks that up when the tab is focused again or the next station or song starts, not while a break is talking. An old Classic save moves to New once, and that move does not change the host, voice, or lore. Vitest: 0 failed, 1404 passed, 20 skipped.
- A break sounds like someone talking. The title line is optional and does not reuse one handoff. “The song is X, from Y” is rejected. A listen-for cue stays inside the fact sentence. A credit is “plays the trumpet,” not “is credited on.” A year, “the musician behind it,” and a bare credit wait until the sheet has nothing richer. A tease spends its fact, including a shorter name for the same person. On 18 live Guide breaks (12 on a wide station, 6 on Artist Radio): 5 passed on the first write, 6 retried, 7 fell back. No sentence shape repeated. Vitest: 0 failed, 1396 passed, 20 skipped.
- A song that gets a host break stays silent until the host is done. No blip of music first, and the line is not cut off so the song can start. Volume stays full for the rest of the song. YouTube's remembered quiet level, about a minute in, is pushed back to full. The first settings stamp at launch no longer throws away a warmup that has not started.

## 2026-10-07

- A station does not repeat a fact or a stock closer. Listen-for is only a sound you can hear. Sheets go deeper than “formed in / album number / studio”: member roles, song and album pages, and the band page. A tease is spent, and the next break says something new. On 18 live Guide breaks (12 National, 6 Bon Iver): 13 passed on the first write, 3 retried, 2 fell back. Vitest: 0 failed, 1381 passed, 19 skipped.
- Human breaks speak a full album title and a reason to stay. The fact is already a sentence. This track’s featured guest comes first. Two facts have to be the same person or the same place. The tease is a “stick around” hook from the next song only. The gate rejects broken ordinals, a shortened album title, label praise, and “After that, <fact>”. A station label is not read after the line. On 15 live Guide breaks: 14 passed on the first write, 1 retried, 0 fell back (was about 5 retries out of 7). Similar artists in Songs rotate, at most two songs in a row from one neighbor.
- `0e3506e` — Tapping a song in search starts the wide radio (that song first, then a mix). The Songs list keeps paging until that artist’s catalog runs out, then shows similar artists.
- `3e0307b` — A New break may not wrap a real fact in press-kit color. Banned filler and press-kit words fail the gate.
- `647b1b7` — The New host proof log type-checks in a production build.

## 2026-10-06

- `0e5164f` — New is the host a first visit hears. Old Classic saves move once. The Guide stops reusing one closer (“when the song opens” / “because that is the part to hear”).
- `696afc4` — One surprise per break, instead of a credit list. Director’s Cut may use a second fact only when it is a different kind of surprise.
- `984fb50` — A type check that stopped the production build is fixed.
- `93d2819` — A New break can teach the album story instead of falling back to a year and a track number.
- `0eebba1` — The New host gets a sourced fact sheet (MusicBrainz, Wikipedia, Wikidata, iTunes) so a break can teach a real detail. This is the rich-facts step.

## 2026-10-05

- `9124a6c` — Album-art YouTube songs play. A still cover is not treated as a dead video. Error 5 does not skip. Errors 100, 101, and 150 do. A video that never starts can be skipped after 20 seconds.
- `8cf1f6d` — A picked song opens the same Mix and Radio paths artists already use.
- `d76319e` — Artist Mix neighbors come from the model. A name is kept only when the catalog has a real song in the same era and feel. Last.fm adds at most 4 names when the model list is thin.
- `2a68ae9` — Artist Mix opens on the seed, then a wider set of real neighbors.
- `3ef806a` — A concert hall or arena is not spoken as the studio where a song was recorded.
- `e122c2e` — The production build accepts optional YouTube player methods.
- `b6e89bf` — Refresh shows the station and does not start it. Pause stays paused until Play, Next, or a new station. The first visible song is the one that can start.
- `9e00108` — Play the first song of the playlist the listener can see.
- `279bb83` — Queue a playable YouTube video ahead of one that will not start.
- `b075a9f` — Artist Mix opens on a playable seed song.

## 2026-10-04

- `c9c78d8` — Inspired stays at three real cards. If a song cannot start, the old song stops.
- `95d9eed` — Artist Mix opens on the seed. Asking again holds the same scene and prefers different neighbors.
- `98859db` — Guide, Critic, Archivist, and Standard Broadcast are postures, not catchphrases.
- `7e0ef27` — “That was” is only for the exit from song 1. Dead videos are skipped.
- `308c527` — A Director’s Cut line that is only mood is rejected. Song 1’s welcome still survives a messy launch.
- `b5dbab9` — Song 1 stays on the station welcome. The lore chime plays only when the line has a real fact. Genre and era tags are not spoken as lore.
- `76bf45d` — Time Capsule and Director’s Cut can say a real producer, engineer, and studio when MusicBrainz has them. Later commits changed the writer: every New depth is `gpt-4o-mini` now, and the `gpt-4.1-mini` Director’s Cut switch is off. See `NEW-ENGINE-HOST-STUDIO.md`.

## Docs pass

- Oct 7 2026 — Docs updated to the code. Vitest: 5 failed, 1357 passed, 17 skipped (1379). The five failures are named in `NEW-ENGINE-HOST-STUDIO.md`.
