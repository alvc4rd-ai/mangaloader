import type { SupportedContentArchiveSourceKey } from "./planning";

/**
 * Per-job content-archive download speed lanes. A lane maps to a per-page
 * download delay (ms) the runner sleeps between image requests. This module is
 * the single source of truth: the runner default, the server action, the
 * UI selector, and the tests all read lane → ms from here.
 */
export type ContentArchiveSpeedLane = "quickest" | "balanced" | "safe";

export const CONTENT_ARCHIVE_SPEED_LANES: readonly ContentArchiveSpeedLane[] = [
  "quickest",
  "balanced",
  "safe",
] as const;

export const DEFAULT_CONTENT_ARCHIVE_SPEED_LANE: ContentArchiveSpeedLane = "balanced";

type ContentArchiveSpeedLaneMeta = {
  lane: ContentArchiveSpeedLane;
  label: string;
  note: string;
};

const CONTENT_ARCHIVE_SPEED_LANE_META: Record<
  ContentArchiveSpeedLane,
  ContentArchiveSpeedLaneMeta
> = {
  quickest: {
    lane: "quickest",
    label: "Quickest",
    note: "No pause between pages.",
  },
  balanced: {
    lane: "balanced",
    label: "Balanced",
    note: "Light pause between pages.",
  },
  safe: {
    lane: "safe",
    label: "Safe",
    note: "Largest pause for flaky sessions.",
  },
};

/**
 * LibSocial image hosts (Server 1/2) sit behind DDoS-Guard. Sustained Server-1
 * downloads stayed clean at 0 ms across MangaLib/HentaiLib/SlashLib in testing
 * (127 sequential pages, no 403/429), so Quickest removes the pause entirely.
 * Balanced keeps a light gap as the default; Safe matches the prior
 * conservative pacing for flaky sessions or very large titles.
 */
const LIBSOCIAL_LANE_PAGE_DELAY_MS: Record<ContentArchiveSpeedLane, number> = {
  quickest: 0,
  balanced: 120,
  safe: 400,
};

/** nHentai's host is not DDoS-Guard rate-limited; it stays at 0 ms for every lane. */
export function contentArchivePageDelayForLane(
  source: SupportedContentArchiveSourceKey,
  lane: ContentArchiveSpeedLane,
): number {
  if (source === "nhentai") return 0;
  return LIBSOCIAL_LANE_PAGE_DELAY_MS[lane];
}

export function parseContentArchiveSpeedLane(
  value: string | null | undefined,
): ContentArchiveSpeedLane | null {
  const key = value?.trim().toLowerCase();
  return CONTENT_ARCHIVE_SPEED_LANES.find((lane) => lane === key) ?? null;
}

export function contentArchiveSpeedLaneLabel(lane: ContentArchiveSpeedLane): string {
  return CONTENT_ARCHIVE_SPEED_LANE_META[lane].label;
}

export function contentArchiveSpeedLaneNote(lane: ContentArchiveSpeedLane): string {
  return CONTENT_ARCHIVE_SPEED_LANE_META[lane].note;
}

export type ContentArchiveSpeedLaneOption = ContentArchiveSpeedLaneMeta & {
  pageDelayMs: number;
};

/** Ordered lane options resolved for a source, for rendering the UI selector. */
export function contentArchiveSpeedLaneOptions(
  source: SupportedContentArchiveSourceKey,
): ContentArchiveSpeedLaneOption[] {
  return CONTENT_ARCHIVE_SPEED_LANES.map((lane) => ({
    ...CONTENT_ARCHIVE_SPEED_LANE_META[lane],
    pageDelayMs: contentArchivePageDelayForLane(source, lane),
  }));
}
