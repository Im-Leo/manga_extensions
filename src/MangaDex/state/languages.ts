/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { MDLanguages } from "../languages";
import { ROMANIZED_CODES } from "../lookups";
import { SETTING_KEYS } from "./keys";
import { getKey, readStringArray, setKey } from "./storage";

/** Which languages a title is shown in, and in what order. */

export const getLanguages = (): string[] =>
  readStringArray(SETTING_KEYS.languages, () => MDLanguages.getDefault());
export const setLanguages = (v: string[]): void => setKey(SETTING_KEYS.languages, v);
export const getLanguagePriority = (): string[] =>
  readStringArray(SETTING_KEYS.languagePriority, getLanguages);
export const setLanguagePriority = (v: string[]): void => setKey(SETTING_KEYS.languagePriority, v);
export const getRomanizedPriorityEnabled = (): boolean =>
  getKey(SETTING_KEYS.romanizedPriorityEnabled, false);
export const setRomanizedPriorityEnabled = (v: boolean): void =>
  setKey(SETTING_KEYS.romanizedPriorityEnabled, v);

export function getTitleLanguages(): string[] {
  const priority = getLanguagePriority();
  if (!getRomanizedPriorityEnabled()) return priority;
  const romanized = new Set<string>(ROMANIZED_CODES);
  return [...ROMANIZED_CODES, ...priority.filter((code) => !romanized.has(code))];
}

export const getNativeTitleDisplay = (): string => getKey(SETTING_KEYS.nativeTitleDisplay, "none");
export const setNativeTitleDisplay = (v: string): void =>
  setKey(SETTING_KEYS.nativeTitleDisplay, v);
