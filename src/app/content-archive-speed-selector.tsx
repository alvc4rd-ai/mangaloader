"use client";

import { useState } from "react";

import { FAINT, LINE, MUT, TX } from "@/components/design/kit";
import {
  contentArchiveSpeedLaneOptions,
  DEFAULT_CONTENT_ARCHIVE_SPEED_LANE,
} from "@/lib/content-archive/pacing";
import type { SupportedContentArchiveSourceKey } from "@/lib/content-archive/planning";

/**
 * Compact segmented control for the per-job download speed lane. A single row of
 * three pills plus one caption line, so it reads as one control instead of a
 * second stacked radio list under the image-server picker.
 */
export function ContentArchiveSpeedSelector({
  source,
}: {
  source: SupportedContentArchiveSourceKey;
}) {
  const options = contentArchiveSpeedLaneOptions(source);
  const [selectedLane, setSelectedLane] = useState(DEFAULT_CONTENT_ARCHIVE_SPEED_LANE);
  const active = options.find((option) => option.lane === selectedLane) ?? options[0];

  return (
    <div className="grid gap-1">
      <div
        className="atlas-radius-control flex gap-1 border p-1"
        role="radiogroup"
        aria-label="Download speed"
        style={{ borderColor: LINE }}
      >
        {options.map((option) => {
          const checked = option.lane === selectedLane;
          return (
            <label
              key={option.lane}
              className="atlas-radius-control-compact flex flex-1 cursor-pointer items-center justify-center px-2 py-1 text-center text-[11px] font-medium transition-colors focus-within:ring-2 focus-within:ring-ring"
              style={{
                background: checked
                  ? "color-mix(in srgb, var(--accent) 16%, transparent)"
                  : "transparent",
                color: checked ? TX : MUT,
              }}
            >
              <input
                type="radio"
                name="speed_lane"
                value={option.lane}
                checked={checked}
                onChange={() => setSelectedLane(option.lane)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {active ? (
        <span className="text-[10px]" style={{ color: FAINT }}>
          {active.note} · {formatLaneDelay(active.pageDelayMs)}
        </span>
      ) : null}
    </div>
  );
}

function formatLaneDelay(ms: number): string {
  return ms <= 0 ? "no gap between pages" : `${ms} ms/page`;
}
