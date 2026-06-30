import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  type ContentArchiveCoverAsset,
  contentArchiveRangeIncludes,
  type LibSocialContentArchiveSourceKey,
  parseContentArchiveChapterRange,
  planContentArchivePaths,
  resolveContentArchiveDriveRemote,
  safeContentArchiveSegment,
  sourceLabel,
  type SupportedContentArchiveSourceKey,
} from "../../src/lib/content-archive/planning";
import {
  contentArchiveImageRequestHeaders,
  resolveContentArchiveImageCookie,
} from "../../src/lib/content-archive/image-cookie";
import {
  fetchLibSocialArchiveChapterPages,
  fetchLibSocialArchiveImageBase,
  isLibSocialArchiveAuthRefreshCandidate,
  libSocialArchiveChapterRangeValue,
  mangaLibImageUrlForPage,
  type LibSocialContentArchiveChapterRow,
} from "../../src/lib/content-archive/mangalib-reader";
import {
  contentArchivePageDelayForLane,
  DEFAULT_CONTENT_ARCHIVE_SPEED_LANE,
} from "../../src/lib/content-archive/pacing";
import type { ContentArchiveRunnerProgressEvent } from "../../src/lib/content-archive/run-records";
import { acquireContentArchiveSourcePlan } from "../../src/lib/content-archive/source-acquisition";

export type MangaLibArchiveInput = {
  source?: LibSocialContentArchiveSourceKey;
  sourceInput: string;
  imageServerId?: string | null;
  chapterRange?: string | null;
  chapterIds?: number[] | null;
  chapterRefs?: string[] | null;
  pageDelayMs?: number | null;
  dryRun: boolean;
  upload: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  progress?: (event: ContentArchiveRunnerProgressEvent) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  authorization?: string | null;
  imageCookie?: string | null;
  authorizationProvider?: (input: {
    forceRefresh?: boolean;
  }) => Promise<{ authorization?: string }>;
  runCommand?: (
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) => Promise<void>;
};

export type MangaLibArchiveResult = {
  source: LibSocialContentArchiveSourceKey;
  title: string;
  slug: string;
  outputDir: string;
  remoteDir: string | null;
  dryRun: boolean;
  upload: boolean;
  discoveredChapters: number;
  selectedChapters: number;
  cbzFiles: string[];
  coverFiles: string[];
  imageServerId: string | null;
  manifestPath: string;
};

const REQUEST_TIMEOUT_MS = 20_000;
const REQUEST_RETRIES = 8;
const FORBIDDEN_RETRIES = 6;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const execFile = promisify(execFileCallback);

export async function runMangaLibArchive(
  input: MangaLibArchiveInput,
): Promise<MangaLibArchiveResult> {
  return runLibSocialContentArchive({ ...input, source: input.source ?? "mangalib" });
}

export async function runLibSocialContentArchive(
  input: MangaLibArchiveInput & { source: LibSocialContentArchiveSourceKey },
): Promise<MangaLibArchiveResult> {
  const source = input.source;
  const label = sourceLabel(source);
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const runCommand = input.runCommand ?? defaultRunCommand;
  const log = input.log ?? (() => undefined);
  const progress = input.progress ?? (() => undefined);
  const pageDelayMs = resolveContentArchivePageDelayMs(source, env, input.pageDelayMs);
  const imageCookie =
    input.imageCookie ?? resolveContentArchiveImageCookie(source, env);
  let authorization = input.authorization ?? undefined;
  const loadAuthorization = async (forceRefresh: boolean) => {
    if (!input.authorizationProvider) return authorization;
    const fresh = await input.authorizationProvider({ forceRefresh });
    authorization = fresh.authorization;
    return authorization;
  };

  const range = parseContentArchiveChapterRange(input.chapterRange ?? null);
  if (!range) {
    throw new Error("Use a chapter range like 1-10, 5, or 1,3-5.");
  }

  authorization = authorization ?? (await loadAuthorization(false));
  await reportProgress(progress, {
    stage: "discovering",
    percent: 5,
    label: "Analyzing",
    detail: `Reading ${label} title`,
  });
  const discovered = await withLibSocialArchiveAuthRetry(
    async () => {
      const plan = await acquireContentArchiveSourcePlan({
        source,
        sourceInput: input.sourceInput,
        env,
        fetchImpl,
        authorization,
        imageServerId: input.imageServerId ?? null,
        imageCookie,
      });
      if (!plan.ok) throw new Error(plan.message);
      if (plan.downloadPlan.kind !== "libsocial") {
        throw new Error(`${label} archive discovery returned a non-LibSocial plan.`);
      }
      return plan;
    },
    loadAuthorization,
  );
  if (discovered.downloadPlan.kind !== "libsocial") {
    throw new Error(`${label} archive discovery returned a non-LibSocial plan.`);
  }
  const downloadPlan = discovered.downloadPlan;
  const { title, slug, chapters: chapterRows } = discovered;
  const selected = selectLibSocialArchiveChapters(
    chapterRows,
    range,
    input.chapterIds ?? null,
    input.chapterRefs ?? null,
  );
  if (selected.length === 0) {
    throw new Error(`No ${label} chapters matched the requested range.`);
  }
  await reportProgress(progress, {
    stage: "planning",
    percent: 12,
    label: "Planning",
    detail: `${selected.length} of ${chapterRows.length} chapters selected`,
    current: selected.length,
    total: chapterRows.length,
    estimatedBytes: discovered.sizeEstimate.estimatedBytes,
  });

  const planned = planContentArchivePaths({
    source,
    title,
    externalId: slug,
    driveRemote: resolveContentArchiveDriveRemote(env),
  });
  const backupRoot = resolve(cwd, env.ATLAS_BACKUP_ROOT?.trim() || ".atlas-backups");
  const outputDir = join(backupRoot, planned.relativeTitleDir);
  const manifestPath = join(backupRoot, planned.relativeManifestPath);

  log(`source: ${label}`);
  log(`title: ${title}`);
  log(`slug: ${slug}`);
  log(`chapters discovered: ${chapterRows.length}`);
  log(`chapters selected: ${selected.length}`);
  if (discovered.defaultImageServerId) {
    log(`image server: ${discovered.defaultImageServerId}`);
  }
  log(`output: ${outputDir}`);
  if (planned.remoteDir) log(`remote: ${planned.remoteDir}`);

  if (input.dryRun) {
    await reportProgress(progress, {
      stage: "dry_run",
      percent: 85,
      label: "Dry run",
      detail: "Writing archive manifest",
      manifestPath,
    });
    await writeManifest(manifestPath, {
      schema: "atlas-content-archive-libsocial",
      version: 1,
      source,
      dryRun: true,
      title,
      slug,
      sourceInput: input.sourceInput,
      imageServerId: discovered.defaultImageServerId,
      chapterRange: range.raw,
      chapterIds: input.chapterIds ?? null,
      chapterRefs: input.chapterRefs ?? null,
      coverAssets: discovered.coverAssets,
      discoveredChapters: chapterRows.length,
      selectedChapters: selected.map(chapterManifestRow),
      outputDir,
      remoteDir: planned.remoteDir,
      generatedAt: new Date().toISOString(),
    });
    return {
      source,
      title,
      slug,
      outputDir,
      remoteDir: planned.remoteDir,
      dryRun: true,
      upload: input.upload,
      discoveredChapters: chapterRows.length,
      selectedChapters: selected.length,
      cbzFiles: [],
      coverFiles: [],
      imageServerId: discovered.defaultImageServerId,
      manifestPath,
    };
  }

  await reportProgress(progress, {
    stage: "preparing",
    percent: 16,
    label: "Preparing",
    detail: "Checking local archive tools",
    estimatedBytes: discovered.sizeEstimate.estimatedBytes,
  });
  await assertCommandAvailable("zip", runCommand);
  if (input.upload) await assertCommandAvailable("rclone", runCommand);

  const imageBase = await withLibSocialArchiveAuthRetry(
    () =>
      fetchLibSocialArchiveImageBase({
        source,
        apiBase: downloadPlan.apiBase,
        homepage: downloadPlan.homepage,
        env,
        fetchImpl,
        authorization,
        imageServerId: discovered.defaultImageServerId,
      }),
    loadAuthorization,
  );
  const cbzFiles: string[] = [];
  let downloadedBytes = 0;
  const coverFiles = await downloadContentArchiveCoverAssets({
    assets: discovered.coverAssets,
    outputDir,
    referer: `${downloadPlan.homepage}/manga/${slug}`,
    fetchImpl,
    log,
    cookie: imageCookie,
  });
  const completed: Array<Record<string, unknown>> = [];
  const selectedGroupCounts = selected.reduce((counts, chapter) => {
    const key = chapterArchiveGroupKey(chapter);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  for (let chapterIndex = 0; chapterIndex < selected.length; chapterIndex += 1) {
    const chapter = selected[chapterIndex]!;
    const chapterBase = contentArchiveChapterBaseSegment(chapter);
    const hasMultipleTranslations = (selectedGroupCounts.get(chapterArchiveGroupKey(chapter)) ?? 0) > 1;
    const chapterKey = hasMultipleTranslations
      ? contentArchiveTranslationFileSegment(chapter, chapterBase)
      : chapterBase;
    const cbzPath = hasMultipleTranslations
      ? join(outputDir, chapterBase, `${chapterKey}.cbz`)
      : join(outputDir, `${chapterKey}.cbz`);
    if (existsSync(cbzPath)) {
      log(`skip existing: ${basename(cbzPath)}`);
      cbzFiles.push(cbzPath);
      completed.push({ ...chapterManifestRow(chapter), cbzPath, skippedExisting: true });
      continue;
    }

    log(`chapter ${chapter.number}: fetching page list`);
    await reportProgress(progress, {
      stage: "downloading",
      percent: downloadPercent(chapterIndex, 0, 1, selected.length),
      label: "Downloading",
      detail: `Fetching chapter ${chapter.number}`,
      current: chapterIndex + 1,
      total: selected.length,
      bytesDownloaded: downloadedBytes,
      estimatedBytes: discovered.sizeEstimate.estimatedBytes,
    });
    const pages = await withLibSocialArchiveAuthRetry(
      () =>
        fetchLibSocialArchiveChapterPages({
          source,
          apiBase: downloadPlan.apiBase,
          homepage: downloadPlan.homepage,
          slug,
          chapter,
          fetchImpl,
          authorization,
        }),
      loadAuthorization,
    );
    if (pages.length === 0) {
      throw new Error(`${label} chapter ${chapter.number} returned no pages.`);
    }

    const workDir = join(outputDir, ".work", chapterKey);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true, mode: 0o700 });

    for (let index = 0; index < pages.length; index += 1) {
      if (pageDelayMs > 0) await sleep(pageDelayMs);
      const page = pages[index]!;
      const url = mangaLibImageUrlForPage(page.url, imageBase);
      const ext = safeImageExtension(url);
      const fileName = `${String(index + 1).padStart(4, "0")}${ext}`;
      const filePath = join(workDir, fileName);
      const bytes = await downloadBinary({
        url,
        referer: `${downloadPlan.homepage}/manga/${slug}/chapter?number=${encodeURIComponent(chapter.number)}&volume=${encodeURIComponent(chapter.volume)}`,
        fetchImpl,
        filePath,
        cookie: imageCookie,
      });
      downloadedBytes += bytes;
      log(
        `chapter ${chapter.number}: page ${index + 1}/${pages.length} downloaded ${formatBytes(bytes)}`,
      );
      await reportProgress(progress, {
        stage: "downloading",
        percent: downloadPercent(chapterIndex, index + 1, pages.length, selected.length),
        label: "Downloading",
        detail: `Chapter ${chapter.number} page ${index + 1}/${pages.length}`,
        current: chapterIndex + 1,
        total: selected.length,
        bytesDownloaded: downloadedBytes,
        estimatedBytes: discovered.sizeEstimate.estimatedBytes,
      });
    }

    await reportProgress(progress, {
      stage: "packaging",
      percent: Math.min(94, downloadPercent(chapterIndex + 1, 0, 1, selected.length) + 1),
      label: "Packaging",
      detail: `Creating CBZ for chapter ${chapter.number}`,
      current: chapterIndex + 1,
      total: selected.length,
      bytesDownloaded: downloadedBytes,
      estimatedBytes: discovered.sizeEstimate.estimatedBytes,
    });
    await createCbzArchive({ workDir, cbzPath, runCommand, env });
    await rm(workDir, { recursive: true, force: true });
    cbzFiles.push(cbzPath);
    completed.push({ ...chapterManifestRow(chapter), pageCount: pages.length, cbzPath });
  }

  await writeManifest(manifestPath, {
    schema: "atlas-content-archive-libsocial",
    version: 1,
    source,
    dryRun: false,
    title,
    slug,
    sourceInput: input.sourceInput,
    imageServerId: discovered.defaultImageServerId,
    chapterRange: range.raw,
    chapterIds: input.chapterIds ?? null,
    chapterRefs: input.chapterRefs ?? null,
    coverAssets: discovered.coverAssets,
    archivedCovers: coverFiles,
    discoveredChapters: chapterRows.length,
    archivedChapters: completed,
    outputDir,
    remoteDir: planned.remoteDir,
    generatedAt: new Date().toISOString(),
  });
  await reportProgress(progress, {
    stage: "packaging",
    percent: input.upload ? 95 : 98,
    label: "Packaging",
    detail: "Archive manifest written",
    current: selected.length,
    total: selected.length,
    bytesDownloaded: downloadedBytes,
    estimatedBytes: discovered.sizeEstimate.estimatedBytes,
    manifestPath,
  });

  if (input.upload) {
    if (!planned.remoteDir) {
      throw new Error("ATLAS_BACKUP_DRIVE_REMOTE is unset; cannot upload content archive.");
    }
    log("uploading to Drive");
    await reportProgress(progress, {
      stage: "uploading",
      percent: 96,
      label: "Uploading",
      detail: "Copying CBZ files to Drive",
      current: selected.length,
      total: selected.length,
      bytesDownloaded: downloadedBytes,
      estimatedBytes: discovered.sizeEstimate.estimatedBytes,
      uploadOutcome: {
        status: "running",
        remoteDir: planned.remoteDir,
        message: "Uploading to Drive",
        completedAt: null,
      },
    });
    await uploadContentArchive({ outputDir, remoteDir: planned.remoteDir, runCommand, env });
    log("upload complete");
    await reportProgress(progress, {
      stage: "uploading",
      percent: 99,
      label: "Uploading",
      detail: "Drive upload complete",
      current: selected.length,
      total: selected.length,
      bytesDownloaded: downloadedBytes,
      estimatedBytes: discovered.sizeEstimate.estimatedBytes,
      uploadOutcome: {
        status: "completed",
        remoteDir: planned.remoteDir,
        message: "Upload complete",
        completedAt: new Date().toISOString(),
      },
    });
  }

  return {
    source,
    title,
    slug,
    outputDir,
    remoteDir: planned.remoteDir,
    dryRun: false,
    upload: input.upload,
    discoveredChapters: chapterRows.length,
    selectedChapters: selected.length,
    cbzFiles,
    coverFiles,
    imageServerId: discovered.defaultImageServerId,
    manifestPath,
  };
}

async function withLibSocialArchiveAuthRetry<T>(
  operation: () => Promise<T>,
  loadAuthorization: (forceRefresh: boolean) => Promise<string | undefined>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isLibSocialArchiveAuthRefreshCandidate(error)) throw error;
    const refreshed = await loadAuthorization(true);
    if (!refreshed) throw error;
    return operation();
  }
}

function contentArchiveChapterBaseSegment(chapter: LibSocialContentArchiveChapterRow): string {
  const chapterTitle = chapter.name?.trim();
  const label = chapterTitle
    ? `v${chapter.volume}-ch${chapter.number}-${chapterTitle}`
    : `v${chapter.volume}-ch${chapter.number}`;
  return safeContentArchiveSegment(label, `chapter-${chapter.index}`);
}

function contentArchiveTranslationFileSegment(
  chapter: LibSocialContentArchiveChapterRow,
  chapterBase: string,
): string {
  const translation = chapter.branchName ?? (chapter.branchId ? `translation-${chapter.branchId}` : "translation");
  return safeContentArchiveSegment(`${chapterBase}-${translation}`, `${chapterBase}-translation`);
}

export async function downloadContentArchiveCoverAssets(input: {
  assets: ContentArchiveCoverAsset[];
  outputDir: string;
  referer: string;
  fetchImpl: typeof fetch;
  log?: (line: string) => void;
  cookie?: string | null;
}): Promise<string[]> {
  if (input.assets.length === 0) return [];
  const coverDir = join(input.outputDir, "covers");
  const files: string[] = [];
  for (let index = 0; index < input.assets.length; index += 1) {
    const asset = input.assets[index]!;
    const fileName = contentArchiveCoverFileName(asset, index);
    const filePath = join(coverDir, fileName);
    const bytes = await downloadBinary({
      url: asset.url,
      referer: input.referer,
      fetchImpl: input.fetchImpl,
      filePath,
      cookie: input.cookie,
    });
    input.log?.(`cover ${index + 1}/${input.assets.length}: ${asset.label} downloaded ${formatBytes(bytes)}`);
    files.push(filePath);
  }
  return files;
}

export async function downloadBinary(input: {
  url: string;
  referer: string;
  fetchImpl: typeof fetch;
  filePath: string;
  cookie?: string | null;
}): Promise<number> {
  let forbiddenRetries = 0;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await input.fetchImpl(input.url, {
        headers: contentArchiveImageRequestHeaders({
          referer: input.referer,
          cookie: input.cookie,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        // DDoS-Guard can momentarily 403 on cold start / brief egress hiccups; retry a few
        // times before giving up so a transient block does not abort the whole run.
        if (response.status === 403 && forbiddenRetries < FORBIDDEN_RETRIES) {
          forbiddenRetries += 1;
          await sleep(forbiddenRetryDelayMs(forbiddenRetries));
          continue;
        }
        if (RETRYABLE_STATUSES.has(response.status) && attempt < REQUEST_RETRIES) {
          await sleep(retryDelayMs(attempt, response));
          continue;
        }
        throw new Error(`Image fetch returned ${response.status} for ${input.url}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(dirname(input.filePath), { recursive: true, mode: 0o700 });
      await writeFile(input.filePath, bytes, { mode: 0o600 });
      return bytes.byteLength;
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < REQUEST_RETRIES && isRetryableNetworkError(error)) {
        await sleep(retryDelayMs(attempt, null));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Image fetch exhausted retries for ${input.url}`);
}

export async function createCbzArchive(input: {
  workDir: string;
  cbzPath: string;
  runCommand: NonNullable<MangaLibArchiveInput["runCommand"]>;
  env: NodeJS.ProcessEnv;
}) {
  await mkdir(dirname(input.cbzPath), { recursive: true, mode: 0o700 });
  await rm(input.cbzPath, { force: true });
  const fileNames = (await readdir(input.workDir))
    .filter((name) => !name.startsWith("."))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (fileNames.length === 0) {
    throw new Error("Cannot create CBZ because no downloaded page files were found.");
  }
  await input.runCommand("zip", ["-q", "-X", input.cbzPath, ...fileNames], {
    cwd: input.workDir,
    env: input.env,
  });
}

export async function uploadContentArchive(input: {
  outputDir: string;
  remoteDir: string;
  runCommand: NonNullable<MangaLibArchiveInput["runCommand"]>;
  env: NodeJS.ProcessEnv;
}) {
  await input.runCommand(
    "rclone",
    [
      "copy",
      input.outputDir,
      input.remoteDir,
      "--drive-chunk-size",
      input.env.ATLAS_BACKUP_RCLONE_DRIVE_CHUNK_SIZE ?? "256M",
      "--transfers",
      input.env.ATLAS_BACKUP_RCLONE_TRANSFERS ?? "1",
      "--checkers",
      input.env.ATLAS_BACKUP_RCLONE_CHECKERS ?? "4",
      "--stats",
      input.env.ATLAS_BACKUP_RCLONE_STATS ?? "10s",
    ],
    { env: input.env },
  );
}

export async function assertCommandAvailable(
  command: string,
  runCommand: NonNullable<MangaLibArchiveInput["runCommand"]>,
) {
  await runCommand(command, ["--help"]).catch((error) => {
    throw new Error(`${command} is required for content archives: ${formatError(error)}`);
  });
}

export async function defaultRunCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  try {
    await execFile(resolveOperatorCommand(command, options.env), args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(formatCommandFailure(command, error));
  }
}

async function writeManifest(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function chapterManifestRow(chapter: LibSocialContentArchiveChapterRow) {
  return {
    id: chapter.id,
    index: chapter.index,
    volume: chapter.volume,
    number: chapter.number,
    name: chapter.name,
    branchId: chapter.branchId,
    branchName: chapter.branchName,
    selectionKey: chapter.selectionKey,
  };
}

function selectLibSocialArchiveChapters(
  chapters: LibSocialContentArchiveChapterRow[],
  range: NonNullable<ReturnType<typeof parseContentArchiveChapterRange>>,
  chapterIds: number[] | null,
  chapterRefs: string[] | null,
): LibSocialContentArchiveChapterRow[] {
  if (chapterRefs?.length) {
    const refs = new Set(chapterRefs);
    return chapters.filter((chapter) => refs.has(chapter.selectionKey));
  }
  if (chapterIds?.length) {
    const selectedIds = new Set(chapterIds);
    return chapters.filter((chapter) => selectedIds.has(chapter.id));
  }
  return chapters.filter((chapter) =>
    contentArchiveRangeIncludes(range, libSocialArchiveChapterRangeValue(chapter)),
  );
}

function chapterArchiveGroupKey(chapter: LibSocialContentArchiveChapterRow): string {
  return String(chapter.id);
}

export function safeImageExtension(url: string): string {
  const ext = extname(new URL(url).pathname).toLowerCase();
  return /^\.(jpg|jpeg|png|webp|gif)$/.test(ext) ? ext : ".jpg";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reportProgress(
  progress: (event: ContentArchiveRunnerProgressEvent) => void | Promise<void>,
  event: ContentArchiveRunnerProgressEvent,
): Promise<void> {
  await progress(event);
}

function downloadPercent(
  chapterIndex: number,
  pageIndex: number,
  pageCount: number,
  chapterCount: number,
): number {
  const chapterRatio = chapterCount > 0 ? chapterIndex / chapterCount : 0;
  const pageRatio = pageCount > 0 ? pageIndex / pageCount / Math.max(1, chapterCount) : 0;
  return Math.min(94, Math.max(18, Math.round(18 + (chapterRatio + pageRatio) * 74)));
}

function resolveOperatorCommand(command: string, env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    ...((env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, command))),
    env.HOME ? join(env.HOME, ".local", "bin", command) : null,
    env.HOME ? join(env.HOME, "bin", command) : null,
    join("/opt/homebrew/bin", command),
    join("/usr/local/bin", command),
    join("/usr/bin", command),
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(path)) ?? command;
}

function formatCommandFailure(command: string, error: unknown): string {
  if (!(error instanceof Error)) return `${command} failed: ${String(error)}`;
  const details = error as Error & {
    code?: string | number;
    stderr?: string | Buffer;
    stdout?: string | Buffer;
  };
  const stderr = bufferText(details.stderr);
  const stdout = bufferText(details.stdout);
  const suffix = stderr || stdout || error.message;
  return `${command} failed${details.code ? ` (${details.code})` : ""}: ${suffix}`;
}

function bufferText(value: string | Buffer | undefined): string {
  if (!value) return "";
  return String(value).trim();
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function resolveContentArchivePageDelayMs(
  source: SupportedContentArchiveSourceKey,
  env: Record<string, string | undefined> = process.env,
  explicit?: number | null,
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return Math.round(explicit);
  }
  const sourceKey = source.toUpperCase();
  const raw =
    env[`ATLAS_CONTENT_ARCHIVE_${sourceKey}_PAGE_DELAY_MS`]?.trim() ??
    env.ATLAS_CONTENT_ARCHIVE_PAGE_DELAY_MS?.trim();
  if (!raw) return defaultContentArchivePageDelayMs(source);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed)
    : defaultContentArchivePageDelayMs(source);
}

function defaultContentArchivePageDelayMs(source: SupportedContentArchiveSourceKey): number {
  // The env-less / legacy / CLI default tracks the Balanced speed lane (light
  // pace for LibSocial image hosts behind DDoS-Guard; 0 ms for nHentai).
  return contentArchivePageDelayForLane(source, DEFAULT_CONTENT_ARCHIVE_SPEED_LANE);
}

function retryDelayMs(attempt: number, response: Response | null): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(120_000, Math.round(seconds * 1_000));
    }
  }
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(120_000, 2_000 * 2 ** attempt + jitter);
}

function forbiddenRetryDelayMs(attempt: number): number {
  return Math.min(15_000, 3_000 * attempt) + Math.floor(Math.random() * 750);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  return error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function contentArchiveChecksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function contentArchiveCoverFileName(asset: ContentArchiveCoverAsset, index: number): string {
  const sourceName = asset.fileName
    ? basename(asset.fileName)
    : `${asset.id || asset.label || `cover-${index + 1}`}${safeImageExtension(asset.url)}`;
  const fileExt = extname(sourceName).toLowerCase();
  const ext = /^\.(jpg|jpeg|png|webp|gif)$/.test(fileExt)
    ? fileExt
    : safeImageExtension(asset.url);
  const base = safeContentArchiveSegment(
    sourceName.replace(/\.[^.]+$/, "") || asset.label,
    `cover-${index + 1}`,
  );
  return `${String(index + 1).padStart(2, "0")}-${base}${ext}`;
}
