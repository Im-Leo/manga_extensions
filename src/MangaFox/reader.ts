/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { CheerioAPI } from "cheerio";

import { fetchText } from "../utils/network";
import { secureUrl } from "./parsers";
import { concatenatedLiterals, unpack } from "./unpack";

/**
 * Page-image extraction.
 *
 * Page URLs are not in the markup. They come from a packed script (see
 * `unpack.ts`), and for paginated chapters from a per-page `chapterfun.ashx`
 * call guarded by a one-shot key found in that same script.
 *
 * Three chapter shapes are handled in order: webtoon (URLs inline), paginated
 * (one request per page), and a markup fallback for plainly served chapters.
 */

/** Transient failures are common; this endpoint is rate-sensitive. */
const PAGE_ATTEMPTS = 3;

function unpackedSource($: CheerioAPI): string | undefined {
  const script = $("script:contains(function(p,a,c,k,e,d))").html();
  return script ? unpack(script) : undefined;
}

export async function extractChapterPages($: CheerioAPI, chapterUrl: string): Promise<string[]> {
  const pages = $("script[src*=chapter_bar]").length
    ? extractWebtoonPages($)
    : await extractPaginatedPages($, chapterUrl);

  return pages.length > 0 ? pages : extractFallbackPages($);
}

/** Webtoon chapters inline every URL in a `newImgs=[...]` array. */
export function extractWebtoonPages($: CheerioAPI): string[] {
  const list = /newImgs\s*=\s*\[([^\]]*)\]/.exec(unpackedSource($) ?? "")?.[1];
  if (!list) return [];

  return [...list.matchAll(/'([^']+)'/g)].map((match) => secureUrl(match[1] ?? ""));
}

/** The chapter's page count: the script's own `imagecount`, else the pager's last numbered link. */
function pageCount($: CheerioAPI, html: string): number {
  const declared = Number(/\bimagecount\s*=\s*(\d+)/.exec(html)?.[1]);
  if (declared > 0) return declared;

  // The last pager entry is "next", so the count is the one before it.
  const links = $("a", $(".pager-list-left > span").first());
  return Number($(links[links.length - 2]).attr("data-page")) || 0;
}

/**
 * Paginated chapters expose one image per request, behind a single-use key: page
 * 1 consumes it, and later pages ride the session it establishes.
 *
 * Returns `[]` when the chapter is not paginated-shaped, so the caller can try
 * the markup fallback. Once it is, every page must resolve: a chapter silently
 * missing a page is worse than one that fails and can be retried.
 */
async function extractPaginatedPages($: CheerioAPI, chapterUrl: string): Promise<string[]> {
  const source = unpackedSource($);
  if (!source) return [];

  // `var guidkey=''+'d'+'b'+...;` — the key is the literals before the first statement break.
  const key = concatenatedLiterals(source.slice(source.indexOf("="), source.indexOf(";")));
  const html = $.html();
  const chapterId = /\bchapterid\s*=\s*(\d+)/.exec(html)?.[1];
  const count = pageCount($, html);
  if (!key || !chapterId || count <= 0) return [];

  const base = chapterUrl.slice(0, chapterUrl.lastIndexOf("/"));
  const pageUrl = (page: number, pageKey: string) =>
    `${base}/chapterfun.ashx?cid=${chapterId}&page=${page}&key=${pageKey}`;

  // Page 1 goes alone because it consumes the key; the rest depend only on the
  // session it opens, so they can be issued together.
  const first = await resolvePage(pageUrl(1, key), chapterUrl, 1);
  const rest = await Promise.all(
    Array.from({ length: count - 1 }, (_, index) =>
      resolvePage(pageUrl(index + 2, ""), chapterUrl, index + 2),
    ),
  );

  return [first, ...rest];
}

/**
 * The unpacked page payload assigns `pix` (host path) and `pvalue` (file names,
 * the requested page first).
 */
export function parsePagePayload(body: string): string | undefined {
  const source = unpack(body);
  if (!source) return undefined;

  const host = /\bpix\s*=\s*"([^"]+)"/.exec(source)?.[1];
  const file = /\bpvalue\s*=\s*\[\s*"([^"]+)"/.exec(source)?.[1];
  return host && file ? secureUrl(host + file) : undefined;
}

async function resolvePage(url: string, referer: string, page: number): Promise<string> {
  for (let attempt = 0; attempt < PAGE_ATTEMPTS; attempt++) {
    try {
      const body = await fetchText({
        url,
        method: "GET",
        headers: {
          Referer: referer,
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      const pageImage = parsePagePayload(body);
      if (pageImage) return pageImage;
    } catch {
      // Retried below; the final failure is reported with the page number.
    }
  }

  throw new Error(`MangaFox: page ${page} of this chapter could not be loaded. Try again.`);
}

/** Some chapters are served as plain markup or an inline JSON blob. */
export function extractFallbackPages($: CheerioAPI): string[] {
  const images = $("img.img-fluid")
    .toArray()
    .map((element) => $(element).attr("src"))
    .filter((src): src is string => Boolean(src));
  if (images.length > 0) return images.map(secureUrl);

  const pages: string[] = [];
  $("script:not([src])").each((_, element) => {
    const json = /(\{.*"images":\s*\[.*\].*\})/.exec($(element).html() ?? "")?.[1];
    if (!json) return;

    try {
      const parsed = JSON.parse(json) as { images?: (string | string[])[] };
      for (const image of parsed.images ?? []) {
        const url = Array.isArray(image) ? image[0] : image;
        if (url) pages.push(secureUrl(url));
      }
    } catch {
      // Not the blob this looks for; other scripts may still carry it.
    }
  });

  return pages;
}
