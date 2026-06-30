import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  contentArchiveRangeIncludes,
  parseContentArchiveChapterRange,
  planContentArchivePaths,
  resolveContentArchiveDriveRemote,
  safeContentArchiveSegment,
} from "../../src/lib/content-archive/planning";
import { acquireContentArchiveSourcePlan } from "../../src/lib/content-archive/source-acquisition";
import {
  nhentaiGalleryReferer,
  nhentaiImageUrlForPage,
} from "../../src/lib/content-archive/nhentai-reader";
import type { ContentArchiveRunnerProgressEvent } from "../../src/lib/content-archive/run-records";
import {
  assertCommandAvailable,
  createCbzArchive,
  defaultRunCommand,
  downloadBinary,
  downloadContentArchiveCoverAssets,
  formatBytes,
  resolveContentArchivePageDelayMs,
  safeImageExtension,
  uploadContentArchive,
  type MangaLibArchiveInput,
} from "./mangalib-archive";

export type NHentaiArchiveInput = Omit<MangaLibArchiveInput, "source" | "authorization" | "authorizationProvider">;

export type NHentaiArchiveResult = {
  source: "nhentai";
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

export async function runNHentaiContentArchive(
  input: NHentaiArchiveInput,
): Promise<NHentaiArchiveResult> {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const runCommand = input.runCommand ?? defaultRunCommand;
  const log = input.log ?? (() => undefined);
  const progress = input.progress ?? (() => undefined);
  const pageDelayMs = resolveContentArchivePageDelayMs("nhentai", env, input.pageDelayMs);
  const range = parseContentArchiveChapterRange(input.chapterRange ?? null);
  if (!range) {
    throw new Error("Use a gallery range like 1 or all.");
  }

  await reportProgress(progress, {
    stage: "discovering",
    percent: 5,
    label: "Analyzing",
    detail: "Reading nHentai gallery",
  });
  const discovered = await acquireContentArchiveSourcePlan({
    source: "nhentai",
    sourceInput: input.sourceInput,
    env,
    fetchImpl,
    estimateSizes: true,
    imageServerId: input.imageServerId ?? null,
  });
  if (!discovered.ok) throw new Error(discovered.message);
  if (discovered.downloadPlan.kind !== "nhentai") {
    throw new Error("nHentai archive discovery returned a non-nHentai plan.");
  }
  const selected = selectNHentaiGallery({
    galleryId: discovered.slug,
    range,
    chapterIds: input.chapterIds ?? null,
    chapterRefs: input.chapterRefs ?? null,
  });
  if (!selected) {
    throw new Error("No nHentai gallery matched the requested selection.");
  }
  await reportProgress(progress, {
    stage: "planning",
    percent: 15,
    label: "Planning",
    detail: `${discovered.downloadPlan.pages.length} pages selected`,
    current: 1,
    total: 1,
    estimatedBytes: discovered.sizeEstimate.estimatedBytes,
  });

  const planned = planContentArchivePaths({
    source: "nhentai",
    title: discovered.title,
    externalId: discovered.slug,
    driveRemote: resolveContentArchiveDriveRemote(env),
  });
  const backupRoot = resolve(cwd, env.ATLAS_BACKUP_ROOT?.trim() || ".atlas-backups");
  const outputDir = join(backupRoot, planned.relativeTitleDir);
  const manifestPath = join(backupRoot, planned.relativeManifestPath);
  const imageServerId = discovered.defaultImageServerId;

  log("source: nHentai");
  log(`title: ${discovered.title}`);
  log(`gallery: ${discovered.slug}`);
  log(`pages discovered: ${discovered.downloadPlan.pages.length}`);
  if (imageServerId) log(`image server: ${imageServerId}`);
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
    await writeNHentaiManifest(manifestPath, {
      schema: "atlas-content-archive-nhentai",
      version: 1,
      source: "nhentai",
      dryRun: true,
      title: discovered.title,
      slug: discovered.slug,
      sourceInput: input.sourceInput,
      imageServerId,
      chapterRange: range.raw,
      chapterIds: input.chapterIds ?? null,
      chapterRefs: input.chapterRefs ?? null,
      coverAssets: discovered.coverAssets,
      discoveredPages: discovered.downloadPlan.pages.length,
      selectedGallery: discovered.slug,
      outputDir,
      remoteDir: planned.remoteDir,
      generatedAt: new Date().toISOString(),
    });
    return {
      source: "nhentai",
      title: discovered.title,
      slug: discovered.slug,
      outputDir,
      remoteDir: planned.remoteDir,
      dryRun: true,
      upload: input.upload,
      discoveredChapters: 1,
      selectedChapters: 1,
      cbzFiles: [],
      coverFiles: [],
      imageServerId,
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

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const coverFiles = await downloadContentArchiveCoverAssets({
    assets: discovered.coverAssets,
    outputDir,
    referer: nhentaiGalleryReferer(discovered.slug),
    fetchImpl,
    log,
  });

  const galleryBase = safeContentArchiveSegment(
    `nhentai-${discovered.slug}`,
    `nhentai-${discovered.slug}`,
  );
  const cbzPath = join(outputDir, `${galleryBase}.cbz`);
  const cbzFiles: string[] = [];
  let downloadedBytes = 0;
  if (existsSync(cbzPath)) {
    log(`skip existing: ${basename(cbzPath)}`);
    cbzFiles.push(cbzPath);
  } else {
    const workDir = join(outputDir, ".work", galleryBase);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true, mode: 0o700 });
    for (let index = 0; index < discovered.downloadPlan.pages.length; index += 1) {
      if (index > 0 && pageDelayMs > 0) await wait(pageDelayMs);
      const page = discovered.downloadPlan.pages[index]!;
      const url = nhentaiImageUrlForPage(page, discovered.downloadPlan.imageBase);
      const ext = safeImageExtension(url);
      const filePath = join(workDir, `${String(page.number || index + 1).padStart(4, "0")}${ext}`);
      const bytes = await downloadBinary({
        url,
        referer: nhentaiGalleryReferer(discovered.slug),
        fetchImpl,
        filePath,
      });
      downloadedBytes += bytes;
      log(`gallery ${discovered.slug}: page ${index + 1}/${discovered.downloadPlan.pages.length} downloaded ${formatBytes(bytes)}`);
      await reportProgress(progress, {
        stage: "downloading",
        percent: galleryDownloadPercent(index + 1, discovered.downloadPlan.pages.length),
        label: "Downloading",
        detail: `Page ${index + 1}/${discovered.downloadPlan.pages.length}`,
        current: index + 1,
        total: discovered.downloadPlan.pages.length,
        bytesDownloaded: downloadedBytes,
        estimatedBytes: discovered.sizeEstimate.estimatedBytes,
      });
    }
    await reportProgress(progress, {
      stage: "packaging",
      percent: 94,
      label: "Packaging",
      detail: "Creating gallery CBZ",
      current: discovered.downloadPlan.pages.length,
      total: discovered.downloadPlan.pages.length,
      bytesDownloaded: downloadedBytes,
      estimatedBytes: discovered.sizeEstimate.estimatedBytes,
    });
    await createCbzArchive({ workDir, cbzPath, runCommand, env });
    await rm(workDir, { recursive: true, force: true });
    cbzFiles.push(cbzPath);
  }

  await writeNHentaiManifest(manifestPath, {
    schema: "atlas-content-archive-nhentai",
    version: 1,
    source: "nhentai",
    dryRun: false,
    title: discovered.title,
    slug: discovered.slug,
    sourceInput: input.sourceInput,
    imageServerId,
    chapterRange: range.raw,
    chapterIds: input.chapterIds ?? null,
    chapterRefs: input.chapterRefs ?? null,
    coverAssets: discovered.coverAssets,
    archivedCovers: coverFiles,
    archivedGallery: {
      galleryId: discovered.slug,
      pageCount: discovered.downloadPlan.pages.length,
      cbzPath,
    },
    outputDir,
    remoteDir: planned.remoteDir,
    generatedAt: new Date().toISOString(),
  });
  await reportProgress(progress, {
    stage: "packaging",
    percent: input.upload ? 95 : 98,
    label: "Packaging",
    detail: "Archive manifest written",
    current: discovered.downloadPlan.pages.length,
    total: discovered.downloadPlan.pages.length,
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
      current: discovered.downloadPlan.pages.length,
      total: discovered.downloadPlan.pages.length,
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
      current: discovered.downloadPlan.pages.length,
      total: discovered.downloadPlan.pages.length,
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
    source: "nhentai",
    title: discovered.title,
    slug: discovered.slug,
    outputDir,
    remoteDir: planned.remoteDir,
    dryRun: false,
    upload: input.upload,
    discoveredChapters: 1,
    selectedChapters: 1,
    cbzFiles,
    coverFiles,
    imageServerId,
    manifestPath,
  };
}

async function reportProgress(
  progress: (event: ContentArchiveRunnerProgressEvent) => void | Promise<void>,
  event: ContentArchiveRunnerProgressEvent,
): Promise<void> {
  await progress(event);
}

function galleryDownloadPercent(page: number, pageCount: number): number {
  return Math.min(94, Math.max(18, Math.round(18 + (page / Math.max(1, pageCount)) * 74)));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectNHentaiGallery(input: {
  galleryId: string;
  range: NonNullable<ReturnType<typeof parseContentArchiveChapterRange>>;
  chapterIds: number[] | null;
  chapterRefs: string[] | null;
}): boolean {
  const galleryNumber = Number(input.galleryId);
  if (input.chapterRefs?.length) return input.chapterRefs.includes(input.galleryId);
  if (input.chapterIds?.length) return input.chapterIds.includes(galleryNumber);
  return contentArchiveRangeIncludes(input.range, 1);
}

async function writeNHentaiManifest(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
