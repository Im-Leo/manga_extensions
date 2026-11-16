/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

/**
 * A decoder for Dean Edwards' packer (`eval(function(p,a,c,k,e,d){...}(...))`),
 * which the site wraps its page URLs in.
 *
 * The packer replaces every word of the source with a base-`a` index into a
 * dictionary `k`, then ships a function that substitutes them back. Decoding is
 * that substitution done here, as data, so nothing the site sends is executed.
 */

/** The packer's call: payload, radix, word count, and the `|`-joined dictionary. */
const PACKED_CALL =
  /\}\s*\(\s*'((?:[^'\\]|\\[\s\S])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\[\s\S])*)'\.split\('\|'\)/;

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v" };

/** Reads the body of a single-quoted JavaScript string literal. */
export function unescapeLiteral(body: string): string {
  return body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, escape: string) => {
    if (escape.length > 1) return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ESCAPES[escape] ?? escape;
  });
}

/** The packer's own `e`: an index written in base `radix`, digits past 35 as letters from "A". */
function encodeIndex(index: number, radix: number): string {
  const digit = index % radix;
  const prefix = index < radix ? "" : encodeIndex(Math.floor(index / radix), radix);
  return prefix + (digit > 35 ? String.fromCharCode(digit + 29) : digit.toString(36));
}

/** The source a packed script evaluates to, or undefined if `script` holds no packer call. */
export function unpack(script: string): string | undefined {
  const call = PACKED_CALL.exec(script);
  if (!call) return undefined;

  const [, payload = "", radixText = "", countText = "", words = ""] = call;
  const radix = Number(radixText);
  const count = Number(countText);
  const dictionary = unescapeLiteral(words).split("|");

  const lookup = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    const key = encodeIndex(index, radix);
    lookup.set(key, dictionary[index] || key);
  }

  return unescapeLiteral(payload).replace(/\b\w+\b/g, (word) => lookup.get(word) ?? word);
}

/** Joins the string literals of an expression like `''+'d'+'b'+'a'`. */
export function concatenatedLiterals(expression: string): string {
  return [...expression.matchAll(/'((?:[^'\\]|\\[\s\S])*)'/g)]
    .map((match) => unescapeLiteral(match[1] ?? ""))
    .join("");
}
