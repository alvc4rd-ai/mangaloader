"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { Eyebrow } from "@/components/design/admin-kit";
import { CARD, FAINT, HAIR, LINE, MONO, MUT, TX } from "@/components/design/kit";
import { contentArchiveSpeedLaneLabel } from "@/lib/content-archive/pacing";
import { sourceLabel } from "@/lib/content-archive/planning";
import type { ContentArchiveRun } from "@/lib/content-archive/run-records";

export type ContentArchiveRunItem = {
  run: ContentArchiveRun;
  log: string | null;
};

type RunsResponse = {
  items?: ContentArchiveRunItem[];
};

export function ContentArchiveRunsPanel({
  initialItems,
  recentLimit,
}: {
  initialItems: ContentArchiveRunItem[];
  recentLimit: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const hasLiveJobs = useMemo(
    () => items.some((item) => item.run.status === "queued" || item.run.status === "running"),
    [items],
  );
  const visibleLimit = Math.max(1, recentLimit);
  const visibleItems = items.slice(0, visibleLimit);
  const hiddenItems = items.slice(visibleLimit);

  useEffect(() => {
    if (!hasLiveJobs) return undefined;

    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/runs", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as RunsResponse;
        if (active && Array.isArray(payload.items)) {
          setItems(payload.items);
          setLastSyncedAt(Date.now());
        }
      } catch {
        // Keep the last visible state; the collapsed logs remain available.
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [hasLiveJobs]);

  useEffect(() => {
    if (!hasLiveJobs) return undefined;
    const ticker = window.setInterval(() => setClockTick(Date.now()), 1_000);
    return () => window.clearInterval(ticker);
  }, [hasLiveJobs]);

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2">
        <Eyebrow>Recent jobs</Eyebrow>
        {hasLiveJobs ? (
          <span className="flex items-center gap-1.5">
            <Tag dim>live</Tag>
            <span className="atlas-num text-[11px]" style={{ color: FAINT, fontFamily: MONO }}>
              {formatSyncLabel(lastSyncedAt, clockTick)}
            </span>
          </span>
        ) : null}
        <div className="flex-1" />
        <span className="atlas-num text-xs" style={{ color: FAINT, fontFamily: MONO }}>
          {items.length}
        </span>
      </div>
      <div
        className="atlas-radius-panel overflow-hidden shadow-[var(--shadow-border)]"
        style={{ border: `1px solid ${LINE}`, background: CARD }}
      >
        {items.length === 0 ? (
          <p className="m-0 px-4 py-5 text-sm" style={{ color: MUT }}>
            No content archive jobs yet.
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: HAIR }}>
            {visibleItems.map((item) => (
              <RunRow key={item.run.runId} run={item.run} log={item.log} />
            ))}
            {hiddenItems.length > 0 ? (
              <details className="group">
                <summary
                  className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-2 text-xs"
                  style={{ color: FAINT }}
                >
                  <span>Older jobs</span>
                  <span className="atlas-num" style={{ fontFamily: MONO }}>
                    {hiddenItems.length}
                  </span>
                </summary>
                <div className="divide-y border-t" style={{ borderColor: HAIR }}>
                  {hiddenItems.map((item) => (
                    <RunRow key={item.run.runId} run={item.run} log={item.log} />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function RunRow({ run, log }: { run: ContentArchiveRun; log: string | null }) {
  const progress = buildRunProgress(run, log);
  return (
    <article className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium" style={{ color: TX }}>
          {run.title ?? sourceLabel(run.source)}
        </span>
        <Tag>{run.status}</Tag>
        {run.dryRun ? <Tag dim>dry run</Tag> : null}
        {run.upload ? <Tag dim>upload</Tag> : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: MUT }}>
        <span>{sourceLabel(run.source)}</span>
        <span>{runChapterSummary(run)}</span>
        <span>{formatDate(run.startedAt)}</span>
      </div>
      <ProgressMeter progress={progress} />
      <details className="group text-xs">
        <summary className="cursor-pointer select-none list-none" style={{ color: FAINT }}>
          Logs and details
        </summary>
        <div className="mt-2 grid gap-2" style={{ color: MUT }}>
          <div className="grid gap-1">
            <div className="break-all">Source: {run.sourceInput}</div>
            <div className="break-all">Run: {run.runId}</div>
            {run.imageServerId ? <div>Image server: {run.imageServerId}</div> : null}
            {run.source !== "nhentai" && (run.speedLane || run.pageDelayMs !== null) ? (
              <div>Download speed: {formatRunSpeed(run)}</div>
            ) : null}
            {run.exitCode !== null ? <div>Exit: {run.exitCode}</div> : null}
            {run.failureKind ? <div>Failure kind: {run.failureKind}</div> : null}
            {run.manifestPath ? <div className="break-all">Manifest: {run.manifestPath}</div> : null}
            {run.uploadOutcome ? <div>Upload: {uploadOutcomeLabel(run)}</div> : null}
            {run.remoteDir ? (
              <div className="flex items-center gap-1 break-all" style={{ color: FAINT }}>
                <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                {run.remoteDir}
              </div>
            ) : null}
          </div>
          {log ? (
            <pre
              className="atlas-radius-panel m-0 max-h-[220px] overflow-auto whitespace-pre-wrap p-3 text-[11px] leading-5"
              style={{
                border: `1px solid ${LINE}`,
                background: "var(--panel)",
                color: MUT,
                fontFamily: MONO,
              }}
            >
              {log}
            </pre>
          ) : null}
        </div>
      </details>
    </article>
  );
}

type RunProgress = {
  percent: number;
  label: string;
  detail: string;
  tone: "normal" | "complete" | "failed" | "queued";
};

function ProgressMeter({ progress }: { progress: RunProgress }) {
  const fill =
    progress.tone === "failed"
      ? "rgb(248 113 113)"
      : progress.tone === "complete"
        ? "rgb(52 211 153)"
        : "var(--accent)";
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium" style={{ color: TX }}>
          {progress.label}
        </span>
        <span style={{ color: FAINT }}>{progress.detail}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--fill-subtle)" }}>
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${progress.percent}%`, background: fill }}
        />
      </div>
    </div>
  );
}

function buildRunProgress(run: ContentArchiveRun, log: string | null): RunProgress {
  const structured = structuredRunProgress(run);
  if (structured) return structured;

  if (run.status === "queued") {
    return { percent: 0, label: "Queued", detail: "Waiting to start", tone: "queued" };
  }
  if (run.status === "completed") {
    return {
      percent: 100,
      label: "Complete",
      detail: completionDetail(run, log),
      tone: "complete",
    };
  }
  const parsed = parseRunProgressLog(log);
  if (run.status === "failed") {
    return {
      percent: parsed.percent || 100,
      label: "Failed",
      detail: parsed.failure ?? "Open logs for details",
      tone: "failed",
    };
  }
  if (run.dryRun) {
    return {
      percent: parsed.percent || 45,
      label: "Checking",
      detail: "Analyzing source",
      tone: "normal",
    };
  }
  if (run.upload && parsed.downloadComplete) {
    return {
      percent: 97,
      label: "Running",
      detail: "Uploading to Drive",
      tone: "normal",
    };
  }
  return {
    percent: parsed.percent || 8,
    label: "Running",
    detail: parsed.detail ?? "Starting download",
    tone: "normal",
  };
}

function structuredRunProgress(run: ContentArchiveRun): RunProgress | null {
  const progress = run.progress;
  if (!progress) return null;
  if (run.status === "completed") {
    return {
      percent: 100,
      label: progress.label || "Complete",
      detail: progress.detail ?? completionDetail(run, null),
      tone: "complete",
    };
  }
  if (run.status === "failed") {
    return {
      percent: progress.percent || 100,
      label: progress.label || "Failed",
      detail: run.failureMessage
        ? summarizeFailure(run.failureMessage) ?? "Open logs for details"
        : progress.detail ?? "Open logs for details",
      tone: "failed",
    };
  }
  if (run.status === "queued") {
    return {
      percent: progress.percent,
      label: progress.label || "Queued",
      detail: progress.detail ?? "Waiting to start",
      tone: "queued",
    };
  }
  return {
    percent: progress.percent,
    label: progress.label || "Running",
    detail: structuredProgressDetail(progress),
    tone: "normal",
  };
}

function structuredProgressDetail(progress: NonNullable<ContentArchiveRun["progress"]>): string {
  const parts: string[] = [];
  if (progress.detail) parts.push(progress.detail);
  if (progress.current !== null && progress.total !== null) {
    parts.push(`${progress.current}/${progress.total}`);
  }
  if (progress.bytesDownloaded) {
    parts.push(`${formatCompactBytes(progress.bytesDownloaded)} downloaded`);
  }
  if (progress.estimatedBytes) {
    parts.push(`~${formatCompactBytes(progress.estimatedBytes)}`);
  }
  return parts.join(" · ") || "Running";
}

function parseRunProgressLog(log: string | null): {
  percent: number;
  detail: string | null;
  failure: string | null;
  downloadComplete: boolean;
} {
  if (!log) return { percent: 0, detail: null, failure: null, downloadComplete: false };
  const selectedChapters = numberMatch(log, /chapters selected:\s+(\d+)/);
  const pageEvents = log
    .split("\n")
    .map((line) => {
      const match = line.match(
        /^(\S+)\s+\[(?:mangalib|nhentai|slashlib|hentailib)\]\s+(?:chapter|gallery)\s+([^:]+):\s+page\s+(\d+)\/(\d+)\s+downloaded(?:\s+([\d.]+)\s+(B|KB|MB))?/,
      );
      if (!match) return null;
      return {
        at: Date.parse(match[1]!),
        current: Number(match[3]),
        total: Number(match[4]),
        bytes: parseLoggedBytes(match[5], match[6]),
      };
    })
    .filter((event): event is { at: number; current: number; total: number; bytes: number | null } =>
      Boolean(event),
    );
  const latestPage = pageEvents.at(-1);
  const fetchingChapters = (log.match(/\[(?:mangalib|nhentai|slashlib|hentailib)\]\s+chapter\s+[^:]+:\s+fetching page list/g) ?? [])
    .length;
  const failure = summarizeFailure(lastMatch(log, /\[content-archive\]\s+failed:\s+(.+)/g));
  if (!latestPage) {
    return {
      percent: fetchingChapters > 0 ? 5 : 0,
      detail: fetchingChapters > 0 ? "Fetching page list" : null,
      failure,
      downloadComplete: false,
    };
  }

  const totalChapters = selectedChapters || Math.max(fetchingChapters, 1);
  const completedChapters = Math.max(0, fetchingChapters - 1);
  const estimatedTotalPages = Math.max(latestPage.total, totalChapters * latestPage.total);
  const downloadedPages = Math.min(
    estimatedTotalPages,
    completedChapters * latestPage.total + latestPage.current,
  );
  const percent = Math.min(95, Math.max(5, Math.round((downloadedPages / estimatedTotalPages) * 100)));
  const eta = estimateRemaining(pageEvents, estimatedTotalPages, downloadedPages);
  return {
    percent,
    detail: eta ?? `Page ${downloadedPages}/${estimatedTotalPages}`,
    failure,
    downloadComplete: downloadedPages >= estimatedTotalPages,
  };
}

function estimateRemaining(
  pageEvents: Array<{ at: number; bytes: number | null }>,
  estimatedTotalPages: number,
  downloadedPages: number,
): string | null {
  const timed = pageEvents.filter((event) => Number.isFinite(event.at));
  if (timed.length < 2) return null;
  const first = timed[0]!;
  const last = timed.at(-1)!;
  const elapsedSeconds = Math.max(1, (last.at - first.at) / 1000);
  const pagesPerSecond = (timed.length - 1) / elapsedSeconds;
  if (!Number.isFinite(pagesPerSecond) || pagesPerSecond <= 0) return null;
  const remainingPages = Math.max(0, estimatedTotalPages - downloadedPages);
  const secondsLeft = remainingPages / pagesPerSecond;
  const byteEvents = timed.filter((event) => typeof event.bytes === "number");
  const bytes = byteEvents.reduce((sum, event) => sum + (event.bytes ?? 0), 0);
  const avgBytes = byteEvents.length > 0 ? bytes / byteEvents.length : 0;
  const estimatedTotalBytes = avgBytes > 0 ? avgBytes * estimatedTotalPages : 0;
  const speed = bytes > 0 ? bytes / elapsedSeconds : 0;
  const parts = [`~${formatDuration(secondsLeft)} left`, `page ${downloadedPages}/${estimatedTotalPages}`];
  if (estimatedTotalBytes > 0) parts.push(`~${formatCompactBytes(estimatedTotalBytes)}`);
  if (speed > 0) parts.push(`${formatCompactBytes(speed)}/s`);
  return parts.join(" · ");
}

function completionDetail(run: ContentArchiveRun, log: string | null): string {
  if (run.progress?.detail) return run.progress.detail;
  const complete = log?.match(/complete:\s+(\d+)\s+chapter\(s\),\s+(\d+)\s+cbz file\(s\)/);
  const duration = run.finishedAt ? formatDuration((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000) : null;
  if (complete) {
    return duration ? `${complete[2]} CBZ · ${duration}` : `${complete[2]} CBZ`;
  }
  return duration ? `Finished in ${duration}` : "Finished";
}

function uploadOutcomeLabel(run: ContentArchiveRun): string {
  const outcome = run.uploadOutcome;
  if (!outcome) return "n/a";
  const parts: string[] = [outcome.status];
  if (outcome.message) parts.push(outcome.message);
  if (outcome.completedAt) parts.push(formatDate(outcome.completedAt));
  return parts.join(" · ");
}

function numberMatch(value: string, pattern: RegExp): number | null {
  const match = value.match(pattern);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function lastMatch(value: string, pattern: RegExp): string | null {
  let found: string | null = null;
  for (const match of value.matchAll(pattern)) {
    found = match[1]?.trim() ?? null;
  }
  if (!found) return null;
  return found.length > 80 ? `${found.slice(0, 77)}...` : found;
}

function summarizeFailure(value: string | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("zip")) return "CBZ packaging failed";
  if (lower.includes("rclone")) return "Drive upload tool unavailable";
  if (lower.includes("image fetch")) return "Page image download failed";
  if (lower.includes("mangalib")) return "MangaLib request failed";
  if (lower.includes("nhentai")) return "nHentai request failed";
  if (lower.includes("slashlib")) return "SlashLib request failed";
  if (lower.includes("hentailib")) return "HentaiLib request failed";
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}

function parseLoggedBytes(value: string | undefined, unit: string | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !unit) return null;
  if (unit === "MB") return parsed * 1024 * 1024;
  if (unit === "KB") return parsed * 1024;
  return parsed;
}

function formatRunSpeed(run: ContentArchiveRun): string {
  const lane = run.speedLane ? contentArchiveSpeedLaneLabel(run.speedLane) : null;
  const pace =
    run.pageDelayMs === null ? null : run.pageDelayMs <= 0 ? "no gap" : `${run.pageDelayMs} ms/page`;
  if (lane && pace) return `${lane} · ${pace}`;
  return lane ?? pace ?? "default";
}

function runChapterSummary(run: ContentArchiveRun): string {
  if (run.source === "nhentai") return run.chapterRefs?.length ? "selected gallery" : "all gallery";
  if (run.chapterRefs?.length) return `${run.chapterRefs.length} selected chapters`;
  if (run.chapterIds?.length) return `${run.chapterIds.length} selected chapters`;
  return run.chapterRange ? `chapters ${run.chapterRange}` : "all chapters";
}

function Tag({
  children,
  dim = false,
}: {
  children: ReactNode;
  dim?: boolean;
}) {
  return (
    <span
      className="atlas-radius-control-compact border px-2 py-0.5 text-[11px]"
      style={{
        borderColor: dim ? HAIR : LINE,
        color: dim ? FAINT : TX,
        background: dim ? "transparent" : "var(--fill-subtle)",
      }}
    >
      {children}
    </span>
  );
}

function formatSyncLabel(lastSyncedAt: number | null, now: number): string {
  if (!lastSyncedAt) return "syncing…";
  const seconds = Math.max(0, Math.round((now - lastSyncedAt) / 1000));
  return seconds <= 0 ? "updated just now" : `updated ${seconds}s ago`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

function formatCompactBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}
