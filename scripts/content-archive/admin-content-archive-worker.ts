import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";

import type { ContentArchiveRun } from "../../src/lib/content-archive/run-records";
import {
  contentArchiveAccessErrorMessage,
  resolveContentArchiveAccess,
} from "../../src/server/content-archive/access";
import {
  completeContentArchiveRun,
  failContentArchiveRun,
  settleContentArchiveRunProgress,
  startContentArchiveRun,
} from "../../src/server/content-archive/job-settlement";
import { runLibSocialContentArchive } from "./mangalib-archive";
import { runNHentaiContentArchive } from "./nhentai-archive";

type WorkerOptions = {
  runId: string;
  jobFile: string;
  logFile: string;
};

const ROOT = process.cwd();

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  await mkdir(dirname(options.jobFile), { recursive: true });
  await mkdir(dirname(options.logFile), { recursive: true });

  let job: ContentArchiveRun = await startContentArchiveRun({
    jobFile: options.jobFile,
    logFile: options.logFile,
  });

  const log = createWriteStream(options.logFile, { flags: "a", mode: 0o600 });
  const writeLog = (line: string) => log.write(`${new Date().toISOString()} ${line}\n`);
  writeLog(`[content-archive] run ${options.runId} started`);

  let exitCode = 0;
  try {
    const progress = (event: Parameters<typeof settleContentArchiveRunProgress>[0]["event"]) =>
      settleContentArchiveRunProgress({
        jobFile: options.jobFile,
        event,
      }).then((updated) => {
        job = updated;
      });
    let result;
    if (job.source === "nhentai") {
      result = await runNHentaiContentArchive({
        sourceInput: job.sourceInput,
        imageServerId: job.imageServerId ?? null,
        chapterRange: job.chapterRange,
        chapterIds: job.chapterIds ?? null,
        chapterRefs: job.chapterRefs ?? null,
        dryRun: job.dryRun,
        upload: job.upload,
        cwd: ROOT,
        env: process.env,
        log: (line) => writeLog(`[${job.source}] ${line}`),
        progress,
      });
    } else {
      const source = job.source;
      const access = await resolveContentArchiveAccess({
        source,
        userId: job.userId,
        allowMissing: true,
        env: process.env,
      });
      result = await runLibSocialContentArchive({
        source,
        sourceInput: job.sourceInput,
        imageServerId: job.imageServerId ?? null,
        chapterRange: job.chapterRange,
        chapterIds: job.chapterIds ?? null,
        chapterRefs: job.chapterRefs ?? null,
        dryRun: job.dryRun,
        upload: job.upload,
        cwd: ROOT,
        env: process.env,
        imageCookie: access.imageCookie,
        authorization: access.authorization,
        authorizationProvider: ({ forceRefresh }) =>
          resolveContentArchiveAccess({
            source,
            userId: job.userId,
            forceRefresh,
            allowMissing: !forceRefresh,
            env: process.env,
          }).then((resolved) => ({ authorization: resolved.authorization })),
        log: (line) => writeLog(`[${source}] ${line}`),
        progress,
      });
    }
    writeLog(
      `[content-archive] complete: ${result.selectedChapters} chapter(s), ${result.cbzFiles.length} cbz file(s)`,
    );
    job = await completeContentArchiveRun({
      jobFile: options.jobFile,
      result,
    });
  } catch (error) {
    exitCode = 1;
    writeLog(`[content-archive] failed: ${contentArchiveAccessErrorMessage(error)}`);
    job = await failContentArchiveRun({
      jobFile: options.jobFile,
      error,
    });
  }

  void job;
  log.end();
  process.exitCode = exitCode;
}

function loadLocalEnv() {
  for (const path of [".env.local", ".backup.env", ".env"]) {
    loadEnv({ path, override: false, quiet: true });
  }
}

function parseArgs(argv: string[]): WorkerOptions {
  const values = new Map<string, string>();
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key && value) values.set(key, value);
  }
  const runId = values.get("run-id");
  const jobFile = values.get("job-file");
  const logFile = values.get("log-file");
  if (!runId || !jobFile || !logFile) {
    throw new Error("run-id, job-file, and log-file are required.");
  }
  return {
    runId,
    jobFile: resolve(ROOT, jobFile),
    logFile: resolve(ROOT, logFile),
  };
}

main().catch((error) => {
  console.error(contentArchiveAccessErrorMessage(error));
  process.exit(1);
});
