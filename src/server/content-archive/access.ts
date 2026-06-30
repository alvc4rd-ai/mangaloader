import "server-only";

import { resolveContentArchiveImageCookie } from "@/lib/content-archive/image-cookie";
import {
  type LibSocialContentArchiveSourceKey,
  type SupportedContentArchiveSourceKey,
} from "@/lib/content-archive/planning";

// Standalone (mangaloader) access resolver. Unlike Atlas, there is no database
// or per-user encrypted token store: authorization and the optional DDoS-Guard
// image cookie come entirely from environment variables. `userId` is accepted
// for signature compatibility with the worker but ignored.

const REFRESH_EARLY_MS = 5 * 60 * 1000;

export type ContentArchiveAccess = {
  authorization?: string;
  imageCookie: string | null;
  refreshed: boolean;
  tokenExpiresAt: Date | null;
  tokenSource: "ui" | "env" | "none";
  refreshTokenSource: "ui" | "env" | "none";
};

export type ResolveContentArchiveAccessInput = {
  source: SupportedContentArchiveSourceKey;
  userId?: string | null;
  forceRefresh?: boolean;
  allowMissing?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

export async function resolveContentArchiveAccess(
  input: ResolveContentArchiveAccessInput,
): Promise<ContentArchiveAccess> {
  if (input.source === "nhentai") {
    return {
      authorization: undefined,
      imageCookie: null,
      refreshed: false,
      tokenExpiresAt: null,
      tokenSource: "none",
      refreshTokenSource: "none",
    };
  }

  const source = input.source as LibSocialContentArchiveSourceKey;
  const env = input.env ?? process.env;
  const imageCookie = resolveContentArchiveImageCookie(source, env);
  const auth = await resolveEnvAuthorization({ ...input, env });
  return { ...auth, imageCookie };
}

export async function withContentArchiveAccessRetry<T>(
  input: ResolveContentArchiveAccessInput,
  operation: (access: ContentArchiveAccess) => Promise<T>,
): Promise<T> {
  const access = await resolveContentArchiveAccess({ ...input, forceRefresh: false });
  try {
    return await operation(access);
  } catch (error) {
    if (input.source === "nhentai" || !isContentArchiveAccessRefreshCandidate(error)) {
      throw error;
    }
    const refreshed = await resolveContentArchiveAccess({
      ...input,
      allowMissing: false,
      forceRefresh: true,
    });
    return operation(refreshed);
  }
}

export function isContentArchiveAccessRefreshCandidate(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b(401|403)\b|rejected the configured bearer token/i.test(message) ||
    /returned 404:[\s\S]*"message"\s*:\s*"Not Found"/i.test(message)
  );
}

export function contentArchiveAccessErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._-]{20,}\b/g, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9._-]{20,}\b/g, "[redacted-token]")
    .replace(/\bdef50200[A-Za-z0-9._-]{20,}\b/g, "[redacted-refresh-token]")
    .replace(/refresh_token["':=\s]+[A-Za-z0-9._-]{20,}/gi, "refresh_token=[redacted]");
}

async function resolveEnvAuthorization(
  input: ResolveContentArchiveAccessInput & { env: NodeJS.ProcessEnv },
): Promise<Omit<ContentArchiveAccess, "imageCookie">> {
  const env = input.env;
  const envAuthorization = contentArchiveEnvBearerToken(env);
  const expiresAt = libSocialTokenExpiry(envAuthorization);
  if (
    envAuthorization &&
    !input.forceRefresh &&
    tokenHasUsefulLifetime(expiresAt, input.now ?? new Date(), REFRESH_EARLY_MS)
  ) {
    return {
      authorization: normalizeLibSocialAuthorization(envAuthorization),
      refreshed: false,
      tokenExpiresAt: expiresAt,
      tokenSource: "env",
      refreshTokenSource: contentArchiveEnvRefreshToken(env) ? "env" : "none",
    };
  }

  const refreshToken = contentArchiveEnvRefreshToken(env);
  if (!refreshToken) {
    if (input.allowMissing ?? true) return missingContentArchiveAuthorization(expiresAt);
    throw new Error(
      envAuthorization && expiresAt
        ? "LibSocial bearer token is expired. Set a fresh ATLAS_CONTENT_ARCHIVE_MANGALIB_BEARER_TOKEN or a refresh token."
        : "LibSocial bearer token is not configured. Set ATLAS_CONTENT_ARCHIVE_MANGALIB_BEARER_TOKEN (or a refresh token) in .env.local.",
    );
  }

  try {
    const refreshed = await refreshEnvLibSocialAuthorization({
      env,
      fetchImpl: input.fetchImpl ?? fetch,
      refreshToken,
    });
    const authorization = normalizeLibSocialAuthorization(refreshed.authorization);
    return {
      authorization,
      refreshed: true,
      tokenExpiresAt: libSocialTokenExpiry(authorization),
      tokenSource: "env",
      refreshTokenSource: "env",
    };
  } catch (error) {
    if ((input.allowMissing ?? true) && !input.forceRefresh) {
      return missingContentArchiveAuthorization(expiresAt);
    }
    throw new Error(contentArchiveAccessErrorMessage(error));
  }
}

async function refreshEnvLibSocialAuthorization(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  refreshToken: string;
}): Promise<{ authorization: string }> {
  const response = await input.fetchImpl(`${contentArchiveAuthBase(input.env)}/auth/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://mangalib.me",
      Referer: "https://mangalib.me/",
      "Site-Id": "1",
      Site_Id: "1",
      "User-Agent": "mangaloader/1.0 (content archive token refresh)",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: "1",
      refresh_token: input.refreshToken,
      scope: "",
    }),
  });
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    // Keep the thrown error token-safe below.
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "LibSocial refresh token was rejected (revoked or already rotated). Log in through a dedicated private browser window and paste that session's refresh token.",
      );
    }
    throw new Error(`LibSocial token refresh failed with status ${response.status}.`);
  }
  const data = isObject(parsed) && isObject(parsed.data) ? parsed.data : parsed;
  if (!isObject(data) || typeof data.access_token !== "string") {
    throw new Error("LibSocial token refresh did not return an access token.");
  }
  return { authorization: data.access_token };
}

export function contentArchiveEnvBearerToken(env: NodeJS.ProcessEnv): string | null {
  return firstConfiguredEnv(env, [
    "ATLAS_CONTENT_ARCHIVE_MANGALIB_BEARER_TOKEN",
    "MANGALIB_BEARER_TOKEN",
    "LIBSOCIAL_AUTHORIZATION",
  ]);
}

export function contentArchiveEnvRefreshToken(env: NodeJS.ProcessEnv): string | null {
  return firstConfiguredEnv(env, ["MANGALIB_REFRESH_TOKEN", "LIBSOCIAL_REFRESH_TOKEN"]);
}

function contentArchiveAuthBase(env: NodeJS.ProcessEnv): string {
  return trimTrailingSlash(env.LIBSOCIAL_AUTH_BASE?.trim() || "https://api.cdnlibs.org/api");
}

function firstConfiguredEnv(env: NodeJS.ProcessEnv, names: string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function missingContentArchiveAuthorization(
  tokenExpiresAt: Date | null = null,
): Omit<ContentArchiveAccess, "imageCookie"> {
  return {
    authorization: undefined,
    refreshed: false,
    tokenExpiresAt,
    tokenSource: "none",
    refreshTokenSource: "none",
  };
}

function tokenHasUsefulLifetime(
  expiresAt: Date | null,
  now: Date,
  minimumTtlMs: number,
): boolean {
  return !expiresAt || expiresAt.getTime() - now.getTime() > minimumTtlMs;
}

export function libSocialTokenExpiry(token: string | null | undefined): Date | null {
  if (!token) return null;
  const raw = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();
  const segments = raw.split(".");
  if (segments.length < 2 || !segments[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    const exp = typeof payload.exp === "number" ? payload.exp : Number(payload.exp);
    if (!Number.isFinite(exp) || exp <= 0) return null;
    return new Date(exp * 1000);
  } catch {
    return null;
  }
}

export function normalizeLibSocialAuthorization(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("Bearer ") ? trimmed : `Bearer ${trimmed}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
