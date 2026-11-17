/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

/**
 * A site's score on Paperback's 0-1 rating scale. Sites score out of 5 or 10 and show an unrated
 * title as 0, so no score yields undefined rather than the lowest possible rating.
 */
export function normalizeRating(score: number, outOf: number): number | undefined {
  if (!Number.isFinite(score) || score <= 0 || !(outOf > 0)) return undefined;
  return Math.min(score / outOf, 1);
}
