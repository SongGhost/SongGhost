/**
 * One extra article, from a link already on the Wikipedia page.
 * Rolling Stone, Pitchfork, NME, AllMusic, or the artist's own site.
 * Genius is only a meaning note. Nothing else on the open web is fetched.
 */

import { completeSentences } from "./wiki";

const PRESS_HOSTS = ["rollingstone.com", "pitchfork.com", "nme.com", "allmusic.com"];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isHomepage(url: string): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    return path.length <= 1;
  } catch {
    return true;
  }
}

export function officialHost(url: string | undefined): string {
  const host = hostOf(url ?? "");
  return host;
}

/** The first press piece, or a page on the artist's own site. Homepages stay out. */
export function pickAllowlistedArticle(links: readonly string[], artistHost = ""): string | null {
  const pages = links.filter((url) => url.startsWith("http") && !isHomepage(url));
  const press = pages.find((url) => PRESS_HOSTS.some((host) => hostOf(url) === host || hostOf(url).endsWith(`.${host}`)));
  if (press) return press;
  if (!artistHost) return null;
  return pages.find((url) => hostOf(url) === artistHost || hostOf(url).endsWith(`.${artistHost}`)) ?? null;
}

export function pickGeniusLink(links: readonly string[]): string | null {
  return links.find((url) => hostOf(url) === "genius.com" || hostOf(url).endsWith(".genius.com")) ?? null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A readable passage, or nothing if the page is a wall, a script prompt, or too thin. */
export async function readLinkedPage(url: string, maxWords: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "SongHost/1.0 (https://songhost.app; host fact sheet)",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return "";
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|text\/plain/i.test(type)) return "";
    const html = await res.text();
    const text = completeSentences(htmlToText(html), maxWords);
    if (text.split(/\s+/).filter(Boolean).length < 40) return "";
    if (/\b(?:enable javascript|subscribe to read|sign in to continue|are you a robot)\b/i.test(text)) return "";
    return text;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
