/**
 * Wikipedia summaries and Wikidata facts.
 * The summary is mined into short claims. The paragraph is not kept.
 */

import {
  claimsFromProse,
  hometownClaim,
  instrumentWords,
  makeClaim,
  memberClaim,
  originClaim,
  type SheetClaim,
} from "./claims";

const USER_AGENT = "SongHost/1.0 (https://songhost.app; host fact sheet)";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value && typeof value === "object" ? value as Json : null;
}

async function fetchJson(url: string, ms = 4000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function wikipediaSummary(title: string): Promise<{
  title: string;
  extract: string;
  url: string;
} | null> {
  const clean = title.trim();
  if (!clean) return null;
  const data = asRecord(await fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean.replace(/ /g, "_"))}`,
  ));
  if (!data) return null;
  const extract = typeof data.extract === "string" ? data.extract.trim() : "";
  const page = typeof data.title === "string" ? data.title.trim() : clean;
  const contentUrls = asRecord(data.content_urls);
  const desktop = asRecord(contentUrls?.desktop);
  const url = typeof desktop?.page === "string"
    ? desktop.page
    : `https://en.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, "_"))}`;
  if (!extract) return null;
  return { title: page, extract, url };
}

export async function wikipediaSearchTitle(query: string): Promise<string | null> {
  const clean = query.trim();
  if (!clean) return null;
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: clean,
    srlimit: "5",
    format: "json",
    origin: "*",
  });
  const data = asRecord(await fetchJson(`https://en.wikipedia.org/w/api.php?${params.toString()}`));
  const queryBody = asRecord(data?.query);
  const hits = Array.isArray(queryBody?.search) ? queryBody.search : [];
  const first = asRecord(hits[0]);
  const title = typeof first?.title === "string" ? first.title.trim() : "";
  return title || null;
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const SECTION_WANT: Record<"band" | "album" | "song", RegExp> = {
  band: /formation|members|history|career|background|biography|early|personnel|line-?up/i,
  album: /background|recording|composition|production|release|reception|critical|commercial|personnel|chart|legacy|cover|writing|track/i,
  song: /background|writing|recording|composition|production|meaning|lyrics|reception|release|chart|legacy|cover|personnel|commercial|inspiration|theme|music video/i,
};

/** Lead plus the sections that actually carry a story. The rest of the article stays out. */
export function relevantProse(extract: string, kind: "band" | "album" | "song"): string {
  const parts = extract.split(/\n(?===+)/);
  const kept: string[] = [(parts[0] ?? "").slice(0, 1600)];
  const want = SECTION_WANT[kind];
  for (const part of parts.slice(1)) {
    const heading = part.match(/^==+\s*([^=\n]+)/)?.[1] ?? "";
    if (!want.test(heading)) continue;
    kept.push(part.replace(/^==+[^=\n]+==+\s*/, "").slice(0, 1800));
    if (kept.join("\n").length > 9000) break;
  }
  return kept.join("\n").replace(/\s+/g, " ").trim();
}

const STORY_SECTION: Record<"album" | "song", RegExp> = {
  album: /background|recording|composition|production|writing|reception|critical|commercial/i,
  song: /writing|recording|composition|production|meaning|lyrics|reception|inspiration|theme/i,
};

/** Whole sentences only. A cut that would end mid-sentence is left out. */
export function completeSentences(text: string, maxWords: number): string {
  const clean = text.replace(/\[[^\]]{0,80}\]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || maxWords <= 0) return "";
  const parts = clean.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  let words = 0;
  for (const part of parts) {
    const sentence = part.replace(/\s+/g, " ").trim();
    if (!/[.!?]$/.test(sentence)) continue;
    const count = sentence.split(/\s+/).filter(Boolean).length;
    if (count === 0) continue;
    if (words > 0 && words + count > maxWords) break;
    kept.push(sentence);
    words += count;
    if (words >= maxWords) break;
  }
  return kept.join(" ");
}

/**
 * The lead, plus writing, recording, composition, meaning, and reception.
 * A few hundred words. Nothing is cut off in the middle of a sentence.
 */
export function storyPassage(extract: string, kind: "album" | "song", maxWords = 420): string {
  const parts = extract.split(/\n(?===+)/);
  const chunks: string[] = [];
  const lead = completeSentences(parts[0] ?? "", 160);
  if (lead) chunks.push(lead);
  const want = STORY_SECTION[kind];
  for (const part of parts.slice(1)) {
    const heading = part.match(/^==+\s*([^=\n]+)/)?.[1] ?? "";
    if (!want.test(heading)) continue;
    const body = completeSentences(part.replace(/^==+[^=\n]+==+\s*/, ""), 180);
    if (!body) continue;
    chunks.push(body);
    const total = chunks.join(" ").split(/\s+/).filter(Boolean).length;
    if (total >= maxWords) break;
  }
  return completeSentences(chunks.join(" "), maxWords);
}

async function wikipediaPlain(title: string): Promise<string> {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    exsectionformat: "wiki",
    redirects: "1",
    titles: title,
    format: "json",
  });
  const data = asRecord(await fetchJson(`https://en.wikipedia.org/w/api.php?${params.toString()}`, 7000));
  const pages = asRecord(asRecord(data?.query)?.pages);
  if (!pages) return "";
  for (const page of Object.values(pages)) {
    const row = asRecord(page);
    const extract = typeof row?.extract === "string" ? row.extract.trim() : "";
    if (extract) return extract;
  }
  return "";
}

export async function wikipediaClaimsFor(input: {
  subject: string;
  kind: "band" | "album" | "song";
  titleHint?: string;
  artistName?: string;
  allowedPeople?: readonly string[];
}): Promise<SheetClaim[]> {
  let title = input.titleHint?.trim() || "";
  if (!title) {
    const search = input.kind === "band"
      ? input.subject
      : `"${input.subject}" ${input.artistName ?? ""} ${input.kind}`;
    title = (await wikipediaSearchTitle(search)) ?? "";
  }
  if (!title) return [];
  if (input.kind !== "band") {
    const foldedTitle = fold(title);
    const foldedSubject = fold(input.subject);
    if (foldedSubject && !foldedTitle.includes(foldedSubject) && !fold(input.subject).split(" ").every((word) => word.length < 4 || foldedTitle.includes(word))) {
      return [];
    }
  }
  const page = await wikipediaSummary(title);
  const plain = await wikipediaPlain(page?.title || title);
  const text = plain ? relevantProse(plain, input.kind) : (page?.extract ?? "");
  if (!text) return [];
  const sourceUrl = page?.url
    ?? `https://en.wikipedia.org/wiki/${encodeURIComponent((page?.title || title).replace(/ /g, "_"))}`;
  if (input.artistName && input.kind !== "band") {
    const blob = `${page?.title ?? title} ${text.slice(0, 2500)}`.toLowerCase();
    const artist = input.artistName.toLowerCase();
    if (!blob.includes(artist)) return [];
  }
  return claimsFromProse({
    text,
    subject: input.subject,
    kind: input.kind,
    sourceUrl,
    allowedPeople: input.allowedPeople,
    artistName: input.artistName,
  });
}

export async function wikipediaExternalLinks(title: string): Promise<string[]> {
  const clean = title.trim();
  if (!clean) return [];
  const params = new URLSearchParams({
    action: "query",
    prop: "extlinks",
    titles: clean,
    ellimit: "80",
    format: "json",
    redirects: "1",
  });
  const data = asRecord(await fetchJson(`https://en.wikipedia.org/w/api.php?${params.toString()}`, 7000));
  const pages = asRecord(asRecord(data?.query)?.pages);
  if (!pages) return [];
  const links: string[] = [];
  for (const page of Object.values(pages)) {
    const row = asRecord(page);
    const list = Array.isArray(row?.extlinks) ? row.extlinks : [];
    for (const item of list) {
      const link = asRecord(item);
      const url = typeof link?.["*"] === "string"
        ? link["*"]
        : typeof link?.url === "string"
          ? link.url
          : "";
      if (url.startsWith("http")) links.push(url);
    }
  }
  return links;
}

/**
 * Song or album page: mined claims, plus the passage the writer may paraphrase.
 * Band pages stay claims-only. The paragraph is not thrown away.
 */
export async function wikipediaStoryFor(input: {
  subject: string;
  kind: "album" | "song";
  titleHint?: string;
  artistName?: string;
  allowedPeople?: readonly string[];
}): Promise<{
  claims: SheetClaim[];
  passage: { title: string; url: string; text: string } | null;
  links: string[];
}> {
  const claims = await wikipediaClaimsFor(input);
  let title = input.titleHint?.trim() || "";
  if (!title) {
    title = (await wikipediaSearchTitle(`"${input.subject}" ${input.artistName ?? ""} ${input.kind}`)) ?? "";
  }
  if (!title) return { claims, passage: null, links: [] };
  const page = await wikipediaSummary(title);
  const pageTitle = page?.title || title;
  const plain = await wikipediaPlain(pageTitle);
  const text = plain ? storyPassage(plain, input.kind) : completeSentences(page?.extract ?? "", 420);
  const sourceUrl = page?.url
    ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;
  const links = await wikipediaExternalLinks(pageTitle);
  if (input.artistName && text) {
    const blob = `${pageTitle} ${text.slice(0, 2500)}`.toLowerCase();
    if (!blob.includes(input.artistName.toLowerCase())) {
      return { claims, passage: null, links };
    }
  }
  return {
    claims,
    passage: text ? { title: pageTitle, url: sourceUrl, text } : null,
    links,
  };
}

type WikiEntity = {
  labels?: { en?: { value?: string } };
  claims?: Record<string, unknown>;
};

function entityLabel(entity: WikiEntity | undefined): string {
  return entity?.labels?.en?.value?.replace(/\s+/g, " ").trim() ?? "";
}

function claimItemIds(claims: Record<string, unknown> | undefined, prop: string): string[] {
  const rows = claims?.[prop];
  if (!Array.isArray(rows)) return [];
  const ids: string[] = [];
  for (const row of rows) {
    const mainsnak = asRecord(asRecord(row)?.mainsnak);
    const datavalue = asRecord(mainsnak?.datavalue);
    const value = asRecord(datavalue?.value);
    const id = typeof value?.id === "string" ? value.id : "";
    if (id.startsWith("Q")) ids.push(id);
  }
  return ids;
}

function qualifierYear(row: unknown, prop: string): number | undefined {
  const qualifiers = asRecord(asRecord(row)?.qualifiers);
  const list = qualifiers?.[prop];
  if (!Array.isArray(list) || !list[0]) return undefined;
  const datavalue = asRecord(asRecord(list[0])?.datavalue);
  const value = asRecord(datavalue?.value);
  const time = typeof value?.time === "string" ? value.time : "";
  const match = time.match(/(\d{4})/);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (year < 1900 || year > 2035) return undefined;
  return year;
}

function timeYear(claims: Record<string, unknown> | undefined, prop: string): number | undefined {
  const rows = claims?.[prop];
  if (!Array.isArray(rows) || !rows[0]) return undefined;
  const datavalue = asRecord(asRecord(asRecord(rows[0])?.mainsnak)?.datavalue);
  const value = asRecord(datavalue?.value);
  const time = typeof value?.time === "string" ? value.time : "";
  const match = time.match(/(\d{4})/);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (year < 1900 || year > 2035) return undefined;
  return year;
}

async function loadEntities(ids: readonly string[]): Promise<Map<string, WikiEntity>> {
  const unique = [...new Set(ids.filter((id) => /^Q\d+$/.test(id)))].slice(0, 40);
  const map = new Map<string, WikiEntity>();
  if (unique.length === 0) return map;
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: unique.join("|"),
    props: "labels|claims",
    languages: "en",
    format: "json",
  });
  const data = asRecord(await fetchJson(`https://www.wikidata.org/w/api.php?${params.toString()}`));
  const entities = asRecord(data?.entities);
  if (!entities) return map;
  for (const [id, entity] of Object.entries(entities)) {
    const row = asRecord(entity);
    if (row) map.set(id, row as WikiEntity);
  }
  return map;
}

/**
 * Members, instruments, birthplaces, and where the band formed.
 * People already locked by MusicBrainz win. Extra Wikidata names are dropped.
 */
export async function wikidataBandClaims(input: {
  qid: string;
  bandName: string;
  allowedPeople: readonly string[] | null;
}): Promise<SheetClaim[]> {
  const qid = input.qid.trim();
  if (!/^Q\d+$/.test(qid)) return [];
  const sourceUrl = `https://www.wikidata.org/wiki/${qid}`;
  const bandMap = await loadEntities([qid]);
  const band = bandMap.get(qid);
  if (!band?.claims) return [];
  const formedYear = timeYear(band.claims, "P571");
  const placeIds = claimItemIds(band.claims, "P740");
  const memberRows = Array.isArray(band.claims.P527) ? band.claims.P527 : [];
  const memberIds = claimItemIds(band.claims, "P527");
  const firstBatch = await loadEntities([...placeIds, ...memberIds]);
  const placeName = entityLabel(firstBatch.get(placeIds[0] ?? ""));
  const claims: SheetClaim[] = [];
  const origin = originClaim({
    subject: input.bandName,
    place: placeName || undefined,
    year: formedYear,
    sourceName: "Wikidata",
    sourceUrl,
    confidence: "high",
  });
  if (origin) claims.push(origin);

  const instrumentIds: string[] = [];
  const birthIds: string[] = [];
  const siblingIds: string[] = [];
  const members: Array<{
    id: string;
    name: string;
    beginYear?: number;
    endYear?: number;
    instrumentIds: string[];
    siblingIds: string[];
    gender?: string;
    birthId?: string;
  }> = [];
  for (const row of memberRows) {
    const mainsnak = asRecord(asRecord(row)?.mainsnak);
    const datavalue = asRecord(mainsnak?.datavalue);
    const value = asRecord(datavalue?.value);
    const id = typeof value?.id === "string" ? value.id : "";
    const entity = firstBatch.get(id);
    const name = entityLabel(entity);
    if (!id || !name) continue;
    if (input.allowedPeople && input.allowedPeople.length > 0) {
      const allowed = input.allowedPeople.some((person) => person.toLowerCase() === name.toLowerCase());
      if (!allowed) continue;
    }
    const ownInstruments = claimItemIds(entity?.claims, "P1303");
    const ownSiblings = claimItemIds(entity?.claims, "P3373");
    const birth = claimItemIds(entity?.claims, "P19")[0];
    const gender = claimItemIds(entity?.claims, "P21")[0];
    instrumentIds.push(...ownInstruments);
    siblingIds.push(...ownSiblings);
    if (birth) birthIds.push(birth);
    members.push({
      id,
      name,
      beginYear: qualifierYear(row, "P580"),
      endYear: qualifierYear(row, "P582"),
      instrumentIds: ownInstruments,
      siblingIds: ownSiblings,
      ...(gender ? { gender } : {}),
      ...(birth ? { birthId: birth } : {}),
    });
  }
  const labels = await loadEntities([...instrumentIds, ...birthIds, ...siblingIds]);
  const grouped = new Map<string, typeof members>();
  for (const member of members) {
    const key = member.name.toLowerCase();
    const list = grouped.get(key) ?? [];
    list.push(member);
    grouped.set(key, list);
  }
  for (const group of grouped.values()) {
    const member = group[0];
    if (!member) continue;
    const stillIn = group.some((row) => typeof row.endYear !== "number");
    const endYears = group
      .map((row) => row.endYear)
      .filter((year): year is number => typeof year === "number")
      .sort((a, b) => b - a);
    const beginYears = group
      .map((row) => row.beginYear)
      .filter((year): year is number => typeof year === "number")
      .sort((a, b) => a - b);
    const instrumentLabels = [...new Set(group.flatMap((row) => row.instrumentIds))]
      .map((id) => entityLabel(labels.get(id)))
      .filter(Boolean);
    const spoken = memberClaim({
      name: member.name,
      instruments: instrumentLabels.flatMap((label) => {
        const words = instrumentWords(label);
        return words.length ? words : [label];
      }),
      ...(typeof beginYears[0] === "number" ? { beginYear: beginYears[0] } : {}),
      ...(stillIn || typeof endYears[0] !== "number" ? {} : { endYear: endYears[0] }),
      formedYear,
      sourceName: "Wikidata",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
    const birthId = group.find((row) => row.birthId)?.birthId;
    const birthName = birthId ? entityLabel(labels.get(birthId)) : "";
    const home = birthName
      ? hometownClaim({
          name: member.name,
          place: birthName,
          sourceName: "Wikidata",
          sourceUrl,
        })
      : null;
    if (home) claims.push(home);
  }

  const paired = new Set<string>();
  for (const member of members) {
    for (const sibId of member.siblingIds) {
      const other = members.find((row) => row.id === sibId);
      const otherName = other?.name || entityLabel(labels.get(sibId));
      if (!otherName) continue;
      const onRoster = Boolean(other) || (input.allowedPeople ?? []).some((person) => person.toLowerCase() === otherName.toLowerCase());
      if (!onRoster) continue;
      const pair = [member.name, otherName].map((name) => name.toLowerCase()).sort().join("|");
      if (paired.has(pair)) continue;
      paired.add(pair);
      const otherGender = other?.gender ?? claimItemIds(labels.get(sibId)?.claims, "P21")[0];
      const word = member.gender === "Q6581097" && otherGender === "Q6581097"
        ? "brothers"
        : member.gender === "Q6581072" && otherGender === "Q6581072"
          ? "sisters"
          : "siblings";
      const spoken = makeClaim({
        id: `connections:sibling:${pair.replace(/[^a-z0-9|]+/g, "-")}`,
        claim: `${member.name} and ${otherName} are ${word}`,
        topic: "connections",
        names: [member.name, otherName],
        sourceName: "Wikidata",
        sourceUrl,
        confidence: "high",
      });
      if (spoken) claims.push(spoken);
    }
  }

  if (input.allowedPeople === null && claims.length === 0 && formedYear) {
    const solo = makeClaim({
      id: `origin:${qid}`,
      claim: placeName
        ? `${input.bandName} is from ${placeName}`
        : `${input.bandName} started in ${formedYear}`,
      topic: "origin",
      names: [input.bandName],
      places: placeName ? [placeName] : [],
      years: [formedYear],
      sourceName: "Wikidata",
      sourceUrl,
      confidence: "high",
    });
    if (solo) claims.push(solo);
  }
  return claims;
}

/** A solo artist has a birthplace, not a lineup. */
export async function wikidataPersonOrigin(input: {
  qid: string;
  name: string;
}): Promise<SheetClaim[]> {
  const qid = input.qid.trim();
  if (!/^Q\d+$/.test(qid)) return [];
  const sourceUrl = `https://www.wikidata.org/wiki/${qid}`;
  const map = await loadEntities([qid]);
  const person = map.get(qid);
  const birthId = claimItemIds(person?.claims, "P19")[0];
  const birthYear = timeYear(person?.claims, "P569");
  if (!birthId && !birthYear) return [];
  const places = birthId ? await loadEntities([birthId]) : new Map<string, WikiEntity>();
  const place = birthId ? entityLabel(places.get(birthId)) : "";
  const claims: SheetClaim[] = [];
  if (place) {
    const home = hometownClaim({
      name: input.name,
      place,
      sourceName: "Wikidata",
      sourceUrl,
    });
    if (home) claims.push(home);
  }
  if (birthYear && !place) {
    const started = originClaim({
      subject: input.name,
      year: birthYear,
      sourceName: "Wikidata",
      sourceUrl,
      confidence: "high",
    });
    if (started) {
      claims.push({
        ...started,
        claim: `${input.name} was born in ${birthYear}.`,
        id: `origin:born:${qid}`,
      });
    }
  }
  return claims;
}
