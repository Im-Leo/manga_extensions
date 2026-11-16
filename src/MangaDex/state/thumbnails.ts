/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { getDefaultImageQuality } from "../lookups";
import { SETTING_KEYS } from "./keys";
import { getKey, setKey } from "./storage";

/** Image quality per surface, and which badges a tile subtitle carries. */

export const getDiscoverThumbnail = (): string =>
  getKey(SETTING_KEYS.discoverThumbnail, getDefaultImageQuality("discover"));
export const setDiscoverThumbnail = (v: string): void => setKey(SETTING_KEYS.discoverThumbnail, v);
export const getSearchThumbnail = (): string =>
  getKey(SETTING_KEYS.searchThumbnail, getDefaultImageQuality("search"));
export const setSearchThumbnail = (v: string): void => setKey(SETTING_KEYS.searchThumbnail, v);
export const getMangaThumbnail = (): string =>
  getKey(SETTING_KEYS.mangaThumbnail, getDefaultImageQuality("manga"));
export const setMangaThumbnail = (v: string): void => setKey(SETTING_KEYS.mangaThumbnail, v);

export const getShowStatusIcons = (): boolean => getKey(SETTING_KEYS.showStatusIcons, false);
export const setShowStatusIcons = (v: boolean): void => setKey(SETTING_KEYS.showStatusIcons, v);
export const getShowRatingIcons = (): boolean => getKey(SETTING_KEYS.showContentRatingIcons, false);
export const setShowRatingIcons = (v: boolean): void =>
  setKey(SETTING_KEYS.showContentRatingIcons, v);
export const getShowVolume = (): boolean => getKey(SETTING_KEYS.showVolumeInSubtitle, true);
export const setShowVolume = (v: boolean): void => setKey(SETTING_KEYS.showVolumeInSubtitle, v);
export const getShowChapter = (): boolean => getKey(SETTING_KEYS.showChapterInSubtitle, true);
export const setShowChapter = (v: boolean): void => setKey(SETTING_KEYS.showChapterInSubtitle, v);
export const getShowSearchRatingInSubtitle = (): boolean =>
  getKey(SETTING_KEYS.showSearchRatingSubtitle, false);
export const setShowSearchRatingInSubtitle = (v: boolean): void =>
  setKey(SETTING_KEYS.showSearchRatingSubtitle, v);
export const getRelevanceScoringEnabled = (): boolean =>
  getKey(SETTING_KEYS.relevanceScoringEnabled, true);
export const setRelevanceScoringEnabled = (v: boolean): void =>
  setKey(SETTING_KEYS.relevanceScoringEnabled, v);
