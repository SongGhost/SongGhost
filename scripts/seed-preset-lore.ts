#!/usr/bin/env npx tsx
/**
 * Seed `lore_facts` with a small set of REAL, VERIFIED facts for the
 * preset-station artists so the YouTube dial can serve artist-specific lore
 * via name-based matching (`getUnservedLoreFact` artistName fallback).
 *
 * Idempotent: re-running is safe (conflict-do-nothing on the deterministic id).
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/seed-preset-lore.ts
 *
 * Requires the `artist_name` column added by migration
 * `0002_add_lore_facts_artist_name.sql` (see DJ_LORE_NAME_MATCHING_PROMPT).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loreFacts } from "../src/lib/db/schema";

function fail(message: string): never {
  console.error(`seed-preset-lore: ${message}`);
  process.exit(1);
}

type SeedFact = {
  id: string;
  artistName: string;
  factText: string;
  category: string;
};

const FACTS: readonly SeedFact[] = [
  {
    id: "lore:chuck-berry:johnny-b-goode",
    artistName: "Chuck Berry",
    factText:
      "Chuck Berry wrote and released 'Johnny B. Goode' in 1958 on Chess Records; it was one of 27 songs included on the Voyager Golden Record launched aboard the Voyager spacecraft in 1977.",
    category: "historical_context",
  },
  {
    id: "lore:jerry-lee-lewis:great-balls-of-fire",
    artistName: "Jerry Lee Lewis",
    factText:
      "'Great Balls of Fire' was Jerry Lee Lewis's 1957 hit, recorded at Sun Studio in Memphis with producer Sam Phillips.",
    category: "studio_lore",
  },
  {
    id: "lore:queen:bohemian-rhapsody",
    artistName: "Queen",
    factText:
      "Queen released 'Bohemian Rhapsody' in 1975 on the album 'A Night at the Opera'; its promotional film is widely cited as a landmark in the history of the music video.",
    category: "historical_context",
  },
  {
    id: "lore:eagles:hotel-california",
    artistName: "Eagles",
    factText:
      "The Eagles' 'Hotel California' was the title track of their 1976 album; the lyric 'You can check out any time you like, but you can never leave' became one of rock's most quoted lines.",
    category: "lyrical_inspiration",
  },
  {
    id: "lore:led-zeppelin:stairway-to-heaven",
    artistName: "Led Zeppelin",
    factText:
      "Led Zeppelin released 'Stairway to Heaven' in 1971 on the untitled fourth album often called 'Led Zeppelin IV'; the album carried no title or band name on its cover.",
    category: "release_significance",
  },
  {
    id: "lore:jimi-hendrix:purple-haze",
    artistName: "Jimi Hendrix",
    factText:
      "Jimi Hendrix recorded 'Purple Haze' in 1967 for the debut album 'Are You Experienced'; the song was written in England shortly after his arrival in London.",
    category: "studio_lore",
  },
  {
    id: "lore:the-doors:light-my-fire",
    artistName: "The Doors",
    factText:
      "The Doors' 'Light My Fire' was released in 1967 on the band's self-titled debut album; the extended album version runs over six minutes.",
    category: "release_significance",
  },
  {
    id: "lore:bill-haley:rock-around-the-clock",
    artistName: "Bill Haley",
    factText:
      "Bill Haley & His Comets' 'Rock Around the Clock' was recorded in 1954; its use in the 1955 film 'Blackboard Jungle' is credited with helping bring rock and roll to a worldwide audience.",
    category: "cultural_era",
  },
  {
    id: "lore:aerosmith:dream-on",
    artistName: "Aerosmith",
    factText:
      "Aerosmith's 'Dream On' was the band's first single, released in 1973 from their self-titled debut album.",
    category: "release_significance",
  },
  {
    id: "lore:a-ha:take-on-me",
    artistName: "a-ha",
    factText:
      "a-ha's 'Take On Me' was released in 1985; its music video, combining live action with pencil-sketch animation, won multiple awards at the 1986 MTV Video Music Awards.",
    category: "cultural_era",
  },
  {
    id: "lore:guns-n-roses:sweet-child-o-mine",
    artistName: "Guns N' Roses",
    factText:
      "Guns N' Roses released 'Sweet Child O' Mine' in 1987 on 'Appetite for Destruction'; guitarist Slash has said the famous intro riff began as a finger exercise.",
    category: "studio_lore",
  },
  {
    id: "lore:journey:dont-stop-believin",
    artistName: "Journey",
    factText:
      "Journey's 'Don't Stop Believin'' was released in 1981 on the album 'Escape'.",
    category: "release_significance",
  },
  {
    id: "lore:nirvana:smells-like-teen-spirit",
    artistName: "Nirvana",
    factText:
      "Nirvana released 'Smells Like Teen Spirit' in 1991 as the lead single from 'Nevermind'; its video premiered on MTV and helped define the 1990s alternative rock boom.",
    category: "cultural_era",
  },
  {
    id: "lore:johnny-cash:ring-of-fire",
    artistName: "Johnny Cash",
    factText:
      "Johnny Cash's 'Ring of Fire' was released in 1963; it was co-written by June Carter and Merle Kilgore and features mariachi-style horns.",
    category: "studio_lore",
  },
  {
    id: "lore:dolly-parton:jolene",
    artistName: "Dolly Parton",
    factText:
      "Dolly Parton released 'Jolene' in 1973; Parton has said the song was inspired by a red-haired bank teller who flirted with her husband.",
    category: "lyrical_inspiration",
  },
  {
    id: "lore:miles-davis:so-what",
    artistName: "Miles Davis",
    factText:
      "Miles Davis's 'So What' opened the 1959 album 'Kind of Blue', one of the best-selling jazz albums ever recorded.",
    category: "release_significance",
  },
  {
    id: "lore:notorious-big:juicy",
    artistName: "The Notorious B.I.G.",
    factText:
      "The Notorious B.I.G.'s 'Juicy' was released in 1994 on the debut album 'Ready to Die'; it samples Mtume's 'Juicy Fruit'.",
    category: "studio_lore",
  },
  {
    id: "lore:coldplay:clocks",
    artistName: "Coldplay",
    factText:
      "Coldplay's 'Clocks' was released in 2002 on the album 'A Rush of Blood to the Head'.",
    category: "release_significance",
  },
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    fail("DATABASE_URL is not configured");
  }

  const client = postgres(databaseUrl, { prepare: false });
  const db = drizzle(client);

  try {
    await db
      .insert(loreFacts)
      .values(
        FACTS.map((fact) => ({
          id: fact.id,
          artistName: fact.artistName,
          factText: fact.factText,
          category: fact.category,
        })),
      )
      .onConflictDoNothing({ target: loreFacts.id });

    console.log(
      `seed-preset-lore: upserted ${FACTS.length} verified facts (conflict-do-nothing; re-runnable).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("seed-preset-lore: failed:", err);
  process.exit(1);
});
