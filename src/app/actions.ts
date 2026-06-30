"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  normalizeContentArchiveSourceKey,
  parseContentArchiveUrlInput,
  parseContentArchiveRunMode,
  sourceLabel,
} from "@/lib/content-archive/planning";
import {
  contentArchivePageDelayForLane,
  DEFAULT_CONTENT_ARCHIVE_SPEED_LANE,
  parseContentArchiveSpeedLane,
} from "@/lib/content-archive/pacing";
import { parseLibSocialArchiveChapterSelectionKey } from "@/lib/content-archive/mangalib-reader";
import { queueContentArchiveRun } from "@/server/content-archive/run-state";
import {
  contentArchiveAccessErrorMessage,
  resolveContentArchiveAccess,
} from "@/server/content-archive/access";
import {
  recordContentArchiveAuthTested,
  saveContentArchiveStoreBearerToken,
  saveContentArchiveStoreImageCookie,
  saveContentArchiveStoreRefreshToken,
} from "@/server/content-archive/auth-store";

// Single-user, no-auth queue action. Credentials come from `.env.local`, so the
// run is owned by a fixed local identity (the worker resolves auth from env and
// ignores this value).
const LOCAL_USER_ID = "local";

export async function startContentArchiveJob(formData: FormData) {
  const sourceInput = stringField(formData, "source_input");
  const title = stringField(formData, "title");
  const coverUrl = stringField(formData, "cover_url");
  const imageServerId = stringField(formData, "image_server_id");
  const urlInput = parseContentArchiveUrlInput(sourceInput);
  const submittedSource = normalizeContentArchiveSourceKey(stringField(formData, "source"));
  const source = urlInput?.source ?? submittedSource ?? null;
  const chapterPicker = stringField(formData, "chapter_picker");
  const chapterSelection = stringField(formData, "chapter_selection");
  const checkedChapterRefs = chapterRefsField(formData, "chapter_refs");
  const checkedChapterIds = chapterIdsField(formData, "chapter_ids");
  const chapterRefs =
    chapterSelection === "all"
      ? null
      : chapterSelection === "selected" || chapterPicker === "checkboxes"
        ? checkedChapterRefs
        : null;
  const chapterIds =
    chapterSelection === "all"
      ? null
      : !chapterRefs && (chapterSelection === "selected" || chapterPicker === "checkboxes")
        ? checkedChapterIds
        : null;
  const chapterRange = chapterRefs || chapterIds ? null : stringField(formData, "chapter_range");
  const runMode = parseContentArchiveRunMode(stringField(formData, "run_mode"));
  const speedLane =
    parseContentArchiveSpeedLane(stringField(formData, "speed_lane")) ??
    DEFAULT_CONTENT_ARCHIVE_SPEED_LANE;
  const returnTo = safeReturnTo(stringField(formData, "return_to"));

  if (!source) {
    redirectWithResult(returnTo, "error", "Paste a MangaLib, nHentai, SlashLib, or HentaiLib title URL.");
  }
  const label = sourceLabel(source);
  if (!sourceInput) {
    redirectWithResult(returnTo, "error", `Paste a ${label} title link, slug, or id.`);
  }
  if ((chapterSelection === "selected" || chapterPicker === "checkboxes") && !chapterRefs && !chapterIds) {
    redirectWithResult(returnTo, "error", `Choose at least one ${label} chapter.`);
  }

  const result = await queueContentArchiveRun({
    userId: LOCAL_USER_ID,
    source,
    sourceInput,
    title,
    coverUrl,
    imageServerId,
    chapterRange,
    chapterIds,
    chapterRefs,
    pageDelayMs: contentArchivePageDelayForLane(source, speedLane),
    speedLane,
    dryRun: runMode === "dry_run",
    upload: runMode === "archive_upload",
  });

  if (!result.ok) {
    redirectWithResult(returnTo, "error", result.message);
  }

  revalidatePath("/");
  redirectWithResult(
    returnTo,
    "ok",
    runMode === "dry_run" ? "Content archive dry run queued." : "Content archive job queued.",
    result.runId,
  );
}

export async function saveContentArchiveLibSocialBearerToken(formData: FormData) {
  const authorization = stringField(formData, "bearer_token");
  const clearAuthorization = formData.get("clear_bearer_token") === "1";
  const returnTo = safeReturnTo(stringField(formData, "return_to"));

  if (!authorization && !clearAuthorization) {
    redirectWithResult(returnTo, "error", "Paste a bearer token or choose Clear.");
  }

  const outcome = await runAuthMutation(() =>
    saveContentArchiveStoreBearerToken({ authorization, clearAuthorization }),
  );
  revalidatePath("/");
  redirectWithResult(
    returnTo,
    outcome.status,
    outcome.message ?? (clearAuthorization ? "Bearer token cleared." : "Bearer token saved."),
  );
}

export async function saveContentArchiveLibSocialRefreshToken(formData: FormData) {
  const refreshToken = stringField(formData, "refresh_token");
  const clearRefreshToken = formData.get("clear_refresh_token") === "1";
  const returnTo = safeReturnTo(stringField(formData, "return_to"));

  if (!refreshToken && !clearRefreshToken) {
    redirectWithResult(returnTo, "error", "Paste a refresh token or choose Clear.");
  }

  const outcome = await runAuthMutation(() =>
    saveContentArchiveStoreRefreshToken({ refreshToken, clearRefreshToken }),
  );
  revalidatePath("/");
  redirectWithResult(
    returnTo,
    outcome.status,
    outcome.message ?? (clearRefreshToken ? "Refresh token cleared." : "Refresh token saved."),
  );
}

export async function saveContentArchiveLibSocialImageCookie(formData: FormData) {
  const imageCookie = stringField(formData, "image_cookie");
  const clearImageCookie = formData.get("clear_image_cookie") === "1";
  const returnTo = safeReturnTo(stringField(formData, "return_to"));

  if (!imageCookie && !clearImageCookie) {
    redirectWithResult(returnTo, "error", "Paste an image Cookie header value or choose Clear.");
  }

  const outcome = await runAuthMutation(() =>
    saveContentArchiveStoreImageCookie({ imageCookie, clearImageCookie }),
  );
  revalidatePath("/");
  redirectWithResult(
    returnTo,
    outcome.status,
    outcome.message ?? (clearImageCookie ? "Image cookie cleared." : "Image cookie saved."),
  );
}

export async function testContentArchiveLibSocialAuth(formData: FormData) {
  const returnTo = safeReturnTo(stringField(formData, "return_to"));

  let status: "ok" | "error" = "ok";
  let message = "";
  try {
    const access = await resolveContentArchiveAccess({ source: "mangalib", allowMissing: false });
    if (!access.authorization) {
      throw new Error("No LibSocial bearer or refresh token is configured.");
    }
    await recordContentArchiveAuthTested({});
    const minted = access.refreshed ? " (minted a fresh one via the refresh token)" : "";
    const expiry = access.tokenExpiresAt ? ` Expires ${formatExpiry(access.tokenExpiresAt)}.` : "";
    message = `LibSocial token ready${minted}.${expiry}`;
  } catch (error) {
    status = "error";
    message = contentArchiveAccessErrorMessage(error);
  }

  revalidatePath("/");
  redirectWithResult(returnTo, status, message);
}

async function runAuthMutation(
  mutation: () => Promise<void>,
): Promise<{ status: "ok" | "error"; message: string | null }> {
  try {
    await mutation();
    return { status: "ok", message: null };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

function stringField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function chapterIdsField(formData: FormData, name: string): number[] | null {
  const ids = formData
    .getAll(name)
    .map((value) => (typeof value === "string" ? Number(value) : NaN))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}

function chapterRefsField(formData: FormData, name: string): string[] | null {
  const refs = formData
    .getAll(name)
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => parseLibSocialArchiveChapterSelectionKey(value));
  return refs.length > 0 ? Array.from(new Set(refs)) : null;
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function redirectWithResult(
  returnTo: string,
  status: "ok" | "error",
  message: string,
  runId?: string,
): never {
  const [path, rawQuery] = returnTo.split("?");
  const params = new URLSearchParams(rawQuery ?? "");
  params.set("content_archive_status", status);
  params.set("content_archive_message", message);
  if (runId) params.set("content_archive_run", runId);
  redirect(`${path}?${params.toString()}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatExpiry(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
