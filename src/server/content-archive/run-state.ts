import "server-only";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  parseContentArchiveSourceInput,
  parseContentArchiveChapterRange,
  planContentArchivePaths,
  resolveContentArchiveDriveRemote,
  sourceLabel,
  type SupportedContentArchiveSourceKey,
} from "@/lib/content-archive/planning";
import { parseLibSocialArchiveChapterSelectionKey } from "@/lib/content-archive/mangalib-reader";
import type { ContentArchiveSpeedLane } from "@/lib/content-archive/pacing";
import {
  createContentArchiveRunRecord,
  normalizeContentArchiveRun,
  type ContentArchiveRun,
} from "@/lib/content-archive/run-records";
import { loadContentArchiveLocalEnv } from "./local-env";

export type { ContentArchiveRun } from "@/lib/content-archive/run-records";

export type QueueContentArchiveRunInput = {
  userId: string;
  source: SupportedContentArchiveSourceKey;
  sourceInput: string;
  title?: string | null;
  coverUrl?: string | null;
  imageServerId?: string | null;
  chapterRange?: string | null;
  chapterIds?: number[] | null;
  chapterRefs?: string[] | null;
  pageDelayMs?: number | null;
  speedLane?: ContentArchiveSpeedLane | null;
  dryRun: boolean;
  upload: boolean;
  runIdPrefix?: string;
  now?: Date;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type QueueContentArchiveRunResult =
  | { ok: true; runId: string; jobFile: string; logFile: string }
  | { ok: false; message: string };

export function resolveContentArchivePaths(input: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}) {
  loadContentArchiveLocalEnv();
  const cwd = input.cwd ?? process.cwd();
  const root = input.env?.ATLAS_BACKUP_ROOT ?? process.env.ATLAS_BACKUP_ROOT;
  const archiveRoot = resolve(cwd, root?.trim() || ".atlas-backups");
  return {
    archiveRoot,
    contentDir: join(archiveRoot, "content"),
    runsDir: join(archiveRoot, "content-runs"),
  };
}

export async function listContentArchiveRuns(input: {
  limit?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<ContentArchiveRun[]> {
  const limit = input.limit ?? 8;
  if (limit <= 0) return [];

  const runsDir = resolveContentArchivePaths(input).runsDir;
  if (!existsSync(/* turbopackIgnore: true */ runsDir)) return [];
  const entries = await readdir(
    /* turbopackIgnore: true */ runsDir,
    { withFileTypes: true },
  );
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(runsDir, entry.name))
    .sort()
    .reverse()
    .slice(0, limit);

  const runs: ContentArchiveRun[] = [];
  for (const file of files) {
    const run = await readContentArchiveRun(file);
    if (run) runs.push(run);
  }
  return runs;
}

export async function readContentArchiveLogTail(
  path: string,
  maxBytes = 12_000,
): Promise<string | null> {
  try {
    const text = await readFile(/* turbopackIgnore: true */ path, "utf8");
    return text.length <= maxBytes ? text : text.slice(text.length - maxBytes);
  } catch {
    return null;
  }
}

export async function queueContentArchiveRun(
  input: QueueContentArchiveRunInput,
): Promise<QueueContentArchiveRunResult> {
  loadContentArchiveLocalEnv();
  const parsedInput = parseContentArchiveSourceInput(input.source, input.sourceInput);
  if (!parsedInput || parsedInput.source !== input.source) {
    return {
      ok: false,
      message: `Paste a valid ${sourceLabel(input.source)} title link, slug, or id.`,
    };
  }
  const range = parseContentArchiveChapterRange(input.chapterRange ?? null);
  if (!range) {
    return { ok: false, message: "Use a chapter range like 1-10, 5, or 1,3-5." };
  }
  const chapterIds = normalizeChapterIds(input.chapterIds);
  if (input.chapterIds && !chapterIds) {
    return {
      ok: false,
      message: `Choose at least one valid ${sourceLabel(input.source)} chapter.`,
    };
  }
  const chapterRefs = normalizeChapterRefs(input.chapterRefs);
  if (input.chapterRefs && !chapterRefs) {
    return {
      ok: false,
      message: `Choose at least one valid ${sourceLabel(input.source)} chapter translation.`,
    };
  }

  const cwd = input.cwd ?? process.cwd();
  const tsxBin = resolve(cwd, "node_modules/.bin/tsx");
  if (!existsSync(/* turbopackIgnore: true */ tsxBin)) {
    return { ok: false, message: "tsx runner is not installed locally." };
  }

  const paths = resolveContentArchivePaths(input);
  await mkdir(/* turbopackIgnore: true */ paths.runsDir, {
    recursive: true,
    mode: 0o700,
  });

  const now = input.now ?? new Date();
  const runId = createContentArchiveRunId(input.runIdPrefix ?? "content", now);
  const jobFile = join(paths.runsDir, `${runId}.json`);
  const logFile = join(paths.runsDir, `${runId}.log`);
  const planned = planContentArchivePaths({
    source: input.source,
    title: input.title?.trim() || parsedInput.externalId,
    externalId: parsedInput.externalId,
    driveRemote: resolveContentArchiveDriveRemote(input.env ?? process.env),
  });
  const job = createContentArchiveRunRecord({
    runId,
    userId: input.userId,
    source: input.source,
    sourceInput: input.sourceInput,
    externalId: parsedInput.externalId,
    title: input.title ?? null,
    coverUrl: input.coverUrl ?? null,
    imageServerId: input.imageServerId ?? null,
    chapterRange: range.raw,
    chapterIds,
    chapterRefs,
    pageDelayMs: input.pageDelayMs ?? null,
    speedLane: input.speedLane ?? null,
    dryRun: input.dryRun,
    upload: input.upload,
    logFile,
    outputDir: join(paths.archiveRoot, planned.relativeTitleDir),
    remoteDir: planned.remoteDir,
    startedAt: now.toISOString(),
  });

  await writeContentArchiveRun(jobFile, job);
  spawnContentArchiveWorker({
    cwd,
    env: input.env ?? process.env,
    tsxBin,
    jobFile,
    logFile,
    job,
  });

  return { ok: true, runId, jobFile, logFile };
}

function normalizeChapterIds(value: number[] | null | undefined): number[] | null {
  if (!value?.length) return null;
  const ids = value.filter((id) => Number.isSafeInteger(id) && id > 0);
  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}

function normalizeChapterRefs(value: string[] | null | undefined): string[] | null {
  if (!value?.length) return null;
  const refs = value.filter((ref) => parseLibSocialArchiveChapterSelectionKey(ref));
  return refs.length > 0 ? Array.from(new Set(refs)) : null;
}

export async function readContentArchiveRun(
  path: string,
): Promise<ContentArchiveRun | null> {
  try {
    const parsed = JSON.parse(
      await readFile(/* turbopackIgnore: true */ path, "utf8"),
    ) as Record<string, unknown>;
    return normalizeContentArchiveRun(parsed);
  } catch {
    return null;
  }
}

async function writeContentArchiveRun(path: string, job: ContentArchiveRun) {
  await writeFile(
    /* turbopackIgnore: true */ path,
    `${JSON.stringify(job, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function spawnContentArchiveWorker(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  tsxBin: string;
  jobFile: string;
  logFile: string;
  job: ContentArchiveRun;
}) {
  const child = spawn(
    input.tsxBin,
    [
      "scripts/content-archive/admin-content-archive-worker.ts",
      `--run-id=${input.job.runId}`,
      `--job-file=${input.jobFile}`,
      `--log-file=${input.logFile}`,
    ],
    {
      cwd: input.cwd,
      detached: true,
      env: {
        ...input.env,
        NODE_OPTIONS: mergeContentArchiveWorkerNodeOptions(input.env.NODE_OPTIONS),
      },
      stdio: "ignore",
    },
  );
  child.unref();
}

function mergeContentArchiveWorkerNodeOptions(value: string | undefined): string {
  const tokens = new Set(
    (value?.trim() ?? "")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean),
  );
  if (![...tokens].some((token) => token.startsWith("--conditions=") || token === "--conditions")) {
    tokens.add("--conditions=react-server");
  }
  if (!tokens.has("--use-system-ca")) {
    tokens.add("--use-system-ca");
  }
  return [...tokens].join(" ");
}

function createContentArchiveRunId(prefix: string, now: Date): string {
  return `${prefix}-${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}
