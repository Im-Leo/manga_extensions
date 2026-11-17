/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

/**
 * One definition of the v4 UUID shape, locked to version 4 so a malformed id
 * cannot inject extra path segments into a request URL.
 */
export const UUID_FRAGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export const UUID_RE = new RegExp(`^${UUID_FRAGMENT}$`, "i");
/** Unanchored, for a UUID pasted inside a user's search text. */
export const UUID_SEARCH_RE = new RegExp(UUID_FRAGMENT, "i");

/** Trims and lowercases, then validates; undefined for anything that is not a v4 UUID. */
export function normalizeUuid(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  return UUID_RE.test(trimmed) ? trimmed : undefined;
}
