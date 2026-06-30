import "server-only";

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveContentArchivePaths } from "./run-state";

// Local, single-user credential store. Atlas keeps these in an encrypted DB row;
// mangaloader has no database, so UI-saved secrets live in a 0600 JSON file under
// the archive root (gitignored, excluded from the build trace). Same trust model
// as `.env.local`: it stays on your machine.

const STORE_FILE_NAME = "content-archive-auth.json";

export type ContentArchiveAuthStore = {
  authorization: string | null;
  tokenUpdatedAt: string | null;
  refreshToken: string | null;
  refreshTokenUpdatedAt: string | null;
  lastTokenRefreshAt: string | null;
  imageCookie: string | null;
  imageCookieUpdatedAt: string | null;
  lastTestedAt: string | null;
};

type StorePathInput = { cwd?: string; env?: NodeJS.ProcessEnv };

export function contentArchiveAuthStorePath(input: StorePathInput = {}): string {
  return join(resolveContentArchivePaths(input).archiveRoot, STORE_FILE_NAME);
}

const EMPTY_STORE: ContentArchiveAuthStore = {
  authorization: null,
  tokenUpdatedAt: null,
  refreshToken: null,
  refreshTokenUpdatedAt: null,
  lastTokenRefreshAt: null,
  imageCookie: null,
  imageCookieUpdatedAt: null,
  lastTestedAt: null,
};

export async function readContentArchiveAuthStore(
  input: StorePathInput = {},
): Promise<ContentArchiveAuthStore> {
  const path = contentArchiveAuthStorePath(input);
  if (!existsSync(/* turbopackIgnore: true */ path)) return { ...EMPTY_STORE };
  try {
    const parsed = JSON.parse(
      await readFile(/* turbopackIgnore: true */ path, "utf8"),
    ) as Record<string, unknown>;
    return {
      authorization: stringOrNull(parsed.authorization),
      tokenUpdatedAt: stringOrNull(parsed.tokenUpdatedAt),
      refreshToken: stringOrNull(parsed.refreshToken),
      refreshTokenUpdatedAt: stringOrNull(parsed.refreshTokenUpdatedAt),
      lastTokenRefreshAt: stringOrNull(parsed.lastTokenRefreshAt),
      imageCookie: stringOrNull(parsed.imageCookie),
      imageCookieUpdatedAt: stringOrNull(parsed.imageCookieUpdatedAt),
      lastTestedAt: stringOrNull(parsed.lastTestedAt),
    };
  } catch {
    return { ...EMPTY_STORE };
  }
}

async function writeContentArchiveAuthStore(
  store: ContentArchiveAuthStore,
  input: StorePathInput = {},
): Promise<void> {
  const archiveRoot = resolveContentArchivePaths(input).archiveRoot;
  await mkdir(/* turbopackIgnore: true */ archiveRoot, { recursive: true, mode: 0o700 });
  const path = join(archiveRoot, STORE_FILE_NAME);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(/* turbopackIgnore: true */ tmp, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(/* turbopackIgnore: true */ tmp, path);
}

async function mutateStore(
  input: StorePathInput,
  mutate: (store: ContentArchiveAuthStore) => ContentArchiveAuthStore,
): Promise<ContentArchiveAuthStore> {
  const current = await readContentArchiveAuthStore(input);
  const next = mutate({ ...current });
  await writeContentArchiveAuthStore(next, input);
  return next;
}

export async function saveContentArchiveStoreBearerToken(
  input: { authorization?: string | null; clearAuthorization?: boolean } & StorePathInput,
): Promise<void> {
  if (!input.clearAuthorization && !input.authorization?.trim()) {
    throw new Error("Paste a bearer token or choose Clear.");
  }
  const now = new Date().toISOString();
  await mutateStore(input, (store) => {
    if (input.clearAuthorization) {
      store.authorization = null;
      store.tokenUpdatedAt = null;
    } else {
      store.authorization = normalizeStoreBearer(input.authorization!);
      store.tokenUpdatedAt = now;
    }
    return store;
  });
}

export async function saveContentArchiveStoreRefreshToken(
  input: { refreshToken?: string | null; clearRefreshToken?: boolean } & StorePathInput,
): Promise<void> {
  if (!input.clearRefreshToken && !input.refreshToken?.trim()) {
    throw new Error("Paste a refresh token or choose Clear.");
  }
  const now = new Date().toISOString();
  await mutateStore(input, (store) => {
    if (input.clearRefreshToken) {
      store.refreshToken = null;
      store.refreshTokenUpdatedAt = null;
      return store;
    }
    store.refreshToken = input.refreshToken!.trim();
    store.refreshTokenUpdatedAt = now;
    // Drop any stored bearer so the next request mints a fresh one from this
    // refresh token instead of reusing a possibly-stale access token.
    store.authorization = null;
    store.tokenUpdatedAt = null;
    store.lastTokenRefreshAt = null;
    return store;
  });
}

export async function saveContentArchiveStoreImageCookie(
  input: { imageCookie?: string | null; clearImageCookie?: boolean } & StorePathInput,
): Promise<void> {
  if (!input.clearImageCookie && !input.imageCookie?.trim()) {
    throw new Error("Paste an image Cookie header value or choose Clear.");
  }
  const now = new Date().toISOString();
  await mutateStore(input, (store) => {
    if (input.clearImageCookie) {
      store.imageCookie = null;
      store.imageCookieUpdatedAt = null;
    } else {
      store.imageCookie = input.imageCookie!.trim();
      store.imageCookieUpdatedAt = now;
    }
    return store;
  });
}

export async function recordRefreshedContentArchiveBearer(
  input: {
    authorization: string;
    refreshToken?: string | null;
    now?: Date;
  } & StorePathInput,
): Promise<void> {
  const stamp = (input.now ?? new Date()).toISOString();
  await mutateStore(input, (store) => {
    store.authorization = normalizeStoreBearer(input.authorization);
    store.tokenUpdatedAt = stamp;
    store.lastTokenRefreshAt = stamp;
    if (input.refreshToken?.trim()) {
      store.refreshToken = input.refreshToken.trim();
      store.refreshTokenUpdatedAt = stamp;
    }
    return store;
  });
}

export async function recordContentArchiveAuthTested(
  input: { now?: Date } & StorePathInput = {},
): Promise<void> {
  const stamp = (input.now ?? new Date()).toISOString();
  await mutateStore(input, (store) => {
    store.lastTestedAt = stamp;
    return store;
  });
}

function normalizeStoreBearer(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("Bearer ") ? trimmed : `Bearer ${trimmed}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
