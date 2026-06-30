import "server-only";

import {
  acquireContentArchiveSourcePlan,
  type ContentArchiveSourcePlan,
} from "@/lib/content-archive/source-acquisition";
import {
  type LibSocialContentArchiveSourceKey,
  parseContentArchiveUrlInput,
  sourceLabel,
} from "@/lib/content-archive/planning";
import {
  contentArchiveAccessErrorMessage,
  withContentArchiveAccessRetry,
} from "@/server/content-archive/access";
import { loadContentArchiveLocalEnv } from "./local-env";

export type MangaLibArchiveChapterPlan =
  LibSocialArchiveChapterPlan;

export type LibSocialArchiveChapterPlan = ContentArchiveSourcePlan;

export async function planMangaLibArchiveChapters(input: {
  imageServerId?: string | null;
  sourceInput: string;
  userId?: string | null;
}): Promise<MangaLibArchiveChapterPlan> {
  return planLibSocialArchiveChapters({ ...input, source: "mangalib" });
}

export async function planLibSocialArchiveChapters(input: {
  imageServerId?: string | null;
  source: LibSocialContentArchiveSourceKey;
  sourceInput: string;
  userId?: string | null;
}): Promise<LibSocialArchiveChapterPlan> {
  loadContentArchiveLocalEnv();
  const sourceInput = input.sourceInput.trim();
  const label = sourceLabel(input.source);
  if (!sourceInput) {
    return {
      ok: false,
      source: input.source,
      sourceInput,
      message: `Paste a ${label} title link, slug, or id.`,
    };
  }
  try {
    return await withContentArchiveAccessRetry(
      {
        source: input.source,
        userId: input.userId,
        allowMissing: true,
      },
      (access) =>
        acquireContentArchiveSourcePlan({
          source: input.source,
          sourceInput,
          authorization: access.authorization,
          estimateSizes: true,
          imageServerId: input.imageServerId ?? null,
          imageCookie: access.imageCookie,
        }),
    );
  } catch (error) {
    return {
      ok: false,
      source: input.source,
      sourceInput,
      message: error instanceof Error ? contentArchiveAccessErrorMessage(error) : `${label} chapter analysis failed.`,
    };
  }
}

export async function planLibSocialArchiveChaptersFromUrl(input: {
  imageServerId?: string | null;
  sourceInput: string;
  userId?: string | null;
}): Promise<LibSocialArchiveChapterPlan> {
  const sourceInput = input.sourceInput.trim();
  const parsed = parseContentArchiveUrlInput(sourceInput);
  if (!parsed) {
    return {
      ok: false,
      source: null,
      sourceInput,
      message: "Paste a MangaLib, SlashLib, HentaiLib, or nHentai title URL.",
    };
  }
  if (parsed.source === "nhentai") {
    return planNHentaiArchiveChapters({
      sourceInput,
      imageServerId: input.imageServerId,
    });
  }
  return planLibSocialArchiveChapters({
    source: parsed.source,
    sourceInput,
    imageServerId: input.imageServerId,
    userId: input.userId,
  });
}

export async function planNHentaiArchiveChapters(input: {
  imageServerId?: string | null;
  sourceInput: string;
}): Promise<LibSocialArchiveChapterPlan> {
  loadContentArchiveLocalEnv();
  const sourceInput = input.sourceInput.trim();
  if (!sourceInput) {
    return {
      ok: false,
      source: "nhentai",
      sourceInput,
      message: "Paste a nHentai gallery link or code.",
    };
  }
  try {
    return await acquireContentArchiveSourcePlan({
      source: "nhentai",
      sourceInput,
      estimateSizes: true,
      imageServerId: input.imageServerId ?? null,
    });
  } catch (error) {
    return {
      ok: false,
      source: "nhentai",
      sourceInput,
      message: error instanceof Error ? error.message : "nHentai gallery analysis failed.",
    };
  }
}
