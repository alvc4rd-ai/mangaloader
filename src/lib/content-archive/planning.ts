export type ContentArchiveSourceKey =
  | "mangalib"
  | "nhentai"
  | "slashlib"
  | "hentailib";

export type SupportedContentArchiveSourceKey =
  | "mangalib"
  | "nhentai"
  | "slashlib"
  | "hentailib";
export type LibSocialContentArchiveSourceKey = Exclude<
  SupportedContentArchiveSourceKey,
  "nhentai"
>;

export const SUPPORTED_CONTENT_ARCHIVE_SOURCES = [
  "mangalib",
  "nhentai",
  "slashlib",
  "hentailib",
] as const;
export const PENDING_CONTENT_ARCHIVE_SOURCES = [] as const;

export type ParsedContentArchiveSourceInput = {
  source: SupportedContentArchiveSourceKey;
  rawInput: string;
  externalId: string;
  kind: "slug" | "numeric_id";
  url: string | null;
};

export type ContentArchiveChapterRange = {
  raw: string | null;
  segments: Array<{ start: number; end: number }>;
};

export type ContentArchivePathPlan = {
  safeTitleSegment: string;
  relativeTitleDir: string;
  relativeManifestPath: string;
  remoteLibraryDir: "Manga" | "Hentai";
  remoteDir: string | null;
};

export type ContentArchiveRunMode = "dry_run" | "archive_upload";

export type ContentArchiveCoverAsset = {
  id: string;
  label: string;
  url: string;
  fileName?: string | null;
};

const LIBSOCIAL_NUMERIC_SLUG_RE = /^(\d+)--[a-z0-9][a-z0-9-]*$/i;
const CONTENT_ARCHIVE_SOURCE_HOSTS: Record<
  SupportedContentArchiveSourceKey,
  Set<string>
> = {
  mangalib: new Set(["mangalib.me", "mangalib.org"]),
  nhentai: new Set(["nhentai.net"]),
  slashlib: new Set(["slashlib.me", "v2.shlib.life", "shlib.life"]),
  hentailib: new Set(["hentailib.me"]),
};

export function resolveContentArchiveDriveRemote(
  input: Record<string, string | null | undefined>,
): string | null {
  const contentRemote = input.ATLAS_CONTENT_ARCHIVE_DRIVE_REMOTE?.trim();
  if (contentRemote) return contentRemote;

  const backupRemote = input.ATLAS_BACKUP_DRIVE_REMOTE?.trim();
  if (!backupRemote) return null;
  return backupRemote.replace(/(^|\/)Project Backups$/i, "$1Content Backups");
}

export function normalizeContentArchiveSourceKey(
  value: string | null | undefined,
): SupportedContentArchiveSourceKey | null {
  const key = value?.trim().toLowerCase();
  return SUPPORTED_CONTENT_ARCHIVE_SOURCES.find((source) => source === key) ?? null;
}

export function isPendingContentArchiveSource(
  value: string | null | undefined,
): value is (typeof PENDING_CONTENT_ARCHIVE_SOURCES)[number] {
  const key = value?.trim().toLowerCase();
  return PENDING_CONTENT_ARCHIVE_SOURCES.some((source) => source === key);
}

export function parseContentArchiveRunMode(
  value: string | null | undefined,
): ContentArchiveRunMode {
  return value === "archive_upload" ? "archive_upload" : "dry_run";
}

export function parseMangaLibArchiveInput(
  rawInput: string | null | undefined,
): ParsedContentArchiveSourceInput | null {
  return parseContentArchiveSourceInput("mangalib", rawInput);
}

export function parseHentaiLibArchiveInput(
  rawInput: string | null | undefined,
): ParsedContentArchiveSourceInput | null {
  return parseContentArchiveSourceInput("hentailib", rawInput);
}

export function parseNHentaiArchiveInput(
  rawInput: string | null | undefined,
): ParsedContentArchiveSourceInput | null {
  return parseContentArchiveSourceInput("nhentai", rawInput);
}

export function parseSlashLibArchiveInput(
  rawInput: string | null | undefined,
): ParsedContentArchiveSourceInput | null {
  return parseContentArchiveSourceInput("slashlib", rawInput);
}

export function parseContentArchiveUrlInput(
  rawInput: string | null | undefined,
): ParsedContentArchiveSourceInput | null {
  if (typeof rawInput !== "string") return null;
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  for (const source of SUPPORTED_CONTENT_ARCHIVE_SOURCES) {
    const parsed = parseContentArchiveSourceUrl(source, trimmed);
    if (parsed) return parsed;
  }
  return null;
}

export function parseContentArchiveSourceInput(
  source: SupportedContentArchiveSourceKey,
  rawInput: string | null | undefined,
): ParsedContentArchiveSourceInput | null {
  if (typeof rawInput !== "string") return null;
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const urlResult = parseContentArchiveSourceUrl(source, trimmed);
  if (urlResult) return urlResult;

  const bare = trimmed.replace(/^\/+|\/+$/g, "");
  if (source === "nhentai") {
    const idMatch = /^(?:#|code:|g:)?([1-9]\d{4,8})$/i.exec(bare);
    if (!idMatch) return null;
    return {
      source,
      rawInput: trimmed,
      externalId: idMatch[1]!,
      kind: "numeric_id",
      url: null,
    };
  }
  if (LIBSOCIAL_NUMERIC_SLUG_RE.test(bare)) {
    return {
      source,
      rawInput: trimmed,
      externalId: bare,
      kind: "slug",
      url: null,
    };
  }
  if (/^[1-9]\d*$/.test(bare)) {
    return {
      source,
      rawInput: trimmed,
      externalId: bare,
      kind: "numeric_id",
      url: null,
    };
  }
  return null;
}

export function parseContentArchiveChapterRange(
  value: string | null | undefined,
): ContentArchiveChapterRange | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") {
    return { raw: null, segments: [] };
  }

  const segments: Array<{ start: number; end: number }> = [];
  for (const part of trimmed.split(",")) {
    const token = part.trim();
    if (!token) return null;
    const match = /^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/.exec(token);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      return null;
    }
    segments.push({ start, end });
  }
  return { raw: trimmed, segments };
}

export function contentArchiveRangeIncludes(
  range: ContentArchiveChapterRange,
  value: string | number | null | undefined,
): boolean {
  if (range.segments.length === 0) return true;
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(numeric)) return false;
  return range.segments.some(
    (segment) => numeric >= segment.start && numeric <= segment.end,
  );
}

export function safeContentArchiveSegment(
  value: string | null | undefined,
  fallback = "untitled",
): string {
  const cleaned = value
    ?.normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const slug = cleaned
    ?.replace(/\s/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120);
  return slug || fallback;
}

export function planContentArchivePaths(input: {
  source: SupportedContentArchiveSourceKey;
  title: string;
  externalId: string;
  driveRemote?: string | null;
}): ContentArchivePathPlan {
  const titleBase = safeContentArchiveSegment(input.title, input.externalId);
  const safeTitleSegment = titleBase.slice(0, 180);
  const sourceDir = sourceLabel(input.source);
  const remoteLibraryDir = sourceLibraryLabel(input.source);
  const relativeTitleDir = `content/${sourceDir}/${safeTitleSegment}`;
  const remoteRoot = input.driveRemote?.trim().replace(/\/+$/, "");
  return {
    safeTitleSegment,
    relativeTitleDir,
    relativeManifestPath: `${relativeTitleDir}/manifest.json`,
    remoteLibraryDir,
    remoteDir: remoteRoot
      ? `${remoteRoot}/${remoteLibraryDir}/${sourceDir}/${safeTitleSegment}`
      : null,
  };
}

export function sourceLabel(source: SupportedContentArchiveSourceKey): string {
  switch (source) {
    case "mangalib":
      return "MangaLib";
    case "nhentai":
      return "nHentai";
    case "slashlib":
      return "SlashLib";
    case "hentailib":
      return "HentaiLib";
  }
}

export function sourceLibraryLabel(
  source: SupportedContentArchiveSourceKey,
): "Manga" | "Hentai" {
  switch (source) {
    case "mangalib":
      return "Manga";
    case "nhentai":
      return "Hentai";
    case "slashlib":
      return "Hentai";
    case "hentailib":
      return "Hentai";
  }
}

function parseContentArchiveSourceUrl(
  source: SupportedContentArchiveSourceKey,
  raw: string,
): ParsedContentArchiveSourceInput | null {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!CONTENT_ARCHIVE_SOURCE_HOSTS[source].has(host)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (source === "nhentai") {
    const galleryIndex = parts.findIndex((part) => part.toLowerCase() === "g");
    const candidate =
      galleryIndex >= 0
        ? parts[galleryIndex + 1]
        : parts.find((part) => /^[1-9]\d{4,8}$/.test(part));
    if (!candidate || !/^[1-9]\d{4,8}$/.test(candidate)) return null;
    return {
      source,
      rawInput: raw,
      externalId: candidate,
      kind: "numeric_id",
      url: url.toString(),
    };
  }
  const mangaIndex = parts.findIndex((part) => part.toLowerCase() === "manga");
  const candidate =
    mangaIndex >= 0
      ? parts[mangaIndex + 1]
      : parts.find((part) => LIBSOCIAL_NUMERIC_SLUG_RE.test(part));
  if (!candidate) return null;
  const externalId = decodeURIComponent(candidate);
  if (!LIBSOCIAL_NUMERIC_SLUG_RE.test(externalId) && !/^[1-9]\d*$/.test(externalId)) {
    return null;
  }
  return {
    source,
    rawInput: raw,
    externalId,
    kind: LIBSOCIAL_NUMERIC_SLUG_RE.test(externalId) ? "slug" : "numeric_id",
    url: url.toString(),
  };
}
