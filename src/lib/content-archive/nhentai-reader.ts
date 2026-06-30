import {
  type ContentArchiveCoverAsset,
  parseContentArchiveSourceInput,
} from "./planning";
import type {
  LibSocialArchiveChapterSizeEstimate,
  LibSocialArchiveImageServerOption,
  LibSocialContentArchiveChapterRow,
} from "./mangalib-reader";
import { fetchContentArchiveImageByteLength } from "./reachability";

const NHENTAI_API_BASE = "https://nhentai.net/api/v2";
const NHENTAI_HOMEPAGE = "https://nhentai.net";
const NHENTAI_IMAGE_BASE = "https://i1.nhentai.net";
const NHENTAI_THUMB_BASE = "https://t1.nhentai.net";
const REQUEST_TIMEOUT_MS = 12_000;
const SIZE_ESTIMATE_IMAGE_TIMEOUT_MS = 2_000;
const REQUEST_RETRIES = 1;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

type JsonObject = Record<string, unknown>;

export type NHentaiArchivePage = {
  number: number;
  path: string;
  width: number | null;
  height: number | null;
  thumbnailPath: string | null;
};

export type NHentaiContentArchiveTitleChapterPlan = {
  source: "nhentai";
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
  pages: NHentaiArchivePage[];
  imageBase: string;
  thumbBase: string;
};

export async function loadNHentaiTitleChapters(input: {
  sourceInput: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  apiToken?: string | null;
  estimateSizes?: boolean;
  imageServerId?: string | null;
}): Promise<NHentaiContentArchiveTitleChapterPlan> {
  const parsed = parseContentArchiveSourceInput("nhentai", input.sourceInput);
  if (!parsed) {
    throw new Error("Paste a valid nHentai gallery link or code.");
  }

  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBase = trimTrailingSlash(
    env.ATLAS_CONTENT_ARCHIVE_NHENTAI_API_BASE?.trim() ||
      env.NHENTAI_API_URL?.trim() ||
      NHENTAI_API_BASE,
  );
  const apiToken =
    input.apiToken?.trim() ||
    env.ATLAS_CONTENT_ARCHIVE_NHENTAI_API_TOKEN?.trim() ||
    env.NHENTAI_API_TOKEN?.trim() ||
    null;
  const gallery = await fetchNHentaiGallery({
    apiBase,
    galleryId: parsed.externalId,
    fetchImpl,
    apiToken,
  });
  const title = nhentaiTitle(gallery) ?? `nHentai ${parsed.externalId}`;
  const pages = normalizeNHentaiPages(gallery.pages);
  if (pages.length === 0) {
    throw new Error("nHentai gallery returned no usable pages.");
  }

  let imageServers = await fetchNHentaiImageServers({
    apiBase,
    env,
    fetchImpl,
    apiToken,
    selectedImageServerId: input.imageServerId ?? null,
  });
  let selectedImageServer =
    imageServers.find((server) => server.isDefault) ?? imageServers[0] ?? null;
  const thumbBase = selectedNHentaiThumbBase(env, imageServers);
  const sizeEstimates = input.estimateSizes
    ? await estimateNHentaiArchiveSizesForServers({
        galleryId: parsed.externalId,
        pages,
        imageServers,
        fetchImpl,
      })
    : new Map<string, NHentaiArchiveSizeEstimateForServer>();

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
  const titleEstimate = selectedSizeEstimate?.titleEstimate ?? {
    estimatedBytes: null,
    estimateKind: "unknown" as const,
    sampledChapters: 0,
  };
  const galleryRow = nhentaiGalleryChapterRow({
    galleryId: Number(parsed.externalId),
    pages,
    sizeEstimate: selectedSizeEstimate?.chapters[0]?.sizeEstimate ?? null,
  });
  return {
    source: "nhentai",
    sourceInput: input.sourceInput,
    title,
    slug: parsed.externalId,
    apiBase,
    homepage: NHENTAI_HOMEPAGE,
    chapters: selectedSizeEstimate?.chapters ?? [galleryRow],
    coverUrl: nhentaiAssetUrl(thumbBase, objectField(gallery.cover, "path")),
    coverAssets: nhentaiCoverAssets({
      gallery,
      thumbBase,
    }),
    defaultImageServerId: selectedImageServer?.id ?? null,
    imageServers,
    sizeEstimate: titleEstimate,
    pages,
    imageBase: selectedImageServer?.url ?? NHENTAI_IMAGE_BASE,
    thumbBase,
  };
}

export function nhentaiImageUrlForPage(
  page: NHentaiArchivePage,
  imageBase: string,
): string {
  return `${trimTrailingSlash(imageBase)}/${page.path.replace(/^\/+/, "")}`;
}

export function nhentaiGalleryReferer(galleryId: string | number): string {
  return `${NHENTAI_HOMEPAGE}/g/${galleryId}/`;
}

type NHentaiGallery = {
  id: number;
  mediaId: string | null;
  title: unknown;
  cover: unknown;
  thumbnail: unknown;
  pages: unknown;
  numPages: number | null;
};

async function fetchNHentaiGallery(input: {
  apiBase: string;
  galleryId: string;
  fetchImpl: typeof fetch;
  apiToken: string | null;
}): Promise<NHentaiGallery> {
  const payload = await requestJson({
    ...input,
    path: `/galleries/${encodeURIComponent(input.galleryId)}`,
  });
  const id = numberField(payload, "id");
  if (!id) throw new Error("nHentai gallery payload is missing an id.");
  return {
    id,
    mediaId: stringField(payload, "media_id"),
    title: payload.title,
    cover: payload.cover,
    thumbnail: payload.thumbnail,
    pages: payload.pages,
    numPages: numberField(payload, "num_pages"),
  };
}

async function fetchNHentaiImageServers(input: {
  apiBase: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  apiToken: string | null;
  selectedImageServerId?: string | null;
}): Promise<LibSocialArchiveImageServerOption[]> {
  const override = input.env.ATLAS_CONTENT_ARCHIVE_NHENTAI_IMAGE_BASE?.trim();
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

  let imageServerUrls: string[] = [];
  try {
    const payload = await requestJson({
      apiBase: input.apiBase,
      fetchImpl: input.fetchImpl,
      apiToken: input.apiToken,
      path: "/cdn",
    });
    imageServerUrls = Array.isArray(payload.image_servers)
      ? payload.image_servers
          .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url))
          .map(trimTrailingSlash)
      : [];
  } catch {
    imageServerUrls = [];
  }

  if (imageServerUrls.length === 0) imageServerUrls = [NHENTAI_IMAGE_BASE];
  const seen = new Set<string>();
  const servers = imageServerUrls
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((url, index) => ({
      id: `server-${index + 1}`,
      label: index === 0 ? "Source server 1" : `Source server ${index + 1}`,
      url,
      isDefault: false,
    }));
  const selected =
    servers.find((server) => server.id === input.selectedImageServerId) ??
    servers[0]!;
  return servers.map((server) => ({
    ...server,
    isDefault: server === selected,
  }));
}

function selectedNHentaiThumbBase(
  env: NodeJS.ProcessEnv,
  imageServers: LibSocialArchiveImageServerOption[],
): string {
  const override = env.ATLAS_CONTENT_ARCHIVE_NHENTAI_THUMB_BASE?.trim();
  if (override) return trimTrailingSlash(override);
  const firstHost = imageServers[0]?.url ? new URL(imageServers[0].url).host : "";
  const match = /^i(\d+)\.nhentai\.net$/i.exec(firstHost);
  return match ? `https://t${match[1]}.nhentai.net` : NHENTAI_THUMB_BASE;
}

type NHentaiArchiveSizeEstimateForServer = {
  chapters: LibSocialContentArchiveChapterRow[];
  titleEstimate: {
    estimatedBytes: number | null;
    estimateKind: "sampled" | "average" | "unknown";
    sampledChapters: number;
  };
};

async function estimateNHentaiArchiveSizesForServers(input: {
  galleryId: string;
  pages: NHentaiArchivePage[];
  imageServers: LibSocialArchiveImageServerOption[];
  fetchImpl: typeof fetch;
}): Promise<Map<string, NHentaiArchiveSizeEstimateForServer>> {
  const results = await Promise.all(
    input.imageServers.map(async (imageServer) => {
      let bytes = 0;
      let knownPages = 0;
      for (const page of input.pages) {
        const pageBytes = await fetchContentArchiveImageByteLength({
          fetchImpl: input.fetchImpl,
          referer: nhentaiGalleryReferer(input.galleryId),
          url: nhentaiImageUrlForPage(page, imageServer.url),
          timeoutMs: SIZE_ESTIMATE_IMAGE_TIMEOUT_MS,
          bodyFallback: false,
        });
        if (pageBytes) {
          bytes += pageBytes;
          knownPages += 1;
        }
      }
      const estimatedBytes = knownPages === input.pages.length && bytes > 0 ? bytes : null;
      const row = nhentaiGalleryChapterRow({
        galleryId: Number(input.galleryId),
        pages: input.pages,
        sizeEstimate: {
          estimatedBytes,
          estimateKind: estimatedBytes ? "sampled" : "unknown",
          pageCount: input.pages.length,
          sampledBytes: estimatedBytes,
        },
      });
      const result: [string, NHentaiArchiveSizeEstimateForServer] = [
        imageServer.id,
        {
          chapters: [row],
          titleEstimate: {
            estimatedBytes,
            estimateKind: estimatedBytes ? "sampled" : "unknown",
            sampledChapters: estimatedBytes ? 1 : 0,
          },
        },
      ];
      return result;
    }),
  );
  return new Map(results);
}

function chapterSizeEstimateMap(
  chapters: LibSocialContentArchiveChapterRow[] | null,
): Record<string, LibSocialArchiveChapterSizeEstimate> | null {
  if (!chapters) return null;
  return Object.fromEntries(
    chapters.map((chapter) => [
      chapter.selectionKey,
      chapter.sizeEstimate ?? {
        estimatedBytes: null,
        estimateKind: "unknown" as const,
        pageCount: null,
        sampledBytes: null,
      },
    ]),
  );
}

function nhentaiGalleryChapterRow(input: {
  galleryId: number;
  pages: NHentaiArchivePage[];
  sizeEstimate: LibSocialArchiveChapterSizeEstimate | null;
}): LibSocialContentArchiveChapterRow {
  return {
    id: input.galleryId,
    index: 1,
    volume: "1",
    number: "1",
    displayLabel: `Gallery · ${input.pages.length} pages`,
    name: null,
    branchId: null,
    branchName: null,
    selectionKey: String(input.galleryId),
    sizeEstimate: input.sizeEstimate,
  };
}

function normalizeNHentaiPages(value: unknown): NHentaiArchivePage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row, index) => {
      if (!isObject(row)) return null;
      const path = stringField(row, "path");
      if (!path) return null;
      const number = numberField(row, "number") ?? index + 1;
      return {
        number,
        path,
        width: numberField(row, "width"),
        height: numberField(row, "height"),
        thumbnailPath: stringField(row, "thumbnail"),
      };
    })
    .filter((page): page is NHentaiArchivePage => Boolean(page));
}

function nhentaiTitle(gallery: NHentaiGallery): string | null {
  if (isObject(gallery.title)) {
    return (
      stringField(gallery.title, "english") ??
      stringField(gallery.title, "pretty") ??
      stringField(gallery.title, "japanese")
    );
  }
  return null;
}

function nhentaiCoverAssets(input: {
  gallery: NHentaiGallery;
  thumbBase: string;
}): ContentArchiveCoverAsset[] {
  const assets: ContentArchiveCoverAsset[] = [];
  const coverUrl = nhentaiAssetUrl(input.thumbBase, objectField(input.gallery.cover, "path"));
  if (coverUrl) {
    assets.push({
      id: "cover",
      label: "Cover",
      url: coverUrl,
      fileName: objectField(input.gallery.cover, "path"),
    });
  }
  const thumbnailUrl = nhentaiAssetUrl(
    input.thumbBase,
    objectField(input.gallery.thumbnail, "path"),
  );
  if (thumbnailUrl && thumbnailUrl !== coverUrl) {
    assets.push({
      id: "thumbnail",
      label: "Thumbnail",
      url: thumbnailUrl,
      fileName: objectField(input.gallery.thumbnail, "path"),
    });
  }
  return assets;
}

function nhentaiAssetUrl(base: string, path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${trimTrailingSlash(base)}/${path.replace(/^\/+/, "")}`;
}

async function requestJson(input: {
  apiBase: string;
  path: string;
  fetchImpl: typeof fetch;
  apiToken: string | null;
}): Promise<JsonObject> {
  const url = `${input.apiBase}${input.path.startsWith("/") ? input.path : `/${input.path}`}`;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await input.fetchImpl(url, {
        headers: requestHeaders(input.apiToken),
        signal: controller.signal,
      });
      const text = await response.text();
      clearTimeout(timeout);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Expected JSON from nHentai, got ${response.status}: ${text.slice(0, 180)}`);
      }
      if (!response.ok) {
        if (RETRYABLE_STATUSES.has(response.status) && attempt < REQUEST_RETRIES) {
          await sleep(retryDelayMs(attempt, response));
          continue;
        }
        throw new Error(`nHentai returned ${response.status}: ${JSON.stringify(parsed).slice(0, 240)}`);
      }
      if (!isObject(parsed)) throw new Error("nHentai returned a non-object payload.");
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
  throw new Error("nHentai request exhausted retries.");
}

function requestHeaders(apiToken: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari AtlasContentArchive/1.0",
  };
  if (apiToken) headers.Authorization = `Key ${apiToken}`;
  return headers;
}

function retryDelayMs(attempt: number, response: Response | null): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(30_000, Math.round(seconds * 1_000));
    }
  }
  return Math.min(30_000, 800 * 2 ** attempt);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  return error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function objectField(value: unknown, key: string): string | null {
  return isObject(value) ? stringField(value, key) : null;
}

function stringField(value: JsonObject, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function numberField(value: JsonObject, key: string): number | null {
  const field = value[key];
  const number = typeof field === "number" ? field : typeof field === "string" ? Number(field) : NaN;
  return Number.isFinite(number) ? number : null;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
