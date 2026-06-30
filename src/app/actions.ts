"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  normalizeContentArchiveSourceKey,
  parseContentArchiveUrlInput,
  parseContentArchiveRunMode,
  sourceLabel,
} from "@/lib/content-archive/planning";
import { parseLibSocialArchiveChapterSelectionKey } from "@/lib/content-archive/mangalib-reader";
import { queueContentArchiveRun } from "@/server/content-archive/run-state";

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
