import {
  parseContentArchiveSpeedLane,
  type ContentArchiveSpeedLane,
} from "./pacing";
import {
  normalizeContentArchiveSourceKey,
  type SupportedContentArchiveSourceKey,
} from "./planning";

export type ContentArchiveRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type ContentArchiveRunProgressStage =
  | "queued"
  | "discovering"
  | "planning"
  | "dry_run"
  | "preparing"
  | "downloading"
  | "packaging"
  | "uploading"
  | "completed"
  | "failed";

export type ContentArchiveRunFailureKind =
  | "auth"
  | "source"
  | "download"
  | "packaging"
  | "upload"
  | "tooling"
  | "unknown";

export type ContentArchiveRunUploadOutcome = {
  status: "not_requested" | "pending" | "running" | "completed" | "failed";
  remoteDir: string | null;
  message: string | null;
  completedAt: string | null;
};

export type ContentArchiveRunProgress = {
  stage: ContentArchiveRunProgressStage;
  percent: number;
  label: string;
  detail: string | null;
  current: number | null;
  total: number | null;
  bytesDownloaded: number | null;
  estimatedBytes: number | null;
  updatedAt: string;
};

export type ContentArchiveRunnerProgressEvent = {
  stage: Exclude<ContentArchiveRunProgressStage, "queued" | "completed" | "failed">;
  percent?: number | null;
  label?: string | null;
  detail?: string | null;
  current?: number | null;
  total?: number | null;
  bytesDownloaded?: number | null;
  estimatedBytes?: number | null;
  manifestPath?: string | null;
  uploadOutcome?: ContentArchiveRunUploadOutcome | null;
};

export type ContentArchiveRun = {
  runId: string;
  userId: string | null;
  source: SupportedContentArchiveSourceKey;
  sourceInput: string;
  externalId: string;
  title: string | null;
  coverUrl: string | null;
  imageServerId: string | null;
  chapterRange: string | null;
  chapterIds: number[] | null;
  chapterRefs: string[] | null;
  pageDelayMs: number | null;
  speedLane: ContentArchiveSpeedLane | null;
  dryRun: boolean;
  upload: boolean;
  status: ContentArchiveRunStatus;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  logFile: string;
  outputDir: string;
  remoteDir: string | null;
  progress: ContentArchiveRunProgress | null;
  failureKind: ContentArchiveRunFailureKind | null;
  failureMessage: string | null;
  manifestPath: string | null;
  uploadOutcome: ContentArchiveRunUploadOutcome | null;
};

type ContentArchiveRunJson = Record<string, unknown>;

export function createContentArchiveRunRecord(input: {
  runId: string;
  userId?: string | null;
  source: SupportedContentArchiveSourceKey;
  sourceInput: string;
  externalId: string;
  title?: string | null;
  coverUrl?: string | null;
  imageServerId?: string | null;
  chapterRange: string | null;
  chapterIds?: number[] | null;
  chapterRefs?: string[] | null;
  pageDelayMs?: number | null;
  speedLane?: ContentArchiveSpeedLane | null;
  dryRun: boolean;
  upload: boolean;
  logFile: string;
  outputDir: string;
  remoteDir: string | null;
  startedAt?: string;
}): ContentArchiveRun {
  return {
    runId: input.runId,
    userId: input.userId ?? null,
    source: input.source,
    sourceInput: input.sourceInput,
    externalId: input.externalId,
    title: input.title?.trim() || null,
    coverUrl: input.coverUrl?.trim() || null,
    imageServerId: input.imageServerId?.trim() || null,
    chapterRange: input.chapterRange,
    chapterIds: normalizeChapterIds(input.chapterIds),
    chapterRefs: normalizeChapterRefs(input.chapterRefs),
    pageDelayMs: normalizeContentArchivePageDelayMs(input.pageDelayMs),
    speedLane: input.speedLane ?? null,
    dryRun: input.dryRun,
    upload: input.upload,
    status: "queued",
    startedAt: input.startedAt ?? new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logFile: input.logFile,
    outputDir: input.outputDir,
    remoteDir: input.remoteDir,
    progress: {
      stage: "queued",
      percent: 0,
      label: "Queued",
      detail: "Waiting to start",
      current: null,
      total: null,
      bytesDownloaded: null,
      estimatedBytes: null,
      updatedAt: input.startedAt ?? new Date().toISOString(),
    },
    failureKind: null,
    failureMessage: null,
    manifestPath: null,
    uploadOutcome: {
      status: input.upload ? "pending" : "not_requested",
      remoteDir: input.remoteDir,
      message: null,
      completedAt: null,
    },
  };
}

export function normalizeContentArchiveRun(
  value: ContentArchiveRunJson | null | undefined,
): ContentArchiveRun | null {
  if (
    typeof value?.runId !== "string" ||
    typeof value.sourceInput !== "string" ||
    typeof value.externalId !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.logFile !== "string" ||
    typeof value.outputDir !== "string"
  ) {
    return null;
  }
  const source =
    typeof value.source === "string" ? normalizeContentArchiveSourceKey(value.source) : null;
  if (!source) return null;
  if (!isContentArchiveRunStatus(value.status)) return null;
  return {
    runId: value.runId,
    userId: typeof value.userId === "string" ? value.userId : null,
    source,
    sourceInput: value.sourceInput,
    externalId: value.externalId,
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : null,
    coverUrl: typeof value.coverUrl === "string" && value.coverUrl.trim() ? value.coverUrl.trim() : null,
    imageServerId:
      typeof value.imageServerId === "string" && value.imageServerId.trim()
        ? value.imageServerId.trim()
        : null,
    chapterRange: typeof value.chapterRange === "string" ? value.chapterRange : null,
    chapterIds: normalizeChapterIds(value.chapterIds),
    chapterRefs: normalizeChapterRefs(value.chapterRefs),
    pageDelayMs: normalizeContentArchivePageDelayMs(value.pageDelayMs),
    speedLane: parseContentArchiveSpeedLane(
      typeof value.speedLane === "string" ? value.speedLane : null,
    ),
    dryRun: Boolean(value.dryRun),
    upload: Boolean(value.upload),
    status: value.status,
    startedAt: value.startedAt,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
    exitCode: typeof value.exitCode === "number" ? value.exitCode : null,
    logFile: value.logFile,
    outputDir: value.outputDir,
    remoteDir: typeof value.remoteDir === "string" ? value.remoteDir : null,
    progress: normalizeRunProgress(value.progress),
    failureKind: normalizeFailureKind(value.failureKind),
    failureMessage:
      typeof value.failureMessage === "string" && value.failureMessage.trim()
        ? value.failureMessage.trim()
        : null,
    manifestPath:
      typeof value.manifestPath === "string" && value.manifestPath.trim()
        ? value.manifestPath.trim()
        : null,
    uploadOutcome: normalizeUploadOutcome(value.uploadOutcome),
  };
}

function normalizeChapterIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value
    .map((item) => Number(item))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}

function normalizeChapterRefs(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const refs = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return refs.length > 0 ? Array.from(new Set(refs)) : null;
}

export function isContentArchiveRunStatus(
  value: unknown,
): value is ContentArchiveRunStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed"
  );
}

export function clampContentArchiveProgressPercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function isContentArchiveRunFailureKind(
  value: unknown,
): value is ContentArchiveRunFailureKind {
  return (
    value === "auth" ||
    value === "source" ||
    value === "download" ||
    value === "packaging" ||
    value === "upload" ||
    value === "tooling" ||
    value === "unknown"
  );
}

function normalizeRunProgress(value: unknown): ContentArchiveRunProgress | null {
  if (!isRecord(value)) return null;
  const stage = normalizeProgressStage(value.stage);
  if (!stage) return null;
  return {
    stage,
    percent: clampContentArchiveProgressPercent(value.percent),
    label:
      typeof value.label === "string" && value.label.trim()
        ? value.label.trim()
        : defaultProgressLabel(stage),
    detail:
      typeof value.detail === "string" && value.detail.trim()
        ? value.detail.trim()
        : null,
    current: normalizeNullableNumber(value.current),
    total: normalizeNullableNumber(value.total),
    bytesDownloaded: normalizeNullableNumber(value.bytesDownloaded),
    estimatedBytes: normalizeNullableNumber(value.estimatedBytes),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeProgressStage(value: unknown): ContentArchiveRunProgressStage | null {
  return value === "queued" ||
    value === "discovering" ||
    value === "planning" ||
    value === "dry_run" ||
    value === "preparing" ||
    value === "downloading" ||
    value === "packaging" ||
    value === "uploading" ||
    value === "completed" ||
    value === "failed"
    ? value
    : null;
}

function normalizeFailureKind(value: unknown): ContentArchiveRunFailureKind | null {
  return isContentArchiveRunFailureKind(value) ? value : null;
}

function normalizeUploadOutcome(value: unknown): ContentArchiveRunUploadOutcome | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (
    status !== "not_requested" &&
    status !== "pending" &&
    status !== "running" &&
    status !== "completed" &&
    status !== "failed"
  ) {
    return null;
  }
  return {
    status,
    remoteDir:
      typeof value.remoteDir === "string" && value.remoteDir.trim()
        ? value.remoteDir.trim()
        : null,
    message:
      typeof value.message === "string" && value.message.trim()
        ? value.message.trim()
        : null,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
  };
}

function normalizeNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeContentArchivePageDelayMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function defaultProgressLabel(stage: ContentArchiveRunProgressStage): string {
  switch (stage) {
    case "queued":
      return "Queued";
    case "discovering":
      return "Analyzing";
    case "planning":
      return "Planning";
    case "dry_run":
      return "Dry run";
    case "preparing":
      return "Preparing";
    case "downloading":
      return "Downloading";
    case "packaging":
      return "Packaging";
    case "uploading":
      return "Uploading";
    case "completed":
      return "Complete";
    case "failed":
      return "Failed";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
