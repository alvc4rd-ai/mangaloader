# mangaloader

A private, single-user tool to archive manga / doujinshi from **MangaLib,
HentaiLib, SlashLib, and nHentai** into CBZ files and (optionally) upload them
to Google Drive via `rclone`.

It is a standalone extraction of the Atlas "Content Archive" feature: the same
download / CBZ / upload engine, with a small Next.js web UI on top. There is no
database and no login (intended to run locally on your own machine) — you add
your LibSocial credentials **through the UI** (saved to a local file) or via
`.env.local`.

## Features

- Add a **bearer token**, **refresh token**, or **image cookie** straight in the
  UI, with a clear **Ready / Token expired / Not configured** status and a
  **Test** button. `.env.local` still works as a fallback.
- Paste a source URL (or slug / nHentai code), **Analyze** the title, pick
  chapters / translations / image server, then **Dry run** or **Archive**.
- Quality-first **Server 1 / Server 2** image selection for LibSocial.
- Live job history with a progress bar that **auto-refreshes every 2 seconds**
  (no manual page refresh) and a `live · updated Ns ago` indicator.
- Refresh-token rotation handled for you: a fresh bearer is minted on demand and
  the rotated refresh token is saved back automatically.
- Robust downloader: retries with backoff for `429` / transient `403`
  (DDoS-Guard) plus configurable page pacing.
- CLI mode for scripted runs.

## Requirements

- Node.js 20+ (developed on Node 24).
- [`rclone`](https://rclone.org/) on your `PATH`, configured with a Drive
  remote, if you want the upload step. Download-only works without it.
- A VPN with an allowed egress region for the LibSocial image hosts (Server 1/2
  are geo-restricted). A full-tunnel VPN is the simplest reliable setup.

## Setup

```bash
npm install
cp .env.example .env.local   # optional — you can add the token in the UI instead
```

`.env.local` is optional: it's only needed for the Drive remote / pacing, or if
you prefer to provide the LibSocial token by env. The bearer / refresh token and
image cookie can all be entered in the **LibSocial auth** panel in the web UI.
See `.env.example` for every supported variable.

## Run the web app

```bash
npm run dev
# open http://localhost:3000
```

First, open the **LibSocial auth** panel and paste a bearer token (or a refresh
token), then click **Test** — the badge should read **Ready**. (nHentai needs no
auth.) Then paste a title URL, click **Analyze**, choose chapters and an image
server, and **Dry run** (discover only) or **Archive** (download CBZ + upload if
a Drive remote is configured). The job appears in **Recent jobs** and its
progress bar updates on its own.

UI-saved secrets are written to `.atlas-backups/content-archive-auth.json`
(mode `0600`, gitignored). A saved token takes precedence over `.env.local`.

## Run from the CLI

```bash
# Dry run (discovery only)
npm run archive:mangalib -- --source-input "https://mangalib.org/ru/manga/70510--dandadan" --chapter-range 1-3 --dry-run

# Download + upload
npm run archive:hentailib -- --source-input "https://hentailib.me/ru/manga/24112--taming-a-maid" --chapter-range 1-5 --upload

# nHentai (no auth)
npm run archive:nhentai -- --source-input "https://nhentai.net/g/657567/" --upload
```

Flags: `--source-input`, `--chapter-range` (`1-10`, `5`, `1,3-5`),
`--image-server` (`main`/`secondary`/`compress`/`download`), `--dry-run`,
`--upload`. Run with `--help` for the full list.

## Output

CBZ files and run records are written under `.atlas-backups/` (override with
`ATLAS_BACKUP_ROOT`) and uploaded under the configured Drive remote. This
directory is gitignored.

## Notes

- Environment variable names are inherited from the Atlas engine
  (`ATLAS_CONTENT_ARCHIVE_*`, `ATLAS_BACKUP_*`) — see `.env.example`.
- This tool is for private personal archiving only.
