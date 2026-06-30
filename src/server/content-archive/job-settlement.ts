import "server-only";

import { readFile, writeFile } from "node:fs/promises";

import {
  clampContentArchiveProgressPercent,
  isContentArchiveRunFailureKind,
  normalizeContentArchiveRun,
  type ContentArchiveRun,
  type ContentArchiveRunFailureKind,
  type ContentArchiveRunProgress,
  type ContentArchiveRunnerProgressEvent,
} from "@/lib/content-archive/run-records";
import { contentArchiveAccessErrorMessage } from "./access";

type ContentArchiveSettlementResult = {
  title: string;
  outputDir: string;
  remoteDir: string | null;
  selectedChapters: number;
  cbzFiles: string[];
  manifestPath?: string | null;
  upload: boolean;
};

export async function startContentArchiveRun(input: {
  jobFile: string;
  logFile: string;
  now?: Date;
}): Promise<ContentArchiveRun> {
  return updateContentArchiveRun(input.jobFile, (run) => ({
    ...run,
    status: "running",
    startedAt: run.startedAt ?? (input.now ?? new Date()).toISOString(),
    finishedAt: null,
    exitCode: null,
    logFile: input.logFile,
    failureKind: null,
    failureMessage: null,
    progress: {
      stage: "discovering",
      percent: 3,
      label: "Analyzing",
      detail: "Reading source metadata",
      current: null,
      total: null,
      bytesDownloaded: null,
      estimatedBytes: null,
      updatedAt: (input.now ?? new Date()).toISOString(),
    },
  }));
}

export async function settleContentArchiveRunProgress(input: {
  jobFile: string;
  event: ContentArchiveRunnerProgressEvent;
  now?: Date;
}): Promise<ContentArchiveRun> {
  return updateContentArchiveRun(input.jobFile, (run) => {
    const now = (input.now ?? new Date()).toISOString();
    return {
      ...run,
      status: run.status === "queued" ? "running" : run.status,
      progress: progressFromEvent(input.event, now),
      manifestPath: input.event.manifestPath ?? run.manifestPath,
      uploadOutcome: input.event.uploadOutcome ?? run.uploadOutcome,
    };
  });
}

export async function completeContentArchiveRun(input: {
  jobFile: string;
  result: ContentArchiveSettlementResult;
  now?: Date;
}): Promise<ContentArchiveRun> {
  return updateContentArchiveRun(input.jobFile, (run) => {
    const now = (input.now ?? new Date()).toISOString();
    return {
      ...run,
      title: input.result.title,
      outputDir: input.result.outputDir,
      remoteDir: input.result.remoteDir,
      status: "completed",
      finishedAt: now,
      exitCode: 0,
      failureKind: null,
      failureMessage: null,
      manifestPath: input.result.manifestPath ?? run.manifestPath,
      uploadOutcome: input.result.upload
        ? {
            status: "completed",
            remoteDir: input.result.remoteDir,
            message: "Upload complete",
            completedAt: now,
          }
        : {
            status: "not_requested",
            remoteDir: input.result.remoteDir,
            message: null,
            completedAt: null,
          },
      progress: {
        stage: "completed",
        percent: 100,
        label: "Complete",
        detail: `${input.result.cbzFiles.length} CBZ · ${input.result.selectedChapters} selected`,
        current: input.result.selectedChapters,
        total: input.result.selectedChapters,
        bytesDownloaded: null,
        estimatedBytes: null,
        updatedAt: now,
      },
    };
  });
}

export async function failContentArchiveRun(input: {
  jobFile: string;
  error: unknown;
  now?: Date;
}): Promise<ContentArchiveRun> {
  return updateContentArchiveRun(input.jobFile, (run) => {
    const now = (input.now ?? new Date()).toISOString();
    const message = contentArchiveAccessErrorMessage(input.error);
    const failureKind = classifyContentArchiveRunFailure(message);
    return {
      ...run,
      status: "failed",
      finishedAt: now,
      exitCode: 1,
      failureKind,
      failureMessage: message,
      uploadOutcome:
        run.uploadOutcome?.status === "running"
          ? {
              ...run.uploadOutcome,
              status: "failed",
              message,
              completedAt: now,
            }
          : run.uploadOutcome,
      progress: {
        stage: "failed",
        percent: Math.max(run.progress?.percent ?? 0, 100),
        label: "Failed",
        detail: summarizeContentArchiveFailure(message, failureKind),
        current: run.progress?.current ?? null,
        total: run.progress?.total ?? null,
        bytesDownloaded: run.progress?.bytesDownloaded ?? null,
        estimatedBytes: run.progress?.estimatedBytes ?? null,
        updatedAt: now,
      },
    };
  });
}

export function classifyContentArchiveRunFailure(
  message: string,
): ContentArchiveRunFailureKind {
  const lower = message.toLowerCase();
  if (
    lower.includes("bearer") ||
    lower.includes("refresh token") ||
    lower.includes("authorization") ||
    lower.includes("401") ||
    lower.includes("403")
  ) {
    return "auth";
  }
  if (
    lower.includes("rclone") ||
    lower.includes("drive") ||
    lower.includes("upload")
  ) {
    return "upload";
  }
  if (lower.includes("zip") || lower.includes("cbz")) return "packaging";
  if (
    lower.includes("image fetch") ||
    lower.includes("page image") ||
    lower.includes("download")
  ) {
    return "download";
  }
  if (
    lower.includes("mangalib") ||
    lower.includes("hentailib") ||
    lower.includes("slashlib") ||
    lower.includes("nhentai") ||
    lower.includes("chapter") ||
    lower.includes("gallery") ||
    lower.includes("source")
  ) {
    return "source";
  }
  if (
    lower.includes("tsx") ||
    lower.includes("required") ||
    lower.includes("not installed") ||
    lower.includes("command")
  ) {
    return "tooling";
  }
  return "unknown";
}

function progressFromEvent(
  event: ContentArchiveRunnerProgressEvent,
  updatedAt: string,
): ContentArchiveRunProgress {
  return {
    stage: event.stage,
    percent: clampContentArchiveProgressPercent(event.percent),
    label: event.label?.trim() || defaultProgressLabel(event.stage),
    detail: event.detail?.trim() || null,
    current: normalizeProgressNumber(event.current),
    total: normalizeProgressNumber(event.total),
    bytesDownloaded: normalizeProgressNumber(event.bytesDownloaded),
    estimatedBytes: normalizeProgressNumber(event.estimatedBytes),
    updatedAt,
  };
}

async function updateContentArchiveRun(
  path: string,
  updater: (run: ContentArchiveRun) => ContentArchiveRun,
): Promise<ContentArchiveRun> {
  const current = await readContentArchiveJob(path);
  const updated = updater(current);
  await writeFile(
    /* turbopackIgnore: true */ path,
    `${JSON.stringify(updated, null, 2)}\n`,
    { mode: 0o600 },
  );
  return updated;
}

async function readContentArchiveJob(path: string): Promise<ContentArchiveRun> {
  const parsed = JSON.parse(
    await readFile(/* turbopackIgnore: true */ path, "utf8"),
  ) as Record<string, unknown>;
  const normalized = normalizeContentArchiveRun(parsed);
  if (!normalized) {
    throw new Error("Content archive run record is invalid.");
  }
  return normalized;
}

function summarizeContentArchiveFailure(
  message: string,
  kind: ContentArchiveRunFailureKind,
): string {
  if (!isContentArchiveRunFailureKind(kind)) return "Open logs for details";
  switch (kind) {
    case "auth":
      return "Source auth failed";
    case "source":
      return "Source request failed";
    case "download":
      return "Page image download failed";
    case "packaging":
      return "CBZ packaging failed";
    case "upload":
      return "Drive upload failed";
    case "tooling":
      return "Local archive tool missing";
    case "unknown":
      return message.length > 72 ? `${message.slice(0, 69)}...` : message;
  }
}

function defaultProgressLabel(stage: ContentArchiveRunnerProgressEvent["stage"]): string {
  switch (stage) {
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
  }
}

function normalizeProgressNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
