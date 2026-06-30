import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { config as loadEnv } from "dotenv";

import {
  contentArchiveProbeBytesPerSecond,
  summarizeContentArchiveCalibration,
  type ContentArchiveCalibrationProbe,
  type ContentArchiveCalibrationSummary,
} from "../../src/lib/content-archive/calibration";
import { probeContentArchiveImageDownload } from "../../src/lib/content-archive/reachability";
import {
  formatBytes,
} from "./mangalib-archive";
import {
  fetchLibSocialArchiveChapterPages,
  mangaLibImageUrlForPage,
  type LibSocialArchiveImageServerOption,
  type LibSocialContentArchiveChapterRow,
} from "../../src/lib/content-archive/mangalib-reader";
import {
  nhentaiGalleryReferer,
  nhentaiImageUrlForPage,
  type NHentaiArchivePage,
} from "../../src/lib/content-archive/nhentai-reader";
import {
  parseContentArchiveUrlInput,
  sourceLabel,
  type LibSocialContentArchiveSourceKey,
  type SupportedContentArchiveSourceKey,
} from "../../src/lib/content-archive/planning";
import {
  acquireContentArchiveSourcePlan,
  type ContentArchiveSourcePlan,
} from "../../src/lib/content-archive/source-acquisition";
type Args = {
  sourceInputs: string[];
  inputFile: string | null;
  maxLinks: number;
  maxServers: number;
  samplePages: number;
  maxProbeBytes: number;
  timeoutMs: number;
  outputDir: string | null;
  jsonOnly: boolean;
};

type CalibrationReport = {
  generatedAt: string;
  settings: {
    maxLinks: number;
    maxServers: number;
    samplePages: number;
    maxProbeBytes: number;
    timeoutMs: number;
  };
  probes: ContentArchiveCalibrationProbe[];
  summary: ContentArchiveCalibrationSummary;
};

type ContentArchiveAccessModule = typeof import("../../src/server/content-archive/access");
type ResolveContentArchiveAccessInput = Parameters<
  ContentArchiveAccessModule["resolveContentArchiveAccess"]
>[0];

let contentArchiveAccessModulePromise: Promise<ContentArchiveAccessModule> | null = null;

async function loadContentArchiveAccessModule(): Promise<ContentArchiveAccessModule> {
  contentArchiveAccessModulePromise ??= import("../../src/server/content-archive/access");
  return contentArchiveAccessModulePromise;
}

async function resolveContentArchiveAccess(
  input: ResolveContentArchiveAccessInput & { accessModule: ContentArchiveAccessModule },
) {
  const { accessModule, ...accessInput } = input;
  return accessModule.resolveContentArchiveAccess(accessInput);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const sourceInputs = await loadSourceInputs(args);
  if (sourceInputs.length === 0) {
    throw new Error("Provide at least one --source-input or --input-file.");
  }

  const probes: ContentArchiveCalibrationProbe[] = [];
  for (const sourceInput of sourceInputs.slice(0, args.maxLinks)) {
    const parsed = parseContentArchiveUrlInput(sourceInput);
    if (!parsed) {
      probes.push({
        source: inferContentArchiveSourceFromHost(sourceInput) ?? "mangalib",
        sourceInput,
        title: null,
        serverId: null,
        serverLabel: null,
        estimatedBytes: null,
        measuredBytes: 0,
        durationMs: 0,
        status: "skipped",
      });
      continue;
    }
    console.log(`[content-archive:calibrate] analyzing ${sourceLabel(parsed.source)} ${sourceInput}`);
    try {
      probes.push(...(await probeSourceInput(parsed.source, sourceInput, args)));
    } catch (error) {
      probes.push(
        failedProbe({
          source: parsed.source,
          sourceInput,
          title: null,
          server: null,
          estimatedBytes: null,
          error,
        }),
      );
    }
  }

  const summary = summarizeContentArchiveCalibration(probes);
  const report: CalibrationReport = {
    generatedAt: new Date().toISOString(),
    settings: {
      maxLinks: args.maxLinks,
      maxServers: args.maxServers,
      samplePages: args.samplePages,
      maxProbeBytes: args.maxProbeBytes,
      timeoutMs: args.timeoutMs,
    },
    probes,
    summary,
  };

  const outputDir = resolve(
    process.cwd(),
    args.outputDir?.trim() || ".atlas-backups/content-calibration",
  );
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = resolve(outputDir, `content-archive-calibration-${stamp}.json`);
  const markdownPath = resolve(outputDir, `content-archive-calibration-${stamp}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (!args.jsonOnly) {
    await writeFile(markdownPath, renderMarkdownReport(report), { mode: 0o600 });
  }

  console.log(`[content-archive:calibrate] wrote ${jsonPath}`);
  if (!args.jsonOnly) console.log(`[content-archive:calibrate] wrote ${markdownPath}`);
  console.log(renderConsoleSummary(report));
}

async function probeSourceInput(
  source: SupportedContentArchiveSourceKey,
  sourceInput: string,
  args: Args,
): Promise<ContentArchiveCalibrationProbe[]> {
  if (source === "nhentai") return probeNHentai(sourceInput, args);
  return probeLibSocial(source, sourceInput, args);
}

async function probeLibSocial(
  source: LibSocialContentArchiveSourceKey,
  sourceInput: string,
  args: Args,
): Promise<ContentArchiveCalibrationProbe[]> {
  const accessModule = await loadContentArchiveAccessModule();
  let access = await resolveContentArchiveAccess({
    accessModule,
    source,
    allowMissing: true,
    env: process.env,
  });
  let plan: ContentArchiveSourcePlan;
  try {
    plan = await acquireContentArchiveSourcePlan({
      source,
      sourceInput,
      authorization: access.authorization,
      imageCookie: access.imageCookie,
      estimateSizes: true,
    });
  } catch (error) {
    if (!accessModule.isContentArchiveAccessRefreshCandidate(error)) throw error;
    access = await resolveContentArchiveAccess({
      accessModule,
      source,
      allowMissing: false,
      forceRefresh: true,
      env: process.env,
    });
    plan = await acquireContentArchiveSourcePlan({
      source,
      sourceInput,
      authorization: access.authorization,
      imageCookie: access.imageCookie,
      estimateSizes: true,
    });
  }
  if (!plan.ok) throw new Error(plan.message);
  if (plan.downloadPlan.kind !== "libsocial") {
    throw new Error(`${sourceLabel(source)} calibration returned a non-LibSocial plan.`);
  }
  const sampleChapter = plan.chapters[0] ?? null;
  if (!sampleChapter) {
    return [skippedProbe(source, sourceInput, plan.title, "No chapter rows were discovered.")];
  }
  let pages: Array<{ url: string }> = [];
  try {
    pages = await fetchLibSocialArchiveChapterPages({
      source,
      apiBase: plan.downloadPlan.apiBase,
      homepage: plan.downloadPlan.homepage,
      slug: plan.slug,
      chapter: sampleChapter,
      fetchImpl: fetch,
      authorization: access.authorization,
    });
  } catch (error) {
    if (accessModule.isContentArchiveAccessRefreshCandidate(error)) {
      try {
        access = await resolveContentArchiveAccess({
          accessModule,
          source,
          allowMissing: false,
          forceRefresh: true,
          env: process.env,
        });
        pages = await fetchLibSocialArchiveChapterPages({
          source,
          apiBase: plan.downloadPlan.apiBase,
          homepage: plan.downloadPlan.homepage,
          slug: plan.slug,
          chapter: sampleChapter,
          fetchImpl: fetch,
          authorization: access.authorization,
        });
      } catch (retryError) {
        return [
          failedProbe({
            source,
            sourceInput,
            title: plan.title,
            server: null,
            estimatedBytes: plan.sizeEstimate.estimatedBytes,
            error: retryError,
          }),
        ];
      }
    }
    if (pages.length > 0) {
      // The refresh retry above recovered the page list.
    } else {
      return [
        failedProbe({
          source,
          sourceInput,
          title: plan.title,
          server: null,
          estimatedBytes: plan.sizeEstimate.estimatedBytes,
          error,
        }),
      ];
    }
  }

  return Promise.all(
    plan.imageServers.slice(0, args.maxServers).map(async (server) =>
      probeLibSocialServer({
        source,
        sourceInput,
        title: plan.title,
        homepage: plan.downloadPlan.homepage,
        slug: plan.slug,
        chapter: sampleChapter,
        pages,
        server,
        imageCookie: access.imageCookie,
        args,
      }),
    ),
  );
}

async function probeLibSocialServer(input: {
  source: LibSocialContentArchiveSourceKey;
  sourceInput: string;
  title: string;
  homepage: string;
  slug: string;
  chapter: LibSocialContentArchiveChapterRow;
  pages: Array<{ url: string }>;
  server: LibSocialArchiveImageServerOption;
  imageCookie: string | null;
  args: Args;
}): Promise<ContentArchiveCalibrationProbe> {
  const page = input.pages[0];
  const estimatedBytes =
    input.server.sizeEstimate?.estimatedBytes ??
    input.server.chapterSizeEstimates?.[input.chapter.selectionKey]?.estimatedBytes ??
    null;
  if (!page) {
    return skippedProbe(input.source, input.sourceInput, input.title, "No page rows were discovered.", input.server);
  }
  const url = mangaLibImageUrlForPage(page.url, input.server.url);
  const result = await probeImageDownload({
    url,
    referer: `${input.homepage}/manga/${input.slug}/chapter?number=${encodeURIComponent(input.chapter.number)}&volume=${encodeURIComponent(input.chapter.volume)}`,
    cookie: input.imageCookie,
    maxBytes: input.args.maxProbeBytes,
    timeoutMs: input.args.timeoutMs,
  });
  return {
    source: input.source,
    sourceInput: input.sourceInput,
    title: input.title,
    serverId: input.server.id,
    serverLabel: input.server.label,
    estimatedBytes,
    measuredBytes: result.measuredBytes,
    durationMs: result.durationMs,
    status: result.status,
    httpStatus: result.httpStatus,
    retryAfter: result.retryAfter,
  };
}

async function probeNHentai(
  sourceInput: string,
  args: Args,
): Promise<ContentArchiveCalibrationProbe[]> {
  const plan = await acquireContentArchiveSourcePlan({
    source: "nhentai",
    sourceInput,
    estimateSizes: true,
  });
  if (!plan.ok) throw new Error(plan.message);
  if (plan.downloadPlan.kind !== "nhentai") {
    throw new Error("nHentai calibration returned a non-nHentai plan.");
  }
  const samplePages = plan.downloadPlan.pages.slice(0, args.samplePages);
  if (samplePages.length === 0) {
    return [skippedProbe("nhentai", sourceInput, plan.title, "No gallery pages were discovered.")];
  }
  return Promise.all(
    plan.imageServers.slice(0, args.maxServers).map(async (server) =>
      probeNHentaiServer({
        sourceInput,
        title: plan.title,
        slug: plan.slug,
        pages: samplePages,
        server,
        estimatedBytes: server.sizeEstimate?.estimatedBytes ?? plan.sizeEstimate.estimatedBytes,
        args,
      }),
    ),
  );
}

async function probeNHentaiServer(input: {
  sourceInput: string;
  title: string;
  slug: string;
  pages: NHentaiArchivePage[];
  server: LibSocialArchiveImageServerOption;
  estimatedBytes: number | null | undefined;
  args: Args;
}): Promise<ContentArchiveCalibrationProbe> {
  const page = input.pages[0]!;
  const result = await probeImageDownload({
    url: nhentaiImageUrlForPage(page, input.server.url),
    referer: nhentaiGalleryReferer(input.slug),
    maxBytes: input.args.maxProbeBytes,
    timeoutMs: input.args.timeoutMs,
  });
  return {
    source: "nhentai",
    sourceInput: input.sourceInput,
    title: input.title,
    serverId: input.server.id,
    serverLabel: input.server.label,
    estimatedBytes: input.estimatedBytes ?? null,
    measuredBytes: result.measuredBytes,
    durationMs: result.durationMs,
    status: result.status,
    httpStatus: result.httpStatus,
    retryAfter: result.retryAfter,
  };
}

async function probeImageDownload(input: {
  url: string;
  referer: string;
  cookie?: string | null;
  maxBytes: number;
  timeoutMs: number;
}) {
  return probeContentArchiveImageDownload({
    url: input.url,
    referer: input.referer,
    maxBytes: input.maxBytes,
    timeoutMs: input.timeoutMs,
    cookie: input.cookie ?? null,
  });
}

function skippedProbe(
  source: SupportedContentArchiveSourceKey,
  sourceInput: string,
  title: string | null,
  reason: string,
  server?: LibSocialArchiveImageServerOption | null,
): ContentArchiveCalibrationProbe {
  return {
    source,
    sourceInput,
    title,
    serverId: server?.id ?? null,
    serverLabel: server?.label ?? reason,
    estimatedBytes: server?.sizeEstimate?.estimatedBytes ?? null,
    measuredBytes: 0,
    durationMs: 0,
    status: "skipped",
  };
}

function failedProbe(input: {
  source: SupportedContentArchiveSourceKey;
  sourceInput: string;
  title: string | null;
  server: LibSocialArchiveImageServerOption | null;
  estimatedBytes: number | null;
  error: unknown;
}): ContentArchiveCalibrationProbe {
  return {
    source: input.source,
    sourceInput: input.sourceInput,
    title: input.title,
    serverId: input.server?.id ?? null,
    serverLabel: input.server?.label ?? formatError(input.error),
    estimatedBytes: input.estimatedBytes,
    measuredBytes: 0,
    durationMs: 0,
    status: "failed",
  };
}

async function loadSourceInputs(args: Args): Promise<string[]> {
  const values = [...args.sourceInputs];
  if (args.inputFile) {
    const raw = await readFile(args.inputFile, "utf8");
    values.push(...extractUrlsAndInputs(raw));
  }
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function extractUrlsAndInputs(raw: string): string[] {
  const urls = raw.match(/https?:\/\/[^\s)\]]+/gi) ?? [];
  if (urls.length > 0) return urls.map((url) => url.replace(/[),.]+$/g, ""));
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function renderMarkdownReport(report: CalibrationReport): string {
  const lines = [
    "# Content Archive Calibration",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Settings",
    "",
    `- Max links: ${report.settings.maxLinks}`,
    `- Max servers per title: ${report.settings.maxServers}`,
    `- Sample pages per server: ${report.settings.samplePages}`,
    `- Max probe bytes per image: ${formatBytes(report.settings.maxProbeBytes)}`,
    `- Timeout: ${report.settings.timeoutMs} ms`,
    "",
    "## Probe Results",
    "",
    "| Source | Title | Server | Estimate | Probe | Time | Speed | Status |",
    "|---|---|---|---:|---:|---:|---:|---|",
    ...report.probes.map((probe) => {
      const speed = contentArchiveProbeBytesPerSecond(probe);
      return [
        sourceLabel(probe.source),
        escapeTable(probe.title ?? basename(probe.sourceInput)),
        escapeTable(probe.serverLabel ?? probe.serverId ?? "n/a"),
        probe.estimatedBytes ? formatBytes(probe.estimatedBytes) : "n/a",
        probe.measuredBytes ? formatBytes(probe.measuredBytes) : "n/a",
        probe.durationMs ? `${(probe.durationMs / 1000).toFixed(2)}s` : "n/a",
        speed ? `${formatBytes(speed)}/s` : "n/a",
        probe.httpStatus ? `${probe.status} (${probe.httpStatus})` : probe.status,
      ].join(" | ");
    }).map((row) => `| ${row} |`),
    "",
    "## Recommended Lanes",
    "",
    ...report.summary.lanes.flatMap((lane) => [
      `### ${capitalize(lane.name)}`,
      "",
      `- Page delay: ${lane.pageDelayMs} ms`,
      `- Measured speed basis: ${lane.bytesPerSecond ? `${formatBytes(lane.bytesPerSecond)}/s` : "n/a"}`,
      `- Estimated total time for probed set: ${lane.estimatedSeconds ? formatDuration(lane.estimatedSeconds) : "n/a"}`,
      ...lane.notes.map((note) => `- ${note}`),
      "",
    ]),
  ];
  return `${lines.join("\n")}\n`;
}

function renderConsoleSummary(report: CalibrationReport): string {
  const lines = [
    "[content-archive:calibrate] summary",
    `  ok probes: ${report.summary.okProbeCount}`,
    `  failed probes: ${report.summary.failedProbeCount}`,
    `  skipped probes: ${report.summary.skippedProbeCount}`,
    `  fastest: ${report.summary.fastestBytesPerSecond ? `${formatBytes(report.summary.fastestBytesPerSecond)}/s` : "n/a"}`,
    `  median: ${report.summary.medianBytesPerSecond ? `${formatBytes(report.summary.medianBytesPerSecond)}/s` : "n/a"}`,
  ];
  for (const lane of report.summary.lanes) {
    lines.push(
      `  ${lane.name}: delay ${lane.pageDelayMs}ms, ETA ${
        lane.estimatedSeconds ? formatDuration(lane.estimatedSeconds) : "n/a"
      }`,
    );
  }
  return lines.join("\n");
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    sourceInputs: [],
    inputFile: null,
    maxLinks: 8,
    maxServers: 3,
    samplePages: 1,
    maxProbeBytes: 8 * 1024 * 1024,
    timeoutMs: 20_000,
    outputDir: null,
    jsonOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = () => argv[++index] ?? "";
    if (arg === "--source-input") args.sourceInputs.push(next());
    else if (arg.startsWith("--source-input=")) args.sourceInputs.push(arg.slice(15));
    else if (arg === "--input-file") args.inputFile = next();
    else if (arg.startsWith("--input-file=")) args.inputFile = arg.slice(13);
    else if (arg === "--max-links") args.maxLinks = parsePositiveInteger(next(), "max-links");
    else if (arg.startsWith("--max-links=")) args.maxLinks = parsePositiveInteger(arg.slice(12), "max-links");
    else if (arg === "--max-servers") args.maxServers = parsePositiveInteger(next(), "max-servers");
    else if (arg.startsWith("--max-servers=")) args.maxServers = parsePositiveInteger(arg.slice(14), "max-servers");
    else if (arg === "--sample-pages") args.samplePages = parsePositiveInteger(next(), "sample-pages");
    else if (arg.startsWith("--sample-pages=")) args.samplePages = parsePositiveInteger(arg.slice(15), "sample-pages");
    else if (arg === "--max-probe-bytes") args.maxProbeBytes = parsePositiveInteger(next(), "max-probe-bytes");
    else if (arg.startsWith("--max-probe-bytes=")) args.maxProbeBytes = parsePositiveInteger(arg.slice(18), "max-probe-bytes");
    else if (arg === "--timeout-ms") args.timeoutMs = parsePositiveInteger(next(), "timeout-ms");
    else if (arg.startsWith("--timeout-ms=")) args.timeoutMs = parsePositiveInteger(arg.slice(13), "timeout-ms");
    else if (arg === "--output-dir") args.outputDir = next();
    else if (arg.startsWith("--output-dir=")) args.outputDir = arg.slice(13);
    else if (arg === "--json") args.jsonOnly = true;
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run content-archive:calibrate -- --source-input "https://nhentai.net/g/197016/"
  npm run content-archive:calibrate -- --input-file /tmp/archive-links.md --max-links 6

Options:
  --source-input VALUE       Pasted MangaLib, nHentai, SlashLib, or HentaiLib title/gallery URL. Repeatable.
  --input-file PATH          Text/Markdown file containing source URLs.
  --max-links N              Limit source inputs. Default: 8.
  --max-servers N            Limit source image servers probed per title. Default: 3.
  --sample-pages N           nHentai pages to consider for probe selection. Default: 1.
  --max-probe-bytes N        Max bytes read per probe image. Default: 8388608.
  --timeout-ms N             Per-image probe timeout. Default: 20000.
  --output-dir PATH          Defaults to .atlas-backups/content-calibration.
  --json                     Write JSON only.
`);
}

function loadLocalEnv() {
  for (const path of [".env.local", ".backup.env", ".env"]) {
    loadEnv({ path, override: false, quiet: true });
  }
}

function inferContentArchiveSourceFromHost(
  rawInput: string,
): SupportedContentArchiveSourceKey | null {
  const withProtocol = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "nhentai.net") return "nhentai";
  if (host === "mangalib.me" || host === "mangalib.org") return "mangalib";
  if (host === "hentailib.me") return "hentailib";
  if (host === "slashlib.me" || host === "v2.shlib.life" || host === "shlib.life") {
    return "slashlib";
  }
  return null;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return parsed;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

function formatError(error: unknown): string {
  return redactContentArchiveAccessMessage(error);
}

function redactContentArchiveAccessMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._-]{20,}\b/g, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9._-]{20,}\b/g, "[redacted-token]")
    .replace(/\bdef50200[A-Za-z0-9._-]{20,}\b/g, "[redacted-refresh-token]")
    .replace(/refresh_token["':=\s]+[A-Za-z0-9._-]{20,}/gi, "refresh_token=[redacted]");
}

main().catch((error) => {
  console.error(redactContentArchiveAccessMessage(error));
  process.exit(1);
});
