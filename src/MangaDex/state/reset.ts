/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { SETTING_KEYS } from "./keys";

/** Restores defaults by clearing every key in the registry. */
export function resetAllSettings(): void {
  for (const key of Object.values(SETTING_KEYS)) {
    Application.setState(undefined, key);
  }
}
