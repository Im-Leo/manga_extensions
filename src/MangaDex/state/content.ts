/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { getDefaultRatings } from "../lookups";
import { SCHEMA_KEYS, SETTING_KEYS } from "./keys";
import { getKey, readStringArray, setKey, THUMBNAIL_QUALITY_SCHEMA } from "./storage";

/** Content ratings, and the reader and synopsis behavior that follows from them. */

export const getRatings = (): string[] =>
  readStringArray(SETTING_KEYS.ratings, () => getDefaultRatings());
export const setRatings = (v: string[]): void => setKey(SETTING_KEYS.ratings, v);
export const getDataSaver = (): boolean => getKey(SETTING_KEYS.dataSaver, false);
export const setDataSaver = (v: boolean): void => setKey(SETTING_KEYS.dataSaver, v);
export const getForcePort443 = (): boolean => getKey(SETTING_KEYS.forcePort443, false);
export const setForcePort443 = (v: boolean): void => setKey(SETTING_KEYS.forcePort443, v);
export const getSkipSameChapter = (): boolean => getKey(SETTING_KEYS.skipSameChapter, false);
export const setSkipSameChapter = (v: boolean): void => setKey(SETTING_KEYS.skipSameChapter, v);
export const getIncludeUnavailable = (): boolean => getKey(SETTING_KEYS.includeUnavailable, false);
export const setIncludeUnavailable = (v: boolean): void =>
  setKey(SETTING_KEYS.includeUnavailable, v);

export const getShowAltTitlesInSynopsis = (): boolean =>
  getKey(SETTING_KEYS.showAltTitlesInSynopsis, false);
export const setShowAltTitlesInSynopsis = (v: boolean): void =>
  setKey(SETTING_KEYS.showAltTitlesInSynopsis, v);
export const getShowFinalChapterInSynopsis = (): boolean =>
  getKey(SETTING_KEYS.showFinalChapterInSynopsis, false);
export const setShowFinalChapterInSynopsis = (v: boolean): void =>
  setKey(SETTING_KEYS.showFinalChapterInSynopsis, v);
export const getTryFirstVolumeCover = (): boolean =>
  getKey(SETTING_KEYS.tryFirstVolumeCover, false);
export const setTryFirstVolumeCover = (v: boolean): void =>
  setKey(SETTING_KEYS.tryFirstVolumeCover, v);

let stateMigrationsRan = false;

export function runStateMigrations(): void {
  if (stateMigrationsRan) return;
  const schema = Application.getState(SCHEMA_KEYS.thumbnailQualitySchema) as number | undefined;
  if (schema !== THUMBNAIL_QUALITY_SCHEMA) {
    for (const key of [SETTING_KEYS.discoverThumbnail, SETTING_KEYS.searchThumbnail]) {
      if (Application.getState(key) === "source") {
        Application.setState(undefined, key);
      }
    }
    Application.setState(THUMBNAIL_QUALITY_SCHEMA, SCHEMA_KEYS.thumbnailQualitySchema);
  }
  stateMigrationsRan = true;
}
