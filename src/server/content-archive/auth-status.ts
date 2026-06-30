import "server-only";

import { resolveContentArchiveImageCookie } from "@/lib/content-archive/image-cookie";
import {
  contentArchiveEnvBearerToken,
  contentArchiveEnvRefreshToken,
  libSocialTokenExpiry,
} from "./access";
import { readContentArchiveAuthStore } from "./auth-store";

export type ContentArchiveAuthSource = "ui" | "env" | "none";
export type ContentArchiveAuthReadiness = "ready" | "expired" | "missing";

export type ContentArchiveAuthStatus = {
  tokenConfigured: boolean;
  tokenSource: ContentArchiveAuthSource;
  tokenUpdatedAt: Date | null;
  tokenExpiresAt: Date | null;
  refreshTokenConfigured: boolean;
  refreshTokenSource: ContentArchiveAuthSource;
  refreshTokenUpdatedAt: Date | null;
  lastTokenRefreshAt: Date | null;
  imageCookieConfigured: boolean;
  imageCookieSource: ContentArchiveAuthSource;
  imageCookieUpdatedAt: Date | null;
  lastTestedAt: Date | null;
  readiness: ContentArchiveAuthReadiness;
  readyDetail: string;
};

export async function getContentArchiveAuthStatus(input: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  cwd?: string;
} = {}): Promise<ContentArchiveAuthStatus> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const store = await readContentArchiveAuthStore(input);

  const envBearer = contentArchiveEnvBearerToken(env);
  const uiToken = Boolean(store.authorization);
  const tokenConfigured = uiToken || Boolean(envBearer);
  const tokenSource: ContentArchiveAuthSource = uiToken ? "ui" : envBearer ? "env" : "none";
  const tokenExpiresAt = libSocialTokenExpiry(store.authorization ?? envBearer);

  const envRefresh = contentArchiveEnvRefreshToken(env);
  const uiRefresh = Boolean(store.refreshToken);
  const refreshTokenConfigured = uiRefresh || Boolean(envRefresh);
  const refreshTokenSource: ContentArchiveAuthSource = uiRefresh
    ? "ui"
    : envRefresh
      ? "env"
      : "none";

  const envCookie = Boolean(
    resolveContentArchiveImageCookie("mangalib", env) ??
      resolveContentArchiveImageCookie("hentailib", env),
  );
  const uiCookie = Boolean(store.imageCookie);
  const imageCookieConfigured = uiCookie || envCookie;
  const imageCookieSource: ContentArchiveAuthSource = uiCookie ? "ui" : envCookie ? "env" : "none";

  const usableBearer =
    tokenConfigured && (!tokenExpiresAt || tokenExpiresAt.getTime() > now.getTime());
  const { readiness, readyDetail } = describeReadiness({
    usableBearer,
    tokenConfigured,
    tokenExpiresAt,
    refreshTokenConfigured,
    refreshTokenSource,
    now,
  });

  return {
    tokenConfigured,
    tokenSource,
    tokenUpdatedAt: parseDate(store.tokenUpdatedAt),
    tokenExpiresAt,
    refreshTokenConfigured,
    refreshTokenSource,
    refreshTokenUpdatedAt: parseDate(store.refreshTokenUpdatedAt),
    lastTokenRefreshAt: parseDate(store.lastTokenRefreshAt),
    imageCookieConfigured,
    imageCookieSource,
    imageCookieUpdatedAt: parseDate(store.imageCookieUpdatedAt),
    lastTestedAt: parseDate(store.lastTestedAt),
    readiness,
    readyDetail,
  };
}

function describeReadiness(input: {
  usableBearer: boolean;
  tokenConfigured: boolean;
  tokenExpiresAt: Date | null;
  refreshTokenConfigured: boolean;
  refreshTokenSource: ContentArchiveAuthSource;
  now: Date;
}): { readiness: ContentArchiveAuthReadiness; readyDetail: string } {
  if (input.usableBearer) {
    return {
      readiness: "ready",
      readyDetail: input.tokenExpiresAt
        ? `Bearer token valid for ${formatRelativeFuture(input.tokenExpiresAt, input.now)}.`
        : "Bearer token saved and ready.",
    };
  }
  if (input.refreshTokenConfigured) {
    return {
      readiness: "ready",
      readyDetail:
        input.tokenConfigured && input.tokenExpiresAt
          ? "Bearer token expired — a fresh one will be minted from the refresh token on the next job."
          : "Refresh token saved — a bearer token will be minted on the next job.",
    };
  }
  if (input.tokenConfigured && input.tokenExpiresAt) {
    return {
      readiness: "expired",
      readyDetail: "Bearer token expired and no refresh token saved. Save a fresh token below.",
    };
  }
  return {
    readiness: "missing",
    readyDetail: "No bearer or refresh token saved. Add one below to start archiving LibSocial.",
  };
}

function formatRelativeFuture(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return "less than a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
