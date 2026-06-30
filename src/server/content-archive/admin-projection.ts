import "server-only";

import type { ContentArchiveRun } from "@/lib/content-archive/run-records";
import {
  getContentArchiveAuthStatus,
  type ContentArchiveAuthStatus,
} from "./auth-status";
import {
  planLibSocialArchiveChaptersFromUrl,
  type LibSocialArchiveChapterPlan,
} from "./mangalib-analysis";
import { listContentArchiveRuns, readContentArchiveLogTail } from "./run-state";

export type { LibSocialArchiveChapterPlan } from "./mangalib-analysis";
export type { ContentArchiveAuthStatus } from "./auth-status";

export type ContentArchiveAdminSearchParams = {
  content_archive_status?: string;
  content_archive_message?: string;
  content_archive_run?: string;
  content_archive_input?: string;
  content_archive_image_server_id?: string;
};

export type ContentArchiveAdminRunItem = {
  run: ContentArchiveRun;
  log: string | null;
};

export type ContentArchiveQueueFormDefaults = {
  returnTo: string;
  distinctChapterCount: number;
  optionCount: number;
  selectorKey: string;
};

export type ContentArchiveFeedbackView =
  | {
      status: "ok" | "error";
      message: string;
      runId: string | null;
    }
  | null;

export type ContentArchiveAdminView = {
  sourceInput: string;
  selectedImageServerId: string | null;
  chapterPlan: LibSocialArchiveChapterPlan | null;
  queueForm: ContentArchiveQueueFormDefaults | null;
  libSocialSettings: ContentArchiveAuthStatus;
  feedback: ContentArchiveFeedbackView;
  runItems: ContentArchiveAdminRunItem[];
  recentRunLimit: number;
  runPanelKey: string;
};

const CONTENT_ARCHIVE_RUN_FETCH_LIMIT = 8;
const CONTENT_ARCHIVE_RECENT_RUN_LIMIT = 4;

export async function loadContentArchiveAdminView(input: {
  params: ContentArchiveAdminSearchParams;
}): Promise<ContentArchiveAdminView> {
  const sourceInput = input.params.content_archive_input?.trim() ?? "";
  const selectedImageServerId =
    input.params.content_archive_image_server_id?.trim() || null;
  const chapterPlan = sourceInput
    ? await planLibSocialArchiveChaptersFromUrl({
        sourceInput,
        imageServerId: selectedImageServerId,
      })
    : null;
  const [runItems, libSocialSettings] = await Promise.all([
    loadContentArchiveRunItems({ limit: CONTENT_ARCHIVE_RUN_FETCH_LIMIT }),
    getContentArchiveAuthStatus(),
  ]);

  return {
    sourceInput,
    selectedImageServerId,
    chapterPlan,
    queueForm: chapterPlan?.ok ? createQueueFormDefaults(chapterPlan) : null,
    libSocialSettings,
    feedback: normalizeContentArchiveFeedback(input.params),
    runItems,
    recentRunLimit: CONTENT_ARCHIVE_RECENT_RUN_LIMIT,
    runPanelKey: contentArchiveRunPanelKey(runItems),
  };
}

async function loadContentArchiveRunItems(input: {
  limit: number;
}): Promise<ContentArchiveAdminRunItem[]> {
  const runs = await listContentArchiveRuns({ limit: input.limit });
  return Promise.all(
    runs.map(async (run) => ({
      run,
      log: await readContentArchiveLogTail(run.logFile),
    })),
  );
}

function createQueueFormDefaults(
  plan: Extract<LibSocialArchiveChapterPlan, { ok: true }>,
): ContentArchiveQueueFormDefaults {
  const firstChapterKey = plan.chapters[0]?.selectionKey ?? "none";
  const lastChapterKey = plan.chapters[plan.chapters.length - 1]?.selectionKey ?? "none";
  return {
    returnTo: `/?content_archive_input=${encodeURIComponent(plan.sourceInput)}${
      plan.defaultImageServerId
        ? `&content_archive_image_server_id=${encodeURIComponent(plan.defaultImageServerId)}`
        : ""
    }`,
    distinctChapterCount: new Set(plan.chapters.map((chapter) => chapter.id)).size,
    optionCount: plan.chapters.length,
    selectorKey: `${plan.slug}:${plan.defaultImageServerId ?? "default"}:${plan.chapters.length}:${firstChapterKey}:${lastChapterKey}`,
  };
}

function normalizeContentArchiveFeedback(
  params: ContentArchiveAdminSearchParams,
): ContentArchiveFeedbackView {
  const message = params.content_archive_message?.trim();
  const status = params.content_archive_status;
  if (!message || (status !== "ok" && status !== "error")) return null;
  return {
    status,
    message,
    runId: params.content_archive_run?.trim() || null,
  };
}

function contentArchiveRunPanelKey(items: ContentArchiveAdminRunItem[]): string {
  return items
    .map((item) => `${item.run.runId}:${item.run.status}:${item.run.finishedAt ?? ""}`)
    .join("|");
}
