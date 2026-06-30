"use client";

import { useMemo, useState } from "react";

import { FAINT, MUT, TX } from "@/components/design/kit";
import {
  sourceLabel,
  type SupportedContentArchiveSourceKey,
} from "@/lib/content-archive/planning";
import type { LibSocialArchiveImageServerOption } from "@/lib/content-archive/mangalib-reader";
import {
  ContentArchiveChapterSelector,
  type ContentArchiveChapter,
} from "./content-archive-chapter-selector";
import { ContentArchiveServerSelector } from "./content-archive-server-selector";
import { ContentArchiveSpeedSelector } from "./content-archive-speed-selector";

type TitleSizeEstimate = {
  estimatedBytes: number | null;
  estimateKind: "sampled" | "average" | "unknown";
  sampledChapters: number;
};

export function ContentArchiveQueueControls({
  analyzeFormId,
  chapters,
  coverUrl,
  defaultImageServerId,
  distinctChapterCount,
  imageServers,
  optionCount,
  source,
  title,
  titleSizeEstimate,
}: {
  analyzeFormId: string;
  chapters: ContentArchiveChapter[];
  coverUrl: string | null;
  defaultImageServerId: string | null;
  distinctChapterCount: number;
  imageServers: LibSocialArchiveImageServerOption[];
  optionCount: number;
  source: SupportedContentArchiveSourceKey;
  title: string;
  titleSizeEstimate: TitleSizeEstimate;
}) {
  const chapterKeys = useMemo(
    () => chapters.map((chapter) => chapter.selectionKey),
    [chapters],
  );
  const [selectedKeys, setSelectedKeys] = useState(() => new Set(chapterKeys));
  const selectedChapterKeys = useMemo(() => Array.from(selectedKeys), [selectedKeys]);
  const unitLabel = source === "nhentai" ? "gallery" : "chapters";

  return (
    <>
      <div className="flex min-w-0 gap-3">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="h-[72px] w-[52px] shrink-0 rounded-[6px] object-cover atlas-media-outline"
          />
        ) : null}
        <div className="grid min-w-0 flex-1 content-start gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <h3 className="m-0 truncate text-sm font-semibold" style={{ color: TX }}>
                {title}
              </h3>
              <span className="shrink-0 text-xs" style={{ color: MUT }}>
                {distinctChapterCount} {unitLabel}
                {optionCount > distinctChapterCount ? ` · ${optionCount} translations` : ""}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-2 text-[11px]" style={{ color: FAINT }}>
              <span>{sourceLabel(source)}</span>
              <span>Title size: {formatTitleSizeEstimate(titleSizeEstimate)}</span>
            </div>
          </div>
          {imageServers.length > 0 ? (
            <label className="grid gap-1 text-[11px]" style={{ color: MUT }}>
              Image server
              <ContentArchiveServerSelector
                analyzeFormId={analyzeFormId}
                defaultImageServerId={defaultImageServerId}
                selectedChapterKeys={selectedChapterKeys}
                servers={imageServers}
              />
            </label>
          ) : null}
          {source !== "nhentai" ? (
            <label className="grid gap-1 text-[11px]" style={{ color: MUT }}>
              Download speed
              <ContentArchiveSpeedSelector source={source} />
            </label>
          ) : null}
        </div>
      </div>

      <ContentArchiveChapterSelector
        chapters={chapters}
        onSelectedKeysChange={setSelectedKeys}
        selectedKeys={selectedKeys}
        titleSizeEstimate={titleSizeEstimate}
      />
    </>
  );
}

function formatCompactBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatTitleSizeEstimate(estimate: TitleSizeEstimate): string {
  if (!estimate.estimatedBytes) return "unavailable";
  const suffix =
    estimate.estimateKind === "average"
      ? ` avg from ${estimate.sampledChapters}`
      : estimate.estimateKind === "sampled"
        ? " sampled"
        : "";
  return `≈ ${formatCompactBytes(estimate.estimatedBytes)}${suffix}`;
}
