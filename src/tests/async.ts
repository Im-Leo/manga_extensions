/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { expect } from "chai";

/**
 * The error `work` rejects with. Fails the test if it resolves, so a missing
 * failure cannot pass as "threw nothing interesting".
 */
export async function rejectionOf(work: Promise<unknown>): Promise<Error> {
  let rejection: unknown;
  try {
    await work;
  } catch (error) {
    rejection = error;
  }

  expect(rejection, "expected the promise to reject with an Error").to.be.instanceOf(Error);
  return rejection as Error;
}
