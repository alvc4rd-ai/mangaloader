import {
  type ContentArchiveCoverAsset,
  type LibSocialContentArchiveSourceKey,
  parseContentArchiveSourceInput,
  parseContentArchiveUrlInput,
  sourceLabel,
  type SupportedContentArchiveSourceKey,
} from "./planning";
import {
  loadLibSocialTitleChapters,
  type LibSocialArchiveImageServerOption,
  type LibSocialContentArchiveChapterRow,
  type LibSocialContentArchiveTitleChapterPlan,
} from "./mangalib-reader";
import {
  loadNHentaiTitleChapters,
  type NHentaiArchivePage,
  type NHentaiContentArchiveTitleChapterPlan,
} from "./nhentai-reader";

export type ContentArchiveSourceDownloadPlan =
  | {
      kind: "libsocial";
      apiBase: string;
      homepage: string;
    }
  | {
      kind: "nhentai";
      homepage: string;
      imageBase: string;
      pages: NHentaiArchivePage[];
      thumbBase: string;
    };

export type ContentArchiveSourcePlan =
  | {
      ok: true;
      source: SupportedContentArchiveSourceKey;
      sourceInput: string;
      title: string;
      slug: string;
      coverUrl: string | null;
      coverAssets: ContentArchiveCoverAsset[];
      chapters: LibSocialContentArchiveChapterRow[];
      defaultImageServerId: string | null;
      imageServers: LibSocialArchiveImageServerOption[];
      sizeEstimate: {
        estimatedBytes: number | null;
        estimateKind: "sampled" | "average" | "unknown";
        sampledChapters: number;
      };
      downloadPlan: ContentArchiveSourceDownloadPlan;
    }
  | {
      ok: false;
      source: SupportedContentArchiveSourceKey | null;
      sourceInput: string;
      message: string;
    };

type ContentArchiveSourceAdapter = {
  source: SupportedContentArchiveSourceKey;
  load(input: ContentArchiveSourceAcquisitionInput & {
    source: SupportedContentArchiveSourceKey;
    sourceInput: string;
  }): Promise<ContentArchiveSourcePlan>;
};

export type ContentArchiveSourceAcquisitionInput = {
  source?: SupportedContentArchiveSourceKey | null;
  sourceInput: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  authorization?: string | null;
  apiToken?: string | null;
  estimateSizes?: boolean;
  imageServerId?: string | null;
  imageCookie?: string | null;
};

const LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_ADAPTER: ContentArchiveSourceAdapter = {
  source: "mangalib",
  async load(input) {
    const plan = await loadLibSocialTitleChapters({
      source: input.source as LibSocialContentArchiveSourceKey,
      sourceInput: input.sourceInput,
      env: input.env,
      fetchImpl: input.fetchImpl,
      authorization: input.authorization ?? null,
      estimateSizes: input.estimateSizes,
      imageServerId: input.imageServerId ?? null,
      imageCookie: input.imageCookie ?? null,
    });
    return readyLibSocialSourcePlan(plan, input.sourceInput);
  },
};

const NHENTAI_CONTENT_ARCHIVE_SOURCE_ADAPTER: ContentArchiveSourceAdapter = {
  source: "nhentai",
  async load(input) {
    const plan = await loadNHentaiTitleChapters({
      sourceInput: input.sourceInput,
      env: input.env,
      fetchImpl: input.fetchImpl,
      apiToken: input.apiToken ?? null,
      estimateSizes: input.estimateSizes,
      imageServerId: input.imageServerId ?? null,
    });
    return readyNHentaiSourcePlan(plan, input.sourceInput);
  },
};

const CONTENT_ARCHIVE_SOURCE_ADAPTERS: Record<
  SupportedContentArchiveSourceKey,
  ContentArchiveSourceAdapter
> = {
  mangalib: LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_ADAPTER,
  slashlib: LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_ADAPTER,
  hentailib: LIBSOCIAL_CONTENT_ARCHIVE_SOURCE_ADAPTER,
  nhentai: NHENTAI_CONTENT_ARCHIVE_SOURCE_ADAPTER,
};

export async function acquireContentArchiveSourcePlan(
  input: ContentArchiveSourceAcquisitionInput,
): Promise<ContentArchiveSourcePlan> {
  const sourceInput = input.sourceInput.trim();
  const source = resolveContentArchiveSource(input.source, sourceInput);
  if (!source) {
    return {
      ok: false,
      source: null,
      sourceInput,
      message: "Paste a MangaLib, SlashLib, HentaiLib, or nHentai title URL.",
    };
  }
  if (!sourceInput) {
    return {
      ok: false,
      source,
      sourceInput,
      message: emptySourceInputMessage(source),
    };
  }
  const parsed = parseContentArchiveSourceInput(source, sourceInput);
  if (!parsed || parsed.source !== source) {
    return {
      ok: false,
      source,
      sourceInput,
      message: invalidSourceInputMessage(source),
    };
  }
  return CONTENT_ARCHIVE_SOURCE_ADAPTERS[source].load({
    ...input,
    source,
    sourceInput,
  });
}

function resolveContentArchiveSource(
  source: SupportedContentArchiveSourceKey | null | undefined,
  sourceInput: string,
): SupportedContentArchiveSourceKey | null {
  if (source) return source;
  return parseContentArchiveUrlInput(sourceInput)?.source ?? null;
}

function emptySourceInputMessage(source: SupportedContentArchiveSourceKey): string {
  return source === "nhentai"
    ? "Paste a nHentai gallery link or code."
    : `Paste a ${sourceLabel(source)} title link, slug, or id.`;
}

function invalidSourceInputMessage(source: SupportedContentArchiveSourceKey): string {
  return source === "nhentai"
    ? "Paste a valid nHentai gallery link or code."
    : `Paste a valid ${sourceLabel(source)} title link, slug, or id.`;
}

function readyLibSocialSourcePlan(
  plan: LibSocialContentArchiveTitleChapterPlan,
  sourceInput: string,
): ContentArchiveSourcePlan {
  return {
    ok: true,
    source: plan.source,
    sourceInput,
    title: plan.title,
    slug: plan.slug,
    coverUrl: plan.coverUrl,
    coverAssets: plan.coverAssets,
    chapters: plan.chapters,
    defaultImageServerId: plan.defaultImageServerId,
    imageServers: plan.imageServers,
    sizeEstimate: plan.sizeEstimate,
    downloadPlan: {
      kind: "libsocial",
      apiBase: plan.apiBase,
      homepage: plan.homepage,
    },
  };
}

function readyNHentaiSourcePlan(
  plan: NHentaiContentArchiveTitleChapterPlan,
  sourceInput: string,
): ContentArchiveSourcePlan {
  return {
    ok: true,
    source: "nhentai",
    sourceInput,
    title: plan.title,
    slug: plan.slug,
    coverUrl: plan.coverUrl,
    coverAssets: plan.coverAssets,
    chapters: plan.chapters,
    defaultImageServerId: plan.defaultImageServerId,
    imageServers: plan.imageServers,
    sizeEstimate: plan.sizeEstimate,
    downloadPlan: {
      kind: "nhentai",
      homepage: plan.homepage,
      imageBase: plan.imageBase,
      pages: plan.pages,
      thumbBase: plan.thumbBase,
    },
  };
}
