import "server-only";

import { resolveContentArchiveImageCookie } from "@/lib/content-archive/image-cookie";
import {
  type LibSocialContentArchiveSourceKey,
  type SupportedContentArchiveSourceKey,
} from "@/lib/content-archive/planning";
import {
  readContentArchiveAuthStore,
  recordRefreshedContentArchiveBearer,
} from "./auth-store";

// Standalone (mangaloader) access resolver. There is no database: authorization
// and the optional DDoS-Guard image cookie come from the local UI auth store
// first (.atlas-backups/content-archive-auth.json) and then fall back to env
// vars. `userId` is accepted for worker signature compatibility but ignored.

const REFRESH_EARLY_MS = 5 * 60 * 1000;

const inFlightRefreshes = new Map<string, Promise<ResolvedAuthorization>>();

export type ContentArchiveAccess = {
  authorization?: string;
  imageCookie: string | null;
  refreshed: boolean;
  tokenExpiresAt: Date | null;
  tokenSource: "ui" | "env" | "none";
  refreshTokenSource: "ui" | "env" | "none";
};

type ResolvedAuthorization = Omit<ContentArchiveAccess, "imageCookie">;

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
  const store = await readContentArchiveAuthStore(input);
  const imageCookie = resolveContentArchiveImageCookie(source, env, store.imageCookie);
  const auth = await resolveStoreOrEnvAuthorization({ ...input, env, store });
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

async function resolveStoreOrEnvAuthorization(
  input: ResolveContentArchiveAccessInput & {
    env: NodeJS.ProcessEnv;
    store: Awaited<ReturnType<typeof readContentArchiveAuthStore>>;
  },
): Promise<ResolvedAuthorization> {
  const { env, store } = input;
  const now = input.now ?? new Date();

  const storeBearer = store.authorization;
  const envBearer = contentArchiveEnvBearerToken(env);
  const existingAuthorization = storeBearer ?? envBearer;
  const existingSource: "ui" | "env" | "none" = storeBearer ? "ui" : envBearer ? "env" : "none";
  const existingExpiry = libSocialTokenExpiry(existingAuthorization);

  const storeRefresh = store.refreshToken;
  const envRefresh = contentArchiveEnvRefreshToken(env);
  const refreshToken = storeRefresh ?? envRefresh;
  const refreshSource: "ui" | "env" | "none" = storeRefresh ? "ui" : envRefresh ? "env" : "none";

  if (
    existingAuthorization &&
    !input.forceRefresh &&
    tokenHasUsefulLifetime(existingExpiry, now, REFRESH_EARLY_MS)
  ) {
    return {
      authorization: normalizeLibSocialAuthorization(existingAuthorization),
      refreshed: false,
      tokenExpiresAt: existingExpiry,
      tokenSource: existingSource,
      refreshTokenSource: refreshSource,
    };
  }

  if (!refreshToken) {
    if (input.allowMissing ?? true) return missingContentArchiveAuthorization(existingExpiry);
    throw new Error(
      existingAuthorization && existingExpiry
        ? "LibSocial bearer token is expired. Save a fresh bearer or a refresh token in the LibSocial auth panel."
        : "LibSocial bearer token is not configured. Save a bearer or refresh token in the LibSocial auth panel (or set it in .env.local).",
    );
  }

  try {
    return await withSerializedRefresh(refreshToken, async () => {
      const refreshed = await refreshLibSocialAuthorization({
        env,
        fetchImpl: input.fetchImpl ?? fetch,
        refreshToken,
      });
      const authorization = normalizeLibSocialAuthorization(refreshed.authorization);
      await recordRefreshedContentArchiveBearer({
        ...input,
        authorization,
        refreshToken: refreshed.refreshToken,
        now,
      });
      return {
        authorization,
        refreshed: true,
        tokenExpiresAt: libSocialTokenExpiry(authorization),
        tokenSource: "ui",
        refreshTokenSource: "ui",
      };
    });
  } catch (error) {
    if ((input.allowMissing ?? true) && !input.forceRefresh) {
      return missingContentArchiveAuthorization(existingExpiry);
    }
    throw new Error(contentArchiveAccessErrorMessage(error));
  }
}

async function withSerializedRefresh(
  refreshToken: string,
  refresh: () => Promise<ResolvedAuthorization>,
): Promise<ResolvedAuthorization> {
  const existing = inFlightRefreshes.get(refreshToken);
  if (existing) return existing;
  const promise = refresh().finally(() => {
    if (inFlightRefreshes.get(refreshToken) === promise) {
      inFlightRefreshes.delete(refreshToken);
    }
  });
  inFlightRefreshes.set(refreshToken, promise);
  return promise;
}

async function refreshLibSocialAuthorization(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  refreshToken: string;
}): Promise<{ authorization: string; refreshToken: string | null }> {
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
  return {
    authorization: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
  };
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
): ResolvedAuthorization {
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
