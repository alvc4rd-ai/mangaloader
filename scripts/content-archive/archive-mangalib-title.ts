import { config as loadEnv } from "dotenv";

import {
  normalizeContentArchiveSourceKey,
  sourceLabel,
  type SupportedContentArchiveSourceKey,
} from "../../src/lib/content-archive/planning";
import { runLibSocialContentArchive } from "./mangalib-archive";
import { runNHentaiContentArchive } from "./nhentai-archive";

type CliOptions = {
  source: SupportedContentArchiveSourceKey;
  sourceInput: string | null;
  imageServerId: string | null;
  chapterRange: string | null;
  dryRun: boolean;
  upload: boolean;
};

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  if (!options.sourceInput) {
    throw new Error("--source-input is required.");
  }

  const result =
    options.source === "nhentai"
      ? await runNHentaiContentArchive({
          sourceInput: options.sourceInput,
          imageServerId: options.imageServerId,
          chapterRange: options.chapterRange,
          dryRun: options.dryRun,
          upload: options.upload,
          log: (line) => console.log(`[content-archive:${options.source}] ${line}`),
        })
      : await runLibSocialContentArchive({
          source: options.source,
          sourceInput: options.sourceInput,
          imageServerId: options.imageServerId,
          chapterRange: options.chapterRange,
          dryRun: options.dryRun,
          upload: options.upload,
          log: (line) => console.log(`[content-archive:${options.source}] ${line}`),
        });

  console.log(
    JSON.stringify(
      {
        title: result.title,
        source: result.source,
        slug: result.slug,
        dryRun: result.dryRun,
        upload: result.upload,
        discoveredChapters: result.discoveredChapters,
        selectedChapters: result.selectedChapters,
        imageServerId: result.imageServerId,
        cbzFiles: result.cbzFiles,
        outputDir: result.outputDir,
        remoteDir: result.remoteDir,
      },
      null,
      2,
    ),
  );
}

function loadLocalEnv() {
  for (const path of [".env.local", ".backup.env", ".env"]) {
    loadEnv({ path, override: false, quiet: true });
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    source: "mangalib",
    sourceInput: null,
    imageServerId: null,
    chapterRange: null,
    dryRun: true,
    upload: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (arg === "--source") {
      const source = normalizeContentArchiveSourceKey(next());
      if (!source) throw new Error("--source must be mangalib, nhentai, slashlib, or hentailib.");
      options.source = source;
    } else if (arg.startsWith("--source=")) {
      const source = normalizeContentArchiveSourceKey(arg.slice(9));
      if (!source) throw new Error("--source must be mangalib, nhentai, slashlib, or hentailib.");
      options.source = source;
    } else if (arg === "--source-input") options.sourceInput = next();
    else if (arg.startsWith("--source-input=")) options.sourceInput = arg.slice(15);
    else if (arg === "--image-server") options.imageServerId = next();
    else if (arg.startsWith("--image-server=")) options.imageServerId = arg.slice(15);
    else if (arg === "--chapter-range") options.chapterRange = next();
    else if (arg.startsWith("--chapter-range=")) options.chapterRange = arg.slice(16);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-dry-run") options.dryRun = false;
    else if (arg === "--upload") {
      options.upload = true;
      options.dryRun = false;
    } else if (arg === "--no-upload") options.upload = false;
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run content-archive:mangalib -- --source-input "https://mangalib.org/ru/manga/43136--joshikousei-to-seishokusha-san" --chapter-range 1-3 --dry-run
  npm run content-archive:nhentai -- --source-input "https://nhentai.net/g/123456/" --dry-run
  npm run content-archive:hentailib -- --source-input "https://hentailib.me/manga/48291--tenshi-no-3p" --chapter-range 1 --dry-run
  npm run content-archive:slashlib -- --source-input "https://slashlib.me/manga/184436--class-alpha-final-fantasy-fanbook" --chapter-range 1 --dry-run
  npm run content-archive:mangalib -- --source-input "206--one-piece" --chapter-range 1 --upload

Options:
  --source VALUE           ${sourceLabel("mangalib")}, ${sourceLabel("nhentai")}, ${sourceLabel("slashlib")}, or ${sourceLabel("hentailib")} source key.
  --source-input VALUE     Source URL, full slug, or numeric id.
  --image-server VALUE     Optional LibSocial image server id, such as main, secondary, compress, or download.
  --chapter-range VALUE    Optional range such as 1-10, 5, or 1,3-5.
  --dry-run                Discover chapters without downloading pages.
  --upload                 Download CBZ files and upload to ATLAS_BACKUP_DRIVE_REMOTE.
  --no-upload              Keep finished CBZ files local only.
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
