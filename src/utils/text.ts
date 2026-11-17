/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

/**
 * A description served as HTML, as readable text: paragraphs and line breaks survive as newlines,
 * every other tag is dropped, and every entity, named or numeric, is decoded.
 */
export function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<[^>]*>/g, "");
  return Application.decodeHTMLEntities(text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
