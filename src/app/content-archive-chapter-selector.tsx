"use client";

import { useEffect, useMemo, useRef } from "react";

import { FAINT, HAIR, LINE, MONO, TX } from "@/components/design/kit";

export type ContentArchiveChapter = {
  id: number;
  index: number;
  volume: string;
  number: string;
  displayLabel?: string | null;
  name: string | null;
  branchId: number | null;
  branchName: string | null;
  selectionKey: string;
  sizeEstimate?: {
    estimatedBytes: number | null;
    estimateKind: "sampled" | "average" | "unknown";
    pageCount: number | null;
    sampledBytes: number | null;
  } | null;
};

export function ContentArchiveChapterSelector({
  chapters,
  onSelectedKeysChange,
  selectedKeys,
  titleSizeEstimate,
}: {
  chapters: ContentArchiveChapter[];
  onSelectedKeysChange: (keys: Set<string>) => void;
  selectedKeys: Set<string>;
  titleSizeEstimate: {
    estimatedBytes: number | null;
    estimateKind: "sampled" | "average" | "unknown";
    sampledChapters: number;
  };
}) {
  const chapterKeys = useMemo(() => chapters.map((chapter) => chapter.selectionKey), [chapters]);
  const translationOptions = useMemo(() => buildTranslationOptions(chapters), [chapters]);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const allSelected = chapters.length > 0 && selectedKeys.size === chapters.length;
  const partlySelected = selectedKeys.size > 0 && !allSelected;
  const selectedTranslation = useMemo(
    () => selectedTranslationValue(selectedKeys, translationOptions, chapters.length),
    [chapters.length, selectedKeys, translationOptions],
  );
  const selectedSizeStats = useMemo(
    () => {
      let bytes = 0;
      let knownChapters = 0;
      let selectedChapters = 0;
      for (const chapter of chapters) {
        if (!selectedKeys.has(chapter.selectionKey)) continue;
        selectedChapters += 1;
        const estimatedBytes = chapter.sizeEstimate?.estimatedBytes ?? null;
        if (estimatedBytes) {
          bytes += estimatedBytes;
          knownChapters += 1;
        }
      }
      return { bytes, knownChapters, selectedChapters };
    },
    [chapters, selectedKeys],
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partlySelected;
    }
  }, [partlySelected]);

  function toggleAll() {
    onSelectedKeysChange(allSelected ? new Set() : new Set(chapterKeys));
  }

  function toggleChapter(key: string) {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedKeysChange(next);
  }

  function selectTranslation(value: string) {
    if (value === "all") {
      onSelectedKeysChange(new Set(chapterKeys));
      return;
    }
    const option = translationOptions.find((item) => item.key === value);
    if (option) onSelectedKeysChange(new Set(option.chapterKeys));
  }

  return (
    <div
      className="atlas-radius-panel overflow-hidden border"
      style={{ borderColor: LINE, background: "var(--panel)" }}
    >
      <div
        className="grid gap-1.5 border-b px-2.5 py-1.5 text-xs"
        style={{ borderColor: HAIR, color: TX }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {translationOptions.length > 1 ? (
            <label className="flex min-w-[180px] flex-1 items-center gap-2">
              <span className="shrink-0 text-[11px]" style={{ color: FAINT }}>
                Translation
              </span>
              <select
                value={selectedTranslation}
                onChange={(event) => selectTranslation(event.currentTarget.value)}
                className="atlas-radius-control h-7 min-w-0 flex-1 border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ borderColor: LINE, color: TX }}
              >
                <option value="all">All translations</option>
                {selectedTranslation === "custom" ? <option value="custom">Custom</option> : null}
                {translationOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label} ({option.chapterCount})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex min-w-0 items-center gap-2 font-medium">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
            />
            Select all
          </label>
          <span
            className="atlas-num shrink-0 text-[11px]"
            style={{ color: FAINT, fontFamily: MONO }}
          >
            {selectedKeys.size}/{chapters.length}
          </span>
        </div>
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
          style={{ color: FAINT }}
        >
          <span className="font-medium" style={{ color: TX }}>
            Size estimate
          </span>
          <span>Selected: {formatSelectedSizeEstimate(selectedSizeStats)}</span>
          <span>Title: {formatTitleSizeEstimate(titleSizeEstimate)}</span>
        </div>
      </div>

      <div className="max-h-[240px] overflow-auto">
        {chapters.map((chapter) => (
          <label
            key={chapter.selectionKey}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b px-2.5 py-1.5 text-xs last:border-b-0"
            style={{ borderColor: HAIR, color: TX }}
          >
            <input
              type="checkbox"
              name="chapter_refs"
              value={chapter.selectionKey}
              checked={selectedKeys.has(chapter.selectionKey)}
              onChange={() => toggleChapter(chapter.selectionKey)}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
            />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate font-medium">{chapterLabel(chapter)}</span>
              {chapter.branchName ? (
                <span className="truncate text-[11px]" style={{ color: FAINT }}>
                  {chapter.branchName}
                </span>
              ) : null}
            </span>
            <span className="atlas-num text-[11px]" style={{ color: FAINT, fontFamily: MONO }}>
              {formatChapterSizeEstimate(chapter.sizeEstimate)} ·{" "}
              V{chapter.volume} · #{chapter.index}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function formatCompactBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatSelectedSizeEstimate(stats: {
  bytes: number;
  knownChapters: number;
  selectedChapters: number;
}): string {
  if (stats.selectedChapters === 0) return "none";
  if (stats.bytes <= 0 || stats.knownChapters === 0) return "unavailable";
  const prefix = stats.knownChapters === stats.selectedChapters ? "≈" : "partial ≈";
  return `${prefix} ${formatCompactBytes(stats.bytes)}`;
}

function formatTitleSizeEstimate(estimate: {
  estimatedBytes: number | null;
  estimateKind: "sampled" | "average" | "unknown";
  sampledChapters: number;
}): string {
  if (!estimate.estimatedBytes) return "unavailable";
  if (estimate.estimateKind === "average") {
    return `≈ ${formatCompactBytes(estimate.estimatedBytes)} avg`;
  }
  return `≈ ${formatCompactBytes(estimate.estimatedBytes)}`;
}

function formatChapterSizeEstimate(
  estimate: ContentArchiveChapter["sizeEstimate"],
): string {
  if (!estimate?.estimatedBytes) {
    return estimate?.pageCount ? "unreachable" : "size n/a";
  }
  return `≈ ${formatCompactBytes(estimate.estimatedBytes)}`;
}

function chapterLabel(chapter: ContentArchiveChapter) {
  if (chapter.displayLabel) return chapter.displayLabel;
  const base = `Ch. ${chapter.number}`;
  return chapter.name ? `${base} · ${chapter.name}` : base;
}

type TranslationOption = {
  chapterCount: number;
  chapterKeys: string[];
  key: string;
  label: string;
};

function buildTranslationOptions(chapters: ContentArchiveChapter[]): TranslationOption[] {
  const byChapter = new Map<number, ContentArchiveChapter[]>();
  for (const chapter of chapters) {
    const existing = byChapter.get(chapter.id) ?? [];
    existing.push(chapter);
    byChapter.set(chapter.id, existing);
  }
  const stableChapterKeys: string[] = [];
  const alternateChapters: ContentArchiveChapter[] = [];
  for (const group of byChapter.values()) {
    if (group.length === 1) {
      stableChapterKeys.push(group[0]!.selectionKey);
    } else {
      alternateChapters.push(...group);
    }
  }
  if (alternateChapters.length === 0) return [];

  const byKey = new Map<
    string,
    { chapterIds: Set<number>; chapterKeys: string[]; label: string }
  >();
  for (const chapter of alternateChapters) {
    const key = translationKey(chapter);
    const existing =
      byKey.get(key) ??
      {
        chapterIds: new Set<number>(),
        chapterKeys: [],
        label: translationLabel(chapter),
      };
    existing.chapterIds.add(chapter.id);
    existing.chapterKeys.push(chapter.selectionKey);
    byKey.set(key, existing);
  }
  return Array.from(byKey.entries()).map(([key, value]) => ({
    chapterCount: stableChapterKeys.length + value.chapterIds.size,
    chapterKeys: [...stableChapterKeys, ...value.chapterKeys],
    key,
    label: value.label,
  }));
}

function selectedTranslationValue(
  selectedKeys: Set<string>,
  translationOptions: TranslationOption[],
  chapterCount: number,
): string {
  if (chapterCount > 0 && selectedKeys.size === chapterCount) return "all";
  for (const option of translationOptions) {
    if (setsMatch(selectedKeys, option.chapterKeys)) return option.key;
  }
  return "custom";
}

function setsMatch(selectedKeys: Set<string>, expectedKeys: string[]): boolean {
  if (selectedKeys.size !== expectedKeys.length) return false;
  return expectedKeys.every((key) => selectedKeys.has(key));
}

function translationKey(chapter: ContentArchiveChapter): string {
  const label = chapter.branchName?.trim().toLowerCase();
  if (label) return `label:${label}`;
  if (chapter.branchId) return `branch:${chapter.branchId}`;
  return "default:source";
}

function translationLabel(chapter: ContentArchiveChapter): string {
  return chapter.branchName?.trim() || "Default";
}
