import {
  type ContentArchiveCoverAsset,
  type LibSocialContentArchiveSourceKey,
  parseContentArchiveSourceInput,
  parseMangaLibArchiveInput,
  parseSlashLibArchiveInput,
  sourceLabel,
} from "./planning";
import { resolveContentArchiveImageCookie } from "./image-cookie";
import { fetchContentArchiveImageByteLength } from "./reachability";

const LIBSOCIAL_CONTENT_ARCHIVE_API_BASE = "https://api.cdnlibs.org";
const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_RETRIES = 0;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const SIZE_ESTIMATE_SAMPLE_CHAPTERS = 1;
const SIZE_ESTIMATE_IMAGE_TIMEOUT_MS = 1_500;

type JsonObject = Record<string, unknown>;

type LibSocialContentArchiveSourceConfig = {
  apiBaseEnv: string;
  bearerTokenEnv: string;
  defaultHomepage: string;
  defaultImageBase: string;
  homepageEnv: string;
  siteId: number;
};

const LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_CONFIG: Record<
  LibSocialContentArchiveSourceKey,
  LibSocialContentArchiveSourceConfig
> = {
  mangalib: {
    apiBaseEnv: "ATLAS_CONTENT_ARCHIVE_MANGALIB_API_BASE",
    bearerTokenEnv: "ATLAS_CONTENT_ARCHIVE_MANGALIB_BEARER_TOKEN",
    defaultHomepage: "https://mangalib.me",
    defaultImageBase: "https://img3.cdnlibs.org",
    homepageEnv: "LIBSOCIAL_MANGALIB_HOMEPAGE",
    siteId: 1,
  },
  slashlib: {
    apiBaseEnv: "ATLAS_CONTENT_ARCHIVE_SLASHLIB_API_BASE",
    bearerTokenEnv: "ATLAS_CONTENT_ARCHIVE_SLASHLIB_BEARER_TOKEN",
    defaultHomepage: "https://slashlib.me",
    defaultImageBase: "https://img3.cdnlibs.org",
    homepageEnv: "LIBSOCIAL_SLASHLIB_HOMEPAGE",
    siteId: 2,
  },
  hentailib: {
    apiBaseEnv: "ATLAS_CONTENT_ARCHIVE_HENTAILIB_API_BASE",
    bearerTokenEnv: "ATLAS_CONTENT_ARCHIVE_HENTAILIB_BEARER_TOKEN",
    defaultHomepage: "https://hentailib.me",
    defaultImageBase: "https://img2h.hentaicdn.org",
    homepageEnv: "LIBSOCIAL_HENTAILIB_HOMEPAGE",
    siteId: 4,
  },
};

export type LibSocialContentArchiveChapterRow = {
  id: number;
  index: number;
  volume: string;
  number: string;
  displayLabel?: string | null;
  name: string | null;
  branchId: number | null;
  branchName: string | null;
  selectionKey: string;
  sizeEstimate?: LibSocialArchiveChapterSizeEstimate | null;
};

export type MangaLibChapterRow = LibSocialContentArchiveChapterRow;
export type SlashLibChapterRow = LibSocialContentArchiveChapterRow;
export type HentaiLibChapterRow = LibSocialContentArchiveChapterRow;

export type LibSocialArchiveImageServerOption = {
  id: string;
  label: string;
  chapterSizeEstimates?: Record<string, LibSocialArchiveChapterSizeEstimate> | null;
  sizeEstimate?: {
    estimatedBytes: number | null;
    estimateKind: "sampled" | "average" | "unknown";
    sampledChapters: number;
  } | null;
  url: string;
  isDefault: boolean;
};

export type LibSocialArchiveChapterSizeEstimate = {
  estimatedBytes: number | null;
  estimateKind: "sampled" | "average" | "unknown";
  pageCount: number | null;
  sampledBytes: number | null;
};

export type LibSocialContentArchiveTitleChapterPlan = {
  source: LibSocialContentArchiveSourceKey;
  sourceInput: string;
  title: string;
  slug: string;
  apiBase: string;
  homepage: string;
  chapters: LibSocialContentArchiveChapterRow[];
  coverUrl: string | null;
  coverAssets: ContentArchiveCoverAsset[];
  defaultImageServerId: string | null;
  imageServers: LibSocialArchiveImageServerOption[];
  sizeEstimate: {
    estimatedBytes: number | null;
    estimateKind: "sampled" | "average" | "unknown";
    sampledChapters: number;
  };
};

export type MangaLibTitleChapterPlan = LibSocialContentArchiveTitleChapterPlan;
export type SlashLibTitleChapterPlan = LibSocialContentArchiveTitleChapterPlan;
export type HentaiLibTitleChapterPlan = LibSocialContentArchiveTitleChapterPlan;

export async function loadMangaLibTitleChapters(input: {
  sourceInput: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  authorization?: string | null;
}): Promise<MangaLibTitleChapterPlan> {
  return loadLibSocialTitleChapters({ ...input, source: "mangalib" });
}

export async function loadHentaiLibTitleChapters(input: {
  sourceInput: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  authorization?: string | null;
}): Promise<HentaiLibTitleChapterPlan> {
  return loadLibSocialTitleChapters({ ...input, source: "hentailib" });
}

export async function loadSlashLibTitleChapters(input: {
  sourceInput: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  authorization?: string | null;
}): Promise<SlashLibTitleChapterPlan> {
  return loadLibSocialTitleChapters({ ...input, source: "slashlib" });
}

export async function loadLibSocialTitleChapters(input: {
  source: LibSocialContentArchiveSourceKey;
  sourceInput: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  authorization?: string | null;
  estimateSizes?: boolean;
  imageServerId?: string | null;
  imageCookie?: string | null;
}): Promise<LibSocialContentArchiveTitleChapterPlan> {
  const parsedInput =
    input.source === "mangalib"
      ? parseMangaLibArchiveInput(input.sourceInput)
      : input.source === "slashlib"
        ? parseSlashLibArchiveInput(input.sourceInput)
        : parseContentArchiveSourceInput(input.source, input.sourceInput);
  const label = sourceLabel(input.source);
  if (!parsedInput) {
    throw new Error(`Paste a valid ${label} title link, slug, or id.`);
  }
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const config = LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_CONFIG[input.source];
  const apiBase = trimTrailingSlash(
    env[config.apiBaseEnv] ?? LIBSOCIAL_CONTENT_ARCHIVE_API_BASE,
  );
  const homepage = libSocialArchiveHomepageForInput(input.source, parsedInput.url, env);
  const detail = await fetchLibSocialArchiveDetail({
    source: input.source,
    apiBase,
    homepage,
    externalId: parsedInput.externalId,
    fetchImpl,
    authorization: input.authorization ?? null,
  });
  const title =
    stringField(detail, "eng_name") ??
    stringField(detail, "name") ??
    stringField(detail, "rus_name") ??
    parsedInput.externalId;
  const slug =
    stringField(detail, "slug_url") ??
    stringField(detail, "slug") ??
    parsedInput.externalId;
  if (!/^\d+--[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    throw new Error(`${label} detail did not resolve to a usable title slug.`);
  }
  const chapters = await fetchLibSocialArchiveChapters({
    source: input.source,
    apiBase,
    homepage,
    slug,
    fetchImpl,
    authorization: input.authorization ?? null,
  });
  let imageServers = await fetchLibSocialArchiveImageServers({
    source: input.source,
    apiBase,
    homepage,
    env,
    fetchImpl,
    authorization: input.authorization ?? null,
    selectedImageServerId: input.imageServerId ?? null,
  });
  let selectedImageServer =
    imageServers.find((server) => server.isDefault) ?? imageServers[0] ?? null;
  const sizeEstimates = input.estimateSizes
    ? await estimateLibSocialArchiveChapterSizesForServers({
        source: input.source,
        apiBase,
        homepage,
        slug,
        chapters,
        imageServers,
        fetchImpl,
        authorization: input.authorization ?? null,
        env,
        imageCookie:
          input.imageCookie ?? resolveContentArchiveImageCookie(input.source, env),
      })
    : new Map<string, LibSocialArchiveSizeEstimateForServer>();
  if (input.estimateSizes) {
    imageServers = imageServers.map((server) => ({
      ...server,
      chapterSizeEstimates: chapterSizeEstimateMap(
        sizeEstimates.get(server.id)?.chapters ?? null,
      ),
      sizeEstimate: sizeEstimates.get(server.id)?.titleEstimate ?? null,
    }));
    selectedImageServer =
      imageServers.find((server) => server.isDefault) ?? imageServers[0] ?? null;
  }
  const selectedSizeEstimate = selectedImageServer
    ? sizeEstimates.get(selectedImageServer.id)
    : null;
  const sizeEstimate = selectedSizeEstimate ?? {
    chapters,
    titleEstimate: {
      estimatedBytes: null,
      estimateKind: "unknown" as const,
      sampledChapters: 0,
    },
  };
  return {
    source: input.source,
    sourceInput: input.sourceInput,
    title,
    slug,
    apiBase,
    homepage,
    chapters: sizeEstimate.chapters,
    coverUrl: coverUrlFromDetail(detail),
    coverAssets: await fetchLibSocialArchiveCoverAssets({
      source: input.source,
      apiBase,
      homepage,
      slug,
      detail,
      fetchImpl,
      authorization: input.authorization ?? null,
    }),
    defaultImageServerId: selectedImageServer?.id ?? null,
    imageServers,
    sizeEstimate: sizeEstimate.titleEstimate,
  };
}

function chapterSizeEstimateMap(
  chapters: LibSocialContentArchiveChapterRow[] | null,
): Record<string, LibSocialArchiveChapterSizeEstimate> | null {
  if (!chapters) return null;
  const entries = chapters.map((chapter) => [
    chapter.selectionKey,
    chapter.sizeEstimate ?? {
      estimatedBytes: null,
      estimateKind: "unknown" as const,
      pageCount: null,
      sampledBytes: null,
    },
  ]);
  return Object.fromEntries(entries);
}

type LibSocialArchiveSizeEstimateForServer = {
  chapters: LibSocialContentArchiveChapterRow[];
  titleEstimate: {
    estimatedBytes: number | null;
    estimateKind: "sampled" | "average" | "unknown";
    sampledChapters: number;
  };
};

export function normalizeMangaLibChapterRow(row: unknown): MangaLibChapterRow | null {
  return normalizeLibSocialArchiveChapterRows(row)[0] ?? null;
}

export function normalizeMangaLibChapterRows(row: unknown): MangaLibChapterRow[] {
  return normalizeLibSocialArchiveChapterRows(row);
}

export function normalizeLibSocialArchiveChapterRow(
  row: unknown,
): LibSocialContentArchiveChapterRow | null {
  return normalizeLibSocialArchiveChapterRows(row)[0] ?? null;
}

export function normalizeLibSocialArchiveChapterRows(
  row: unknown,
): LibSocialContentArchiveChapterRow[] {
  if (!isObject(row)) return [];
  const id = numberField(row, "id");
  const index = numberField(row, "index") ?? numberField(row, "item_number");
  const volume = stringField(row, "volume") ?? "1";
  const number = stringField(row, "number") ?? stringField(row, "item_number");
  if (!id || !index || !number) return [];

  const base = {
    id,
    index,
    volume,
    number,
    name: stringField(row, "name"),
  };
  const branches = Array.isArray(row.branches)
    ? row.branches.filter((branch): branch is JsonObject => isObject(branch))
    : [];
  if (branches.length === 0) {
    return [
      {
        ...base,
        branchId: null,
        branchName: null,
        selectionKey: libSocialArchiveChapterSelectionKey({
          chapterId: id,
          branchId: null,
        }),
      },
    ];
  }
  return branches.map((branch) => {
    const branchId = numberField(branch, "branch_id") ?? numberField(branch, "id");
    const branchName = branchDisplayName(branch);
    return {
      ...base,
      branchId,
      branchName,
      selectionKey: libSocialArchiveChapterSelectionKey({ chapterId: id, branchId }),
    };
  });
}

export function mangaLibChapterRangeValue(chapter: MangaLibChapterRow): string | number {
  return libSocialArchiveChapterRangeValue(chapter);
}

export function libSocialArchiveChapterRangeValue(
  chapter: LibSocialContentArchiveChapterRow,
): string | number {
  const numericChapterNumber = Number(chapter.number.trim());
  return Number.isFinite(numericChapterNumber) ? chapter.number : chapter.index;
}

export function parseMangaLibChapterPages(value: unknown): Array<{ url: string }> {
  return parseLibSocialArchiveChapterPages(value);
}

export function parseLibSocialArchiveChapterPages(value: unknown): Array<{ url: string }> {
  const data = isObject(value) && isObject(value.data) ? value.data : value;
  if (!isObject(data)) return [];
  const rows = Array.isArray(data.attachments)
    ? data.attachments
    : Array.isArray(data.pages)
      ? data.pages
      : [];
  return rows
    .map((row) => (isObject(row) ? stringField(row, "url") : null))
    .filter((url): url is string => Boolean(url))
    .map((url) => ({ url }));
}

export function mangaLibChapterSelectionKey(input: {
  chapterId: number;
  branchId: number | null;
}): string {
  return libSocialArchiveChapterSelectionKey(input);
}

export function libSocialArchiveChapterSelectionKey(input: {
  chapterId: number;
  branchId: number | null;
}): string {
  return input.branchId ? `${input.chapterId}:${input.branchId}` : String(input.chapterId);
}

export function parseMangaLibChapterSelectionKey(value: string): {
  chapterId: number;
  branchId: number | null;
} | null {
  return parseLibSocialArchiveChapterSelectionKey(value);
}

export function parseLibSocialArchiveChapterSelectionKey(value: string): {
  chapterId: number;
  branchId: number | null;
} | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [chapterPart, branchPart] = trimmed.split(":", 2);
  const chapterId = Number(chapterPart);
  const branchId = branchPart ? Number(branchPart) : null;
  if (!Number.isSafeInteger(chapterId) || chapterId <= 0) return null;
  if (branchPart && (!Number.isSafeInteger(branchId) || Number(branchId) <= 0)) {
    return null;
  }
  return { chapterId, branchId };
}

export function selectMangaLibImageServer(
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return selectLibSocialArchiveImageServer({
    payload,
    source: "mangalib",
    env,
  });
}

export function selectLibSocialArchiveImageServer(input: {
  payload: unknown;
  source: LibSocialContentArchiveSourceKey;
  env?: NodeJS.ProcessEnv;
  serverId?: string | null;
}): string {
  return selectLibSocialArchiveImageServerOption(input).url;
}

export function listLibSocialArchiveImageServerOptions(input: {
  payload: unknown;
  source: LibSocialContentArchiveSourceKey;
  env?: NodeJS.ProcessEnv;
  serverId?: string | null;
}): LibSocialArchiveImageServerOption[] {
  const env = input.env ?? process.env;
  const config = LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_CONFIG[input.source];
  const override = env[`${sourceImageBaseEnv(input.source)}`]?.trim();
  if (override) {
    return [
      {
        id: "env",
        label: "Environment override",
        url: trimTrailingSlash(override),
        isDefault: true,
      },
    ];
  }
  const data =
    isObject(input.payload) && isObject(input.payload.data)
      ? input.payload.data
      : input.payload;
  const rows = isObject(data) && Array.isArray(data.imageServers) ? data.imageServers : [];
  const seen = new Set<string>();
  const options = rows
    .filter((server): server is JsonObject => isObject(server) && serverMatchesSource(server, input.source))
    .map((server) => {
      const id = stringField(server, "id");
      const url = stringField(server, "url");
      if (!id || !url) return null;
      const key = `${id}:${url}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id,
        label: stringField(server, "label") ?? imageServerLabel(id),
        url: trimTrailingSlash(url),
        isDefault: false,
      };
    })
    .filter((server): server is LibSocialArchiveImageServerOption => Boolean(server));
  if (options.length === 0) {
    options.push({
      id: "default",
      label: "Default",
      url: config.defaultImageBase,
      isDefault: false,
    });
  }
  const defaultServer = selectDefaultImageServerOption(options, input.serverId);
  return options.map((server) => ({
    ...server,
    isDefault: server === defaultServer,
  }));
}

export function selectLibSocialArchiveImageServerOption(input: {
  payload: unknown;
  source: LibSocialContentArchiveSourceKey;
  env?: NodeJS.ProcessEnv;
  serverId?: string | null;
}): LibSocialArchiveImageServerOption {
  const options = listLibSocialArchiveImageServerOptions(input);
  return options.find((server) => server.isDefault) ?? options[0]!;
}

export function mangaLibImageUrlForPage(pageUrl: string, imageBase: string): string {
  const trimmed = pageUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = trimTrailingSlash(imageBase);
  if (trimmed.startsWith("//")) return `${base}/${trimmed.replace(/^\/+/, "")}`;
  return `${base}/${trimmed.replace(/^\/+/, "")}`;
}

export async function fetchMangaLibChapterPages(input: {
  apiBase: string;
  homepage: string;
  slug: string;
  chapter: MangaLibChapterRow;
  fetchImpl: typeof fetch;
  authorization?: string | null;
}): Promise<Array<{ url: string }>> {
  return fetchLibSocialArchiveChapterPages({ ...input, source: "mangalib" });
}

export async function fetchLibSocialArchiveChapterPages(input: {
  source: LibSocialContentArchiveSourceKey;
  apiBase: string;
  homepage: string;
  slug: string;
  chapter: LibSocialContentArchiveChapterRow;
  fetchImpl: typeof fetch;
  authorization?: string | null;
}): Promise<Array<{ url: string }>> {
  const params = new URLSearchParams({
    volume: input.chapter.volume,
    number: input.chapter.number,
  });
  if (input.chapter.branchId) params.set("branch_id", String(input.chapter.branchId));
  const payload = await requestJson({
    ...input,
    path: `/api/manga/${encodeURIComponent(input.slug)}/chapter?${params.toString()}`,
  });
  return parseLibSocialArchiveChapterPages(payload);
}

export function isLibSocialArchiveAuthRefreshCandidate(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b(401|403)\b|rejected the configured bearer token/i.test(message) ||
    /returned 404:[\s\S]*"message"\s*:\s*"Not Found"/i.test(message)
  );
}

export async function fetchMangaLibImageBase(input: {
  apiBase: string;
  homepage: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  authorization?: string | null;
}): Promise<string> {
  return fetchLibSocialArchiveImageBase({ ...input, source: "mangalib" });
}

export async function fetchLibSocialArchiveImageBase(input: {
  source: LibSocialContentArchiveSourceKey;
  apiBase: string;
  homepage: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  authorization?: string | null;
  imageServerId?: string | null;
}): Promise<string> {
  const server = await fetchLibSocialArchiveImageServer(input);
  return server.url;
}

export async function fetchLibSocialArchiveImageServer(input: {
  source: LibSocialContentArchiveSourceKey;
  apiBase: string;
  homepage: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  authorization?: string | null;
  imageServerId?: string | null;
}): Promise<LibSocialArchiveImageServerOption> {
  const servers = await fetchLibSocialArchiveImageServers({
    ...input,
    selectedImageServerId: input.imageServerId ?? null,
  });
  return servers.find((server) => server.isDefault) ?? servers[0]!;
}

export async function fetchLibSocialArchiveImageServers(input: {
  source: LibSocialContentArchiveSourceKey;
  apiBase: string;
  homepage: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  authorization?: string | null;
  selectedImageServerId?: string | null;
}): Promise<LibSocialArchiveImageServerOption[]> {
  const payload = await requestJson({
    source: input.source,
    apiBase: input.apiBase,
    homepage: input.homepage,
    fetchImpl: input.fetchImpl,
    authorization: input.authorization ?? null,
    path: "/api/constants?fields[]=imageServers",
  });
  return listLibSocialArchiveImageServerOptions({
    payload,
    source: input.source,
    env: input.env,
    serverId: input.selectedImageServerId ?? null,
  });
}

async function fetchLibSocialArchiveDetail(input: {
  source: LibSocialContentArchiveSourceKey;
  apiBase: string;
  homepage: string;
  externalId: string;
  fetchImpl: typeof fetch;
  authorization?: string | null;
}): Promise<JsonObject> {
  const params = new URLSearchParams();
  for (const field of ["eng_name", "otherNames", "summary", "rate", "metadata"]) {
    params.append("fields[]", field);
  }
  const payload = await requestJson({
    ...input,
    path: `/api/manga/${encodeURIComponent(input.externalId)}?${params.toString()}`,
  });
  const data = isObject(payload.data) ? payload.data : payload;
  if (!isObject(data)) throw new Error(`${sourceLabel(input.source)} detail payload is invalid.`);
  return data;
}

async function fetchLibSocialArchiveChapters(input: {
  source: LibSocialContentArchiveSourceKey;
  apiBase: string;
  homepage: string;
  slug: string;
  fetchImpl: typeof fetch;
  authorization?: string | null;
}): Promise<LibSocialContentArchiveChapterRow[]> {
  const payload = await requestJson({
    ...input,
    path: `/api/manga/${encodeURIComponent(input.slug)}/chapters`,
  });
  const rows = extractDataRows(payload)
    .flatMap(normalizeLibSocialArchiveChapterRows)
    .filter((row): row is LibSocialContentArchiveChapterRow => Boolean(row));
  if (rows.length === 0) {
    throw new Error(`${sourceLabel(input.source)} chapter list returned no usable chapters.`);
  }
  return rows.sort((a, b) => a.index - b.index);
}

async function fetchLibSocialArchiveCoverAssets(input: {
  source: LibSocialContentArchiveSourceKey;
  apiBase: string;
  homepage: string;
  slug: string;
  detail: JsonObject;
  fetchImpl: typeof fetch;
  authorization?: string | null;
}): Promise<ContentArchiveCoverAsset[]> {
  const assets: ContentArchiveCoverAsset[] = [];
  const current = coverAssetFromRawCover({
    id: "current",
    label: "Current cover",
    rawCover: input.detail.cover,
  });
  if (current) assets.push(current);

  try {
    const payload = await requestJson({
      source: input.source,
      apiBase: input.apiBase,
      homepage: input.homepage,
      fetchImpl: input.fetchImpl,
      authorization: input.authorization ?? null,
      path: `/api/manga/${encodeURIComponent(input.slug)}/covers`,
    });
    for (const [index, row] of extractDataRows(payload).entries()) {
      const rawCover = isObject(row) && "cover" in row ? row.cover : row;
      const asset = coverAssetFromRawCover({
        id: `cover-${index + 1}`,
        label: `Cover ${index + 1}`,
        rawCover,
      });
      if (asset) assets.push(asset);
    }
  } catch {
    // Cover galleries are useful operator evidence, not a reason to fail analysis.
  }

  return dedupeCoverAssets(assets);
}

async function requestJson(input: {
  source: LibSocialContentArchiveSourceKey;
  apiBase: string;
  homepage: string;
  path: string;
  fetchImpl: typeof fetch;
  authorization?: string | null;
}): Promise<JsonObject> {
  const url = `${input.apiBase}${input.path.startsWith("/") ? input.path : `/${input.path}`}`;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await input.fetchImpl(url, {
        headers: requestHeaders(input.source, input.homepage, input.authorization),
        signal: controller.signal,
      });
      const text = await response.text();
      clearTimeout(timeout);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(
          `Expected JSON from ${sourceLabel(input.source)}, got ${response.status}: ${text.slice(0, 180)}`,
        );
      }
      if (!response.ok) {
        if (RETRYABLE_STATUSES.has(response.status) && attempt < REQUEST_RETRIES) {
          await sleep(retryDelayMs(attempt, response));
          continue;
        }
        throw new Error(
          `${sourceLabel(input.source)} returned ${response.status}: ${JSON.stringify(parsed).slice(0, 240)}`,
        );
      }
      if (!isObject(parsed)) {
        throw new Error(`${sourceLabel(input.source)} returned a non-object payload.`);
      }
      return parsed;
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < REQUEST_RETRIES && isRetryableNetworkError(error)) {
        await sleep(retryDelayMs(attempt, null));
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `${sourceLabel(input.source)} request failed after ${REQUEST_RETRIES + 1} attempts.`,
  );
}

function requestHeaders(
  source: LibSocialContentArchiveSourceKey,
  homepage: string,
  authorization: string | null | undefined,
): Record<string, string> {
  const config = LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_CONFIG[source];
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: homepage,
    Referer: `${homepage}/`,
    "Site-Id": String(config.siteId),
    Site_Id: String(config.siteId),
    "User-Agent": `Atlas/1.0 (${sourceLabel(source)} content archive; private operator job)`,
  };
  const token =
    authorization?.trim() ??
    process.env[config.bearerTokenEnv]?.trim();
  if (token) {
    headers.Authorization = token.toLowerCase().startsWith("bearer ")
      ? token
      : `Bearer ${token}`;
  }
  return headers;
}

function extractDataRows(payload: unknown): unknown[] {
  if (!isObject(payload)) return [];
  const data = payload.data;
  if (Array.isArray(data)) return data;
  if (!isObject(data)) return [];
  for (const key of ["items", "bookmarks", "list", "results", "data"]) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function branchDisplayName(branch: JsonObject): string | null {
  const direct =
    stringField(branch, "name") ??
    stringField(branch, "branch_name") ??
    stringField(branch, "title") ??
    stringField(branch, "label");
  if (direct) return direct;

  const teams = Array.isArray(branch.teams)
    ? branch.teams
        .map((team) => (isObject(team) ? stringField(team, "name") ?? stringField(team, "title") : null))
        .filter((name): name is string => Boolean(name))
    : [];
  if (teams.length > 0) return teams.join(", ");

  const team = isObject(branch.team)
    ? stringField(branch.team, "name") ?? stringField(branch.team, "title")
    : null;
  if (team) return team;

  const branchId = numberField(branch, "branch_id") ?? numberField(branch, "id");
  return branchId ? `translation-${branchId}` : null;
}

async function estimateLibSocialArchiveChapterSizesForServers(input: {
  source: LibSocialContentArchiveSourceKey;
  apiBase: string;
  homepage: string;
  slug: string;
  chapters: LibSocialContentArchiveChapterRow[];
  imageServers: LibSocialArchiveImageServerOption[];
  fetchImpl: typeof fetch;
  authorization?: string | null;
  env?: NodeJS.ProcessEnv;
  imageCookie?: string | null;
}): Promise<Map<string, LibSocialArchiveSizeEstimateForServer>> {
  const imageCookie =
    input.imageCookie ??
    resolveContentArchiveImageCookie(input.source, input.env ?? process.env);
  const sampledChapters: Array<{
    chapter: LibSocialContentArchiveChapterRow;
    pages: Array<{ url: string }>;
  }> = [];

  for (const chapter of input.chapters.slice(0, SIZE_ESTIMATE_SAMPLE_CHAPTERS)) {
    try {
      const pages = await fetchLibSocialArchiveChapterPages({
        source: input.source,
        apiBase: input.apiBase,
        homepage: input.homepage,
        slug: input.slug,
        chapter,
        fetchImpl: input.fetchImpl,
        authorization: input.authorization ?? null,
      });
      sampledChapters.push({ chapter, pages });
    } catch {
      sampledChapters.push({ chapter, pages: [] });
    }
  }

  const results = await Promise.all(
    input.imageServers.map(async (imageServer) => {
      const sampledEstimates = new Map<string, LibSocialArchiveChapterSizeEstimate>();
      const sampled = (
        await Promise.all(
          sampledChapters.map(async (sample) => {
            const firstPage = sample.pages[0]?.url;
            const sampledBytes = firstPage
              ? await fetchContentArchiveImageByteLength({
                  fetchImpl: input.fetchImpl,
                  referer: `${input.homepage}/manga/${input.slug}/chapter?number=${encodeURIComponent(sample.chapter.number)}&volume=${encodeURIComponent(sample.chapter.volume)}`,
                  url: mangaLibImageUrlForPage(firstPage, imageServer.url),
                  cookie: imageCookie,
                  timeoutMs: SIZE_ESTIMATE_IMAGE_TIMEOUT_MS,
                  bodyFallback: true,
                })
              : null;
            const estimatedBytes =
              sampledBytes && sample.pages.length > 0
                ? Math.max(1, sampledBytes * sample.pages.length)
                : null;
            sampledEstimates.set(sample.chapter.selectionKey, {
              estimatedBytes,
              estimateKind: estimatedBytes ? "sampled" : "unknown",
              pageCount: sample.pages.length || null,
              sampledBytes,
            });
            return estimatedBytes && sampledBytes
              ? {
                  estimatedBytes,
                  pageCount: sample.pages.length,
                  sampledBytes,
                  selectionKey: sample.chapter.selectionKey,
                }
              : null;
          }),
        )
      ).filter((sample): sample is {
        estimatedBytes: number;
        pageCount: number;
        sampledBytes: number;
        selectionKey: string;
      } => Boolean(sample));

      const averageChapterBytes =
        sampled.length > 0
          ? Math.round(sampled.reduce((sum, item) => sum + item.estimatedBytes, 0) / sampled.length)
          : null;
      const chapters = input.chapters.map((chapter) => {
        const sampledEstimate = sampledEstimates.get(chapter.selectionKey);
        if (sampledEstimate?.estimatedBytes || !averageChapterBytes) {
          return {
            ...chapter,
            sizeEstimate: sampledEstimate ?? {
              estimatedBytes: null,
              estimateKind: "unknown" as const,
              pageCount: null,
              sampledBytes: null,
            },
          };
        }
        return {
          ...chapter,
          sizeEstimate: {
            estimatedBytes: averageChapterBytes,
            estimateKind: "average" as const,
            pageCount: sampledEstimate?.pageCount ?? null,
            sampledBytes: null,
          },
        };
      });
      const totalBytes = averageChapterBytes
        ? chapters.reduce(
            (sum, chapter) => sum + (chapter.sizeEstimate?.estimatedBytes ?? averageChapterBytes),
            0,
          )
        : null;
      return [
        imageServer.id,
        {
          chapters,
          titleEstimate: {
            estimatedBytes: totalBytes,
            estimateKind:
              sampled.length === 0
                ? "unknown"
                : sampled.length === input.chapters.length
                  ? "sampled"
                  : "average",
            sampledChapters: sampled.length,
          },
        },
      ] as const;
    }),
  );
  return new Map(results);
}

function coverUrlFromDetail(detail: JsonObject): string | null {
  const cover = isObject(detail.cover) ? detail.cover : null;
  if (!cover) return null;
  return (
    httpUrl(stringField(cover, "md")) ??
    httpUrl(stringField(cover, "default")) ??
    httpUrl(stringField(cover, "thumbnail")) ??
    httpUrl(stringField(cover, "url")) ??
    httpUrl(stringField(cover, "orig"))
  );
}

function coverAssetFromRawCover(input: {
  id: string;
  label: string;
  rawCover: unknown;
}): ContentArchiveCoverAsset | null {
  if (!isObject(input.rawCover)) return null;
  const url =
    httpUrl(stringField(input.rawCover, "orig")) ??
    httpUrl(stringField(input.rawCover, "md")) ??
    httpUrl(stringField(input.rawCover, "default")) ??
    httpUrl(stringField(input.rawCover, "url")) ??
    httpUrl(stringField(input.rawCover, "thumbnail"));
  if (!url) return null;
  return {
    id: input.id,
    label: input.label,
    url,
    fileName:
      stringField(input.rawCover, "filename") ??
      stringField(input.rawCover, "default") ??
      null,
  };
}

function dedupeCoverAssets(assets: ContentArchiveCoverAsset[]): ContentArchiveCoverAsset[] {
  const seen = new Set<string>();
  const deduped: ContentArchiveCoverAsset[] = [];
  for (const asset of assets) {
    const key = asset.url;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(asset);
  }
  return deduped;
}

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function selectDefaultImageServerOption(
  options: LibSocialArchiveImageServerOption[],
  selectedId: string | null | undefined,
): LibSocialArchiveImageServerOption {
  if (selectedId) {
    const selected = options.find((server) => server.id === selectedId);
    if (selected) return selected;
  }
  return (
    options.find((server) => server.id === "main") ??
    options.find((server) => server.id === "secondary") ??
    options.find((server) => server.id === "compress") ??
    options.find((server) => server.id === "download") ??
    options[0]!
  );
}

function imageServerLabel(id: string): string {
  switch (id) {
    case "main":
      return "Server 1";
    case "secondary":
      return "Server 2";
    case "compress":
      return "Compressed";
    case "download":
      return "Download";
    default:
      return id;
  }
}

function libSocialArchiveHomepageForInput(
  source: LibSocialContentArchiveSourceKey,
  parsedUrl: string | null,
  env: NodeJS.ProcessEnv,
): string {
  if (parsedUrl) {
    try {
      return new URL(parsedUrl).origin;
    } catch {
      // Fall through to configured/default homepage.
    }
  }
  const config = LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_CONFIG[source];
  return trimTrailingSlash(env[config.homepageEnv] ?? config.defaultHomepage);
}

function serverMatchesSource(
  server: JsonObject,
  source: LibSocialContentArchiveSourceKey,
): boolean {
  const siteIds = server.site_ids;
  const { siteId } = LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_CONFIG[source];
  return Array.isArray(siteIds) && siteIds.some((id) => Number(id) === siteId);
}

function sourceImageBaseEnv(source: LibSocialContentArchiveSourceKey): string {
  return LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_CONFIG[source].apiBaseEnv.replace(
    "_API_BASE",
    "_IMAGE_BASE",
  );
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function stringField(obj: JsonObject, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(obj: JsonObject, key: string): number | null {
  const value = obj[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, response: Response | null): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const parsed = Number(retryAfter);
    if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
  }
  return Math.min(1500 * 2 ** attempt, 8000);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    error.message.includes("fetch failed") ||
    error.message.includes("ECONNRESET") ||
    error.message.includes("ETIMEDOUT")
  );
}
