/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { SETTING_KEYS } from "./keys";
import { getKey, readStringArray, setKey } from "./storage";

/** How the library update flow batches work and which titles it skips. */

export function getUpdateBatchSize(): number {
  const stored = Application.getState(SETTING_KEYS.updateBatchSize);
  if (typeof stored !== "number" || !Number.isInteger(stored) || stored < 1) return 100;
  return Math.min(stored, 100);
}

export function setUpdateBatchSize(size: number): void {
  const clamped = !Number.isInteger(size) || size < 1 ? 100 : Math.min(size, 100);
  Application.setState(clamped, SETTING_KEYS.updateBatchSize);
}

export const getOptimizeUpdates = (): boolean => getKey(SETTING_KEYS.optimizeUpdates, true);
export const setOptimizeUpdates = (v: boolean): void => setKey(SETTING_KEYS.optimizeUpdates, v);
export const getMetadataUpdater = (): boolean => getKey(SETTING_KEYS.metadataUpdater, false);
export const setMetadataUpdater = (v: boolean): void => setKey(SETTING_KEYS.metadataUpdater, v);
export const getSkipPublicationStatus = (): string[] =>
  readStringArray(SETTING_KEYS.skipPublicationStatus, () => []);
export const setSkipPublicationStatus = (v: string[]): void =>
  setKey(SETTING_KEYS.skipPublicationStatus, v);
export const getSkipNewChapters = (): number => getKey(SETTING_KEYS.skipNewChapters, 0);
export const setSkipNewChapters = (v: number): void => setKey(SETTING_KEYS.skipNewChapters, v);
export const getSkipUnreadChapters = (): number => getKey(SETTING_KEYS.skipUnreadChapters, 0);
export const setSkipUnreadChapters = (v: number): void =>
  setKey(SETTING_KEYS.skipUnreadChapters, v);
