/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

export type QueryValue = string | number;

/**
 * Builds a URL from path segments and query parameters, in the order added.
 *
 * Values are interpolated verbatim, so callers encode free text themselves. That is deliberate:
 * AsuraScans' search sends a pre-encoded `%` wildcard that encoding again would break.
 */
export class URLBuilder {
  private readonly baseUrl: string;
  private readonly queryParams: [string, QueryValue][] = [];
  private readonly pathSegments: string[] = [];

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  addPath(segment: string): this {
    this.pathSegments.push(segment.replace(/^\/+|\/+$/g, ""));
    return this;
  }

  /** An empty value means "unset", not an empty parameter. */
  addQuery(key: string, value: QueryValue): this {
    if (value !== "") this.queryParams.push([key, value]);
    return this;
  }

  build(): string {
    const path = this.pathSegments.length > 0 ? `/${this.pathSegments.join("/")}` : "";
    const query = this.queryParams.map(([key, value]) => `${key}=${value}`).join("&");
    return query.length > 0 ? `${this.baseUrl}${path}?${query}` : `${this.baseUrl}${path}`;
  }
}
