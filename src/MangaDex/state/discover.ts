/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { SCHEMA_KEYS, SETTING_KEYS } from "./keys";
import { getKey, setKey } from "./storage";

export const DISCOVER_SECTIONS = {
  POPULAR: "popular",
  LATEST_UPDATES: "latest_updates",
  RECOMMENDED: "recommended",
  SELF_PUBLISHED: "self_published",
  SEASONAL: "seasonal",
  RECENTLY_ADDED: "recently_added",
};

export const DEFAULT_SECTION_ORDER = [
  DISCOVER_SECTIONS.POPULAR,
  DISCOVER_SECTIONS.LATEST_UPDATES,
  DISCOVER_SECTIONS.RECOMMENDED,
  DISCOVER_SECTIONS.SELF_PUBLISHED,
  DISCOVER_SECTIONS.SEASONAL,
  DISCOVER_SECTIONS.RECENTLY_ADDED,
];

/** Bump when adding a section, so a saved order missing it is discarded. */
const DISCOVER_SECTION_ORDER_SCHEMA = 2;

export function getDiscoverSectionOrder(): string[] {
  const savedSchema = Application.getState(SCHEMA_KEYS.discoverSectionOrderSchema) as
    | number
    | undefined;
  if (savedSchema !== DISCOVER_SECTION_ORDER_SCHEMA) {
    Application.setState(undefined, SETTING_KEYS.discoverSectionOrder);
    Application.setState(DISCOVER_SECTION_ORDER_SCHEMA, SCHEMA_KEYS.discoverSectionOrderSchema);
    return DEFAULT_SECTION_ORDER.slice();
  }

  const rawOrder = Application.getState(SETTING_KEYS.discoverSectionOrder) as string[] | undefined;
  if (!rawOrder || !Array.isArray(rawOrder)) {
    return DEFAULT_SECTION_ORDER.slice();
  }

  const validIds = new Set(DEFAULT_SECTION_ORDER);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of rawOrder) {
    if (validIds.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of DEFAULT_SECTION_ORDER) {
    if (!seen.has(id)) result.push(id);
  }

  const changed = result.length !== rawOrder.length || result.some((id, i) => id !== rawOrder[i]);
  if (changed) {
    Application.setState(result, SETTING_KEYS.discoverSectionOrder);
  }
  return result;
}

export function setDiscoverSectionOrder(order: string[]): void {
  Application.setState(order, SETTING_KEYS.discoverSectionOrder);
  Application.setState(DISCOVER_SECTION_ORDER_SCHEMA, SCHEMA_KEYS.discoverSectionOrderSchema);
}

export const getPopularEnabled = (): boolean => getKey(SETTING_KEYS.popularEnabled, true);
export const setPopularEnabled = (v: boolean): void => setKey(SETTING_KEYS.popularEnabled, v);
export const getLatestUpdatesEnabled = (): boolean =>
  getKey(SETTING_KEYS.latestUpdatesEnabled, true);
export const setLatestUpdatesEnabled = (v: boolean): void =>
  setKey(SETTING_KEYS.latestUpdatesEnabled, v);
export const getRecommendedEnabled = (): boolean => getKey(SETTING_KEYS.recommendedEnabled, true);
export const setRecommendedEnabled = (v: boolean): void =>
  setKey(SETTING_KEYS.recommendedEnabled, v);
export const getSelfPublishedEnabled = (): boolean =>
  getKey(SETTING_KEYS.selfPublishedEnabled, true);
export const setSelfPublishedEnabled = (v: boolean): void =>
  setKey(SETTING_KEYS.selfPublishedEnabled, v);
export const getSeasonalEnabled = (): boolean => getKey(SETTING_KEYS.seasonalEnabled, true);
export const setSeasonalEnabled = (v: boolean): void => setKey(SETTING_KEYS.seasonalEnabled, v);
export const getRecentlyAddedEnabled = (): boolean =>
  getKey(SETTING_KEYS.recentlyAddedEnabled, true);
export const setRecentlyAddedEnabled = (v: boolean): void =>
  setKey(SETTING_KEYS.recentlyAddedEnabled, v);

export interface DiscoverSectionDefinition {
  id: string;
  title: string;
  type: "prominentCarousel" | "chapterUpdates" | "simpleCarousel" | "featured";
  getEnabled: () => boolean;
  setEnabled: (value: boolean) => void;
}

export const SECTION_DEFINITIONS: readonly DiscoverSectionDefinition[] = [
  {
    id: DISCOVER_SECTIONS.POPULAR,
    title: "Popular New Titles",
    type: "prominentCarousel",
    getEnabled: getPopularEnabled,
    setEnabled: setPopularEnabled,
  },
  {
    id: DISCOVER_SECTIONS.LATEST_UPDATES,
    title: "Latest Updates",
    type: "chapterUpdates",
    getEnabled: getLatestUpdatesEnabled,
    setEnabled: setLatestUpdatesEnabled,
  },
  {
    id: DISCOVER_SECTIONS.RECOMMENDED,
    title: "Recommended",
    type: "simpleCarousel",
    getEnabled: getRecommendedEnabled,
    setEnabled: setRecommendedEnabled,
  },
  {
    id: DISCOVER_SECTIONS.SELF_PUBLISHED,
    title: "Self-Published",
    type: "simpleCarousel",
    getEnabled: getSelfPublishedEnabled,
    setEnabled: setSelfPublishedEnabled,
  },
  {
    id: DISCOVER_SECTIONS.SEASONAL,
    title: "Seasonal",
    type: "featured",
    getEnabled: getSeasonalEnabled,
    setEnabled: setSeasonalEnabled,
  },
  {
    id: DISCOVER_SECTIONS.RECENTLY_ADDED,
    title: "Recently Added",
    type: "simpleCarousel",
    getEnabled: getRecentlyAddedEnabled,
    setEnabled: setRecentlyAddedEnabled,
  },
];
