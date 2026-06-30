"use client";

import { useMemo, useState } from "react";

import { FAINT, LINE, MUT, TX } from "@/components/design/kit";
import type { LibSocialArchiveImageServerOption } from "@/lib/content-archive/mangalib-reader";

export function ContentArchiveServerSelector({
  analyzeFormId,
  defaultImageServerId,
  selectedChapterKeys,
  servers,
}: {
  analyzeFormId: string;
  defaultImageServerId: string | null;
  selectedChapterKeys: string[];
  servers: LibSocialArchiveImageServerOption[];
}) {
  const defaultValue = defaultImageServerId ?? servers[0]?.id ?? "";
  const [selectedServerId, setSelectedServerId] = useState(defaultValue);
  const selectedKeys = useMemo(() => new Set(selectedChapterKeys), [selectedChapterKeys]);

  if (servers.length === 0) return null;

  return (
    <>
      <div className="grid gap-1" role="radiogroup" aria-label="Image server">
        {servers.map((server) => {
          const checked = server.id === selectedServerId;
          return (
            <label
              key={`${server.id}:${server.url}`}
              className="atlas-radius-control grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border px-2 py-1.5 text-xs transition-colors"
              style={{
                borderColor: checked ? "var(--accent)" : LINE,
                background: checked ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                color: TX,
              }}
              title={server.url}
            >
              <input
                type="radio"
                name="image_server_id"
                value={server.id}
                checked={checked}
                onChange={() => setSelectedServerId(server.id)}
                className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
              />
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate font-medium">{serverLabel(server.id, server.label)}</span>
                <span className="truncate text-[10px]" style={{ color: FAINT }}>
                  {serverHost(server.url)}
                </span>
              </span>
              <span
                className="atlas-num shrink-0 text-right text-[11px] font-medium"
                style={{ color: checked ? TX : MUT }}
              >
                {formatSelectedServerSizeEstimate(server, selectedKeys)}
              </span>
            </label>
          );
        })}
      </div>
      <input
        type="hidden"
        name="content_archive_image_server_id"
        value={selectedServerId}
        form={analyzeFormId}
      />
    </>
  );
}

function serverLabel(id: string, label: string): string {
  switch (id) {
    case "main":
      return `Server 1 · ${label}`;
    case "secondary":
      return `Server 2 · ${label}`;
    case "compress":
      return `Compressed · ${label}`;
    case "download":
      return `Download · ${label}`;
    default:
      return label;
  }
}

function serverHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatSelectedServerSizeEstimate(
  server: LibSocialArchiveImageServerOption,
  selectedKeys: Set<string>,
): string {
  if (selectedKeys.size === 0) return "none";
  const estimates = server.chapterSizeEstimates;
  if (!estimates) return formatServerSizeEstimate(server.sizeEstimate ?? null);

  let bytes = 0;
  let knownChapters = 0;
  let probedChapters = 0;
  for (const key of selectedKeys) {
    const estimate = estimates[key];
    if (!estimate) continue;
    if (estimate.pageCount) probedChapters += 1;
    if (estimate.estimatedBytes) {
      bytes += estimate.estimatedBytes;
      knownChapters += 1;
    }
  }
  if (knownChapters > 0) {
    const prefix = knownChapters === selectedKeys.size ? "≈" : "partial ≈";
    return `${prefix} ${formatCompactBytes(bytes)}`;
  }
  return probedChapters > 0 ? "unreachable" : "size n/a";
}

function formatServerSizeEstimate(
  estimate: LibSocialArchiveImageServerOption["sizeEstimate"],
): string {
  if (!estimate?.estimatedBytes) {
    return estimate ? "unreachable" : "size n/a";
  }
  const suffix = estimate.estimateKind === "average" ? " avg" : "";
  return `≈ ${formatCompactBytes(estimate.estimatedBytes)}${suffix}`;
}

function formatCompactBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}
