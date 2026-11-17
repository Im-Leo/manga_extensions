/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { ScanlationGroupItem } from "../models";
import { SETTING_KEYS } from "./keys";
import { getKey, readStringArray, setKey } from "./storage";

/** Scanlation groups and uploaders whose chapters are hidden. */

export function getBlockedGroups(): Record<string, ScanlationGroupItem> {
  const stored = Application.getState(SETTING_KEYS.blockedGroups);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }
  return { ...(stored as Record<string, ScanlationGroupItem>) };
}

export const saveBlockedGroups = (v: Record<string, ScanlationGroupItem>): void =>
  setKey(SETTING_KEYS.blockedGroups, v);
/** The blocked group ids to exclude from requests; none while group blocking is off. */
export const getActiveBlockedGroupIds = (): string[] =>
  getGroupBlockingEnabled() ? Object.keys(getBlockedGroups()) : [];
export const getGroupBlockingEnabled = (): boolean =>
  getKey(SETTING_KEYS.groupBlockingEnabled, false);
export const setGroupBlockingEnabled = (v: boolean): void =>
  setKey(SETTING_KEYS.groupBlockingEnabled, v);
export const getFuzzyBlockingEnabled = (): boolean =>
  getKey(SETTING_KEYS.fuzzyBlockingEnabled, false);
export const setFuzzyBlockingEnabled = (v: boolean): void =>
  setKey(SETTING_KEYS.fuzzyBlockingEnabled, v);
export const getBlockedUploaders = (): string[] =>
  readStringArray(SETTING_KEYS.blockedUploaders, () => []);
export const setBlockedUploaders = (v: string[]): void => setKey(SETTING_KEYS.blockedUploaders, v);
