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
  if (!page) return [];
  if (input.artistName && input.kind !== "band") {
    const blob = `${page.title} ${page.extract}`.toLowerCase();
    const artist = input.artistName.toLowerCase();
    if (!blob.includes(artist)) return [];
  }
  return claimsFromProse({
    text: page.extract,
    subject: input.subject,
    kind: input.kind,
    sourceUrl: page.url,
    allowedPeople: input.allowedPeople,
  });
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
  const members: Array<{
    id: string;
    name: string;
    beginYear?: number;
    endYear?: number;
    instrumentIds: string[];
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
    const birth = claimItemIds(entity?.claims, "P19")[0];
    instrumentIds.push(...ownInstruments);
    if (birth) birthIds.push(birth);
    members.push({
      id,
      name,
      beginYear: qualifierYear(row, "P580"),
      endYear: qualifierYear(row, "P582"),
      instrumentIds: ownInstruments,
      ...(birth ? { birthId: birth } : {}),
    });
  }
  const labels = await loadEntities([...instrumentIds, ...birthIds]);
  for (const member of members) {
    const instruments = member.instrumentIds
      .map((id) => entityLabel(labels.get(id)))
      .filter(Boolean);
    const spoken = memberClaim({
      name: member.name,
      instruments: instruments.flatMap((label) => {
        const words = instrumentWords(label);
        return words.length ? words : [label];
      }),
      beginYear: member.beginYear,
      endYear: member.endYear,
      formedYear,
      sourceName: "Wikidata",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
    const birthName = member.birthId ? entityLabel(labels.get(member.birthId)) : "";
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
