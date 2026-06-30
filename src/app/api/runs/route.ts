import { NextResponse } from "next/server";

import {
  listContentArchiveRuns,
  readContentArchiveLogTail,
} from "@/server/content-archive/run-state";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await listContentArchiveRuns({ limit: 8 });
  const items = await Promise.all(
    runs.map(async (run) => ({
      run,
      log: await readContentArchiveLogTail(run.logFile),
    })),
  );
  return NextResponse.json({ items });
}
