/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { expect } from "chai";

/**
 * The error `work` rejects with. Fails the test if it resolves, so a missing
 * failure cannot pass as "threw nothing interesting".
 */
export async function rejectionOf(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    expect(error, "rejection reason").to.be.instanceOf(Error);
    return error as Error;
  }
  expect.fail("expected the promise to reject");
}
