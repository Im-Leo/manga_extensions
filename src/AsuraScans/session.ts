/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { singleFlight } from "../utils/cache";
import { HttpError, InvalidResponseError, fetchResponse, isSuccessStatus } from "../utils/network";
import type { AsuraUser } from "./models";
import { authUrl } from "./urls";

/**
 * The signed-in account: tokens, expiry and profile, kept in secure state.
 *
 * Access tokens are short-lived and every refresh rotates the refresh token,
 * which makes two rules load-bearing:
 *
 * - Refresh only near expiry. Refreshing per request adds a round trip to every
 *   chapter open for nothing.
 * - Never refresh twice at once. Both calls would send the same refresh token;
 *   the first rotates it, the second is rejected, and the user is signed out.
 */

const SESSION_KEY = "session";

/** Plain-state keys from before 1.2.0, when tokens were not kept in secure state. */
const LEGACY_KEYS = [
  "accessToken",
  "refreshToken",
  "tokenExpiration",
  "user",
  "username",
  "password",
  "HQthumb",
  // The removed "Show Upcoming Chapters" setting.
  "prerelease",
];

/** Refresh this far ahead of expiry, so a token cannot lapse between check and use. */
const REFRESH_MARGIN_MS = 60_000;

/** Statuses by which the API says the credentials themselves are wrong, not that it failed. */
const REJECTED_STATUSES = new Set([401, 422]);

export const SIGN_IN_REQUIRED =
  "AsuraScans: sign in under the source settings to use this feature.";

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user?: AsuraUser;
}

interface TokenPayload {
  data: {
    access_token: string;
    refresh_token: string;
    expires_at: string;
    user?: AsuraUser;
  };
}

function isTokenPayload(value: unknown): value is TokenPayload {
  const data = (value as { data?: Record<string, unknown> } | null)?.data;
  return (
    typeof data?.["access_token"] === "string" &&
    typeof data["refresh_token"] === "string" &&
    typeof data["expires_at"] === "string"
  );
}

function readSession(): Session | undefined {
  const stored = Application.getSecureState(SESSION_KEY) as Session | undefined;
  return stored?.accessToken && stored.refreshToken ? stored : undefined;
}

function writeSession(session: Session | undefined): void {
  Application.setSecureState(session, SESSION_KEY);
}

/**
 * Moves a pre-1.2.0 session into secure state and clears the plain-state keys,
 * including any stored password. Safe to call on every launch.
 */
export function migrateLegacySession(): void {
  const accessToken = Application.getState("accessToken");
  const refreshToken = Application.getState("refreshToken");

  if (!readSession() && typeof accessToken === "string" && typeof refreshToken === "string") {
    const expiresAt = Application.getState("tokenExpiration");
    writeSession({
      accessToken,
      refreshToken,
      // Unknown expiry reads as expired, so the first use refreshes.
      expiresAt: typeof expiresAt === "string" ? expiresAt : "",
      user: Application.getState("user") as AsuraUser | undefined,
    });
  }

  for (const key of LEGACY_KEYS) {
    if (Application.getState(key) !== undefined) Application.setState(undefined, key);
  }
}

export function currentUser(): AsuraUser | undefined {
  return readSession()?.user;
}

export function isSignedIn(): boolean {
  return readSession() !== undefined;
}

/** An unparseable expiry counts as due, so a malformed value costs one refresh rather than a failure. */
export function needsRefresh(expiresAt: string, now: number): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry - now <= REFRESH_MARGIN_MS;
}

async function postTokens(url: string, payload: object): Promise<TokenPayload["data"]> {
  const { response, body } = await fetchResponse({
    url,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });

  if (!isSuccessStatus(response.status)) throw new HttpError(response.status, url);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InvalidResponseError(url);
  }
  if (!isTokenPayload(parsed)) throw new InvalidResponseError(url);

  return parsed.data;
}

function isRejection(error: unknown): boolean {
  return error instanceof HttpError && REJECTED_STATUSES.has(error.status);
}

export async function signIn(email: string, password: string): Promise<AsuraUser | undefined> {
  if (!email || !password) throw new Error("AsuraScans: enter both your email and password.");

  let tokens: TokenPayload["data"];
  try {
    tokens = await postTokens(authUrl("login"), { email, password });
  } catch (error) {
    if (isRejection(error))
      throw new Error("AsuraScans: invalid email or password.", { cause: error });
    throw error;
  }

  writeSession({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
    user: tokens.user,
  });
  return tokens.user;
}

export function signOut(): void {
  writeSession(undefined);
}

/**
 * Only a rejection signs the user out. A network error or a 5xx keeps the
 * session, since the refresh token is still good and the next attempt can work.
 */
const refreshSession = singleFlight(async (): Promise<string> => {
  const session = readSession();
  if (!session) throw new Error(SIGN_IN_REQUIRED);

  let tokens: TokenPayload["data"];
  try {
    tokens = await postTokens(authUrl("refresh"), { refresh_token: session.refreshToken });
  } catch (error) {
    if (!isRejection(error)) throw error;
    signOut();
    throw new Error("AsuraScans: your session expired. Sign in again under the source settings.", {
      cause: error,
    });
  }

  writeSession({
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
  });
  return tokens.access_token;
});

/** The current access token, refreshed first when it is close to expiry; undefined when signed out. */
export async function getAccessToken(now: number = Date.now()): Promise<string | undefined> {
  const session = readSession();
  if (!session) return undefined;
  if (!needsRefresh(session.expiresAt, now)) return session.accessToken;
  return refreshSession();
}

/** Like {@link getAccessToken}, but for features that cannot work signed out. */
export async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(SIGN_IN_REQUIRED);
  return token;
}
