/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

/** A fresh seed for a random ordering that later pages must repeat. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

/**
 * Fisher-Yates in place, driven by mulberry32 so a seed reproduces the same order. Each page of a
 * random sort reshuffles the catalog, so only a shared seed keeps pages from overlapping.
 */
export function seededShuffle(items: unknown[], seed: number): void {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
