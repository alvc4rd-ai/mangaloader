import type { SupportedContentArchiveSourceKey } from "./planning";

export type ContentArchiveImageReachabilityStatus =
  | "reachable"
  | "unreachable"
  | "unknown";

export type ContentArchiveImageByteProbeResult = {
  status: ContentArchiveImageReachabilityStatus;
  bytes: number | null;
  method: "HEAD" | "GET" | null;
  httpStatus: number | null;
  retryAfter: string | null;
};

export type ContentArchiveImageDownloadProbeResult = {
  status: "ok" | "failed";
  measuredBytes: number;
  durationMs: number;
  httpStatus: number | null;
  retryAfter: string | null;
  error?: string;
};

export type ContentArchiveCalibrationProbeStatus =
  | "ok"
  | "skipped"
  | "failed";

export type ContentArchiveCalibrationProbe = {
  source: SupportedContentArchiveSourceKey;
  sourceInput: string;
  title: string | null;
  serverId: string | null;
  serverLabel: string | null;
  estimatedBytes: number | null;
  measuredBytes: number;
  durationMs: number;
  status: ContentArchiveCalibrationProbeStatus;
  httpStatus?: number | null;
  retryAfter?: string | null;
};

export type ContentArchiveCalibrationLane = {
  name: "quickest" | "best" | "safest";
  pageDelayMs: number;
  bytesPerSecond: number | null;
  estimatedSeconds: number | null;
  notes: string[];
};

export type ContentArchiveCalibrationSummary = {
  okProbeCount: number;
  failedProbeCount: number;
  skippedProbeCount: number;
  fastestBytesPerSecond: number | null;
  medianBytesPerSecond: number | null;
  conservativeBytesPerSecond: number | null;
  totalEstimatedBytes: number | null;
  hasRateLimitSignals: boolean;
  lanes: ContentArchiveCalibrationLane[];
};

export function contentArchiveImageRequestHeaders(input: {
  referer: string;
  cookie?: string | null;
  rangeBytes?: number | null;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    Referer: input.referer,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari AtlasContentArchive/1.0",
  };
  const cookie = input.cookie?.trim();
  if (cookie) headers.Cookie = cookie;
  if (input.rangeBytes && input.rangeBytes > 0) {
    headers.Range = `bytes=0-${Math.max(0, Math.floor(input.rangeBytes) - 1)}`;
  }
  return headers;
}

export async function fetchContentArchiveImageByteLength(input: {
  fetchImpl: typeof fetch;
  referer: string;
  url: string;
  cookie?: string | null;
  timeoutMs: number;
  bodyFallback?: boolean;
}): Promise<number | null> {
  const result = await probeContentArchiveImageByteLength(input);
  return result.bytes;
}

export async function probeContentArchiveImageByteLength(input: {
  fetchImpl: typeof fetch;
  referer: string;
  url: string;
  cookie?: string | null;
  timeoutMs: number;
  bodyFallback?: boolean;
}): Promise<ContentArchiveImageByteProbeResult> {
  const head = await requestContentArchiveImageByteLength({
    ...input,
    method: "HEAD",
    readBody: false,
  });
  if (head.bytes) return head;
  if (!input.bodyFallback) return head;
  const body = await requestContentArchiveImageByteLength({
    ...input,
    method: "GET",
    readBody: true,
  });
  return body.bytes ? body : head.status === "unreachable" ? head : body;
}

export async function probeContentArchiveImageDownload(input: {
  fetchImpl?: typeof fetch;
  url: string;
  referer: string;
  cookie?: string | null;
  maxBytes: number;
  timeoutMs: number;
}): Promise<ContentArchiveImageDownloadProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetchImpl(input.url, {
      headers: contentArchiveImageRequestHeaders({
        referer: input.referer,
        cookie: input.cookie,
        rangeBytes: input.maxBytes,
      }),
      signal: controller.signal,
    });
    const retryAfter = response.headers.get("retry-after");
    if (!response.ok) {
      return {
        status: "failed",
        measuredBytes: 0,
        durationMs: Math.round(Date.now() - started),
        httpStatus: response.status,
        retryAfter,
      };
    }
    const measuredBytes = await readResponseBytes(response, input.maxBytes);
    return {
      status: "ok",
      measuredBytes,
      durationMs: Math.max(1, Math.round(Date.now() - started)),
      httpStatus: response.status,
      retryAfter,
    };
  } catch (error) {
    return {
      status: "failed",
      measuredBytes: 0,
      durationMs: Math.round(Date.now() - started),
      httpStatus: null,
      retryAfter: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function contentArchiveProbeBytesPerSecond(
  probe: Pick<ContentArchiveCalibrationProbe, "durationMs" | "measuredBytes" | "status">,
): number | null {
  if (probe.status !== "ok") return null;
  if (probe.measuredBytes <= 0 || probe.durationMs <= 0) return null;
  return Math.round((probe.measuredBytes / probe.durationMs) * 1000);
}

export function estimateContentArchiveDownloadSeconds(input: {
  bytes: number | null;
  bytesPerSecond: number | null;
  pageCount?: number | null;
  pageDelayMs?: number | null;
}): number | null {
  if (!input.bytes || input.bytes <= 0) return null;
  if (!input.bytesPerSecond || input.bytesPerSecond <= 0) return null;
  const transferSeconds = input.bytes / input.bytesPerSecond;
  const delaySeconds =
    input.pageCount && input.pageDelayMs
      ? Math.max(0, input.pageCount - 1) * (input.pageDelayMs / 1000)
      : 0;
  return Math.max(1, Math.ceil(transferSeconds + delaySeconds));
}

export function summarizeContentArchiveCalibration(
  probes: ContentArchiveCalibrationProbe[],
): ContentArchiveCalibrationSummary {
  const ok = probes.filter((probe) => probe.status === "ok");
  const failed = probes.filter((probe) => probe.status === "failed");
  const skipped = probes.filter((probe) => probe.status === "skipped");
  const speeds = ok
    .map(contentArchiveProbeBytesPerSecond)
    .filter((speed): speed is number => Boolean(speed && speed > 0))
    .sort((a, b) => a - b);
  const fastest = speeds.at(-1) ?? null;
  const median = medianNumber(speeds);
  const conservative = median ? Math.max(1, Math.round(median * 0.6)) : null;
  const totalEstimatedBytes = totalEstimatedBytesByInput(probes);
  const hasRateLimitSignals = probes.some(
    (probe) =>
      probe.httpStatus === 429 ||
      Boolean(probe.retryAfter?.trim()) ||
      (typeof probe.httpStatus === "number" && probe.httpStatus >= 500),
  );

  return {
    okProbeCount: ok.length,
    failedProbeCount: failed.length,
    skippedProbeCount: skipped.length,
    fastestBytesPerSecond: fastest,
    medianBytesPerSecond: median,
    conservativeBytesPerSecond: conservative,
    totalEstimatedBytes,
    hasRateLimitSignals,
    lanes: [
      calibrationLane({
        name: "quickest",
        pageDelayMs: hasRateLimitSignals ? 500 : 0,
        bytesPerSecond: fastest,
        totalEstimatedBytes,
        notes: [
          "Use the fastest reachable server from this machine/VPN.",
          "Keep one archive job at a time until a clean sustained pass exists.",
        ],
      }),
      calibrationLane({
        name: "best",
        pageDelayMs: hasRateLimitSignals ? 750 : 250,
        bytesPerSecond: median,
        totalEstimatedBytes,
        notes: [
          "Prefer the highest-quality reachable source server, then tolerate a small page gap.",
          "Good default when archiving useful personal titles without riding the edge.",
        ],
      }),
      calibrationLane({
        name: "safest",
        pageDelayMs: 1000,
        bytesPerSecond: conservative,
        totalEstimatedBytes,
        notes: [
          "Use when a VPN/source host is flaky or when the selected title is very large.",
          "Stop on 429/403/5xx instead of retry-storming.",
        ],
      }),
    ],
  };
}

async function requestContentArchiveImageByteLength(input: {
  fetchImpl: typeof fetch;
  method: "HEAD" | "GET";
  readBody: boolean;
  referer: string;
  url: string;
  cookie?: string | null;
  timeoutMs: number;
}): Promise<ContentArchiveImageByteProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.url, {
      method: input.method,
      headers: contentArchiveImageRequestHeaders({
        referer: input.referer,
        cookie: input.cookie,
      }),
      signal: controller.signal,
    });
    const retryAfter = response.headers.get("retry-after");
    if (!response.ok) {
      return {
        status: "unreachable",
        bytes: null,
        method: input.method,
        httpStatus: response.status,
        retryAfter,
      };
    }
    const contentLength = response.headers.get("content-length");
    const parsed = contentLength ? Number(contentLength) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return {
        status: "reachable",
        bytes: parsed,
        method: input.method,
        httpStatus: response.status,
        retryAfter,
      };
    }
    if (!input.readBody) {
      return {
        status: "unknown",
        bytes: null,
        method: input.method,
        httpStatus: response.status,
        retryAfter,
      };
    }
    const buffer = await response.arrayBuffer();
    return {
      status: buffer.byteLength > 0 ? "reachable" : "unknown",
      bytes: buffer.byteLength > 0 ? buffer.byteLength : null,
      method: input.method,
      httpStatus: response.status,
      retryAfter,
    };
  } catch {
    return {
      status: "unreachable",
      bytes: null,
      method: input.method,
      httpStatus: null,
      retryAfter: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<number> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    return Math.min(buffer.byteLength, maxBytes);
  }
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }
    if (total >= maxBytes) await reader.cancel();
    return Math.min(total, maxBytes);
  } finally {
    reader.releaseLock();
  }
}

function calibrationLane(input: {
  name: ContentArchiveCalibrationLane["name"];
  pageDelayMs: number;
  bytesPerSecond: number | null;
  totalEstimatedBytes: number | null;
  notes: string[];
}): ContentArchiveCalibrationLane {
  return {
    name: input.name,
    pageDelayMs: input.pageDelayMs,
    bytesPerSecond: input.bytesPerSecond,
    estimatedSeconds: estimateContentArchiveDownloadSeconds({
      bytes: input.totalEstimatedBytes,
      bytesPerSecond: input.bytesPerSecond,
      pageDelayMs: input.pageDelayMs,
    }),
    notes: input.notes,
  };
}

function medianNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle]!;
  return Math.round((values[middle - 1]! + values[middle]!) / 2);
}

function totalEstimatedBytesByInput(
  probes: ContentArchiveCalibrationProbe[],
): number | null {
  const bestByInput = new Map<string, number>();
  for (const probe of probes) {
    if (!probe.estimatedBytes || probe.estimatedBytes <= 0) continue;
    const key = `${probe.source}:${probe.sourceInput}`;
    bestByInput.set(key, Math.max(bestByInput.get(key) ?? 0, probe.estimatedBytes));
  }
  if (bestByInput.size === 0) return null;
  return Array.from(bestByInput.values()).reduce((sum, bytes) => sum + bytes, 0);
}
