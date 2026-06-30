import type { LibSocialContentArchiveSourceKey } from "./planning";
export { contentArchiveImageRequestHeaders } from "./reachability";

const GLOBAL_IMAGE_COOKIE_ENV = "ATLAS_CONTENT_ARCHIVE_IMAGE_COOKIE";

const SOURCE_IMAGE_COOKIE_ENV: Record<LibSocialContentArchiveSourceKey, string> = {
  mangalib: "ATLAS_CONTENT_ARCHIVE_MANGALIB_IMAGE_COOKIE",
  slashlib: "ATLAS_CONTENT_ARCHIVE_SLASHLIB_IMAGE_COOKIE",
  hentailib: "ATLAS_CONTENT_ARCHIVE_HENTAILIB_IMAGE_COOKIE",
};

export function resolveContentArchiveImageCookie(
  source: LibSocialContentArchiveSourceKey,
  env: NodeJS.ProcessEnv = process.env,
  uiCookie?: string | null,
): string | null {
  const fromUi = uiCookie?.trim();
  if (fromUi) return fromUi;
  const fromSource = env[SOURCE_IMAGE_COOKIE_ENV[source]]?.trim();
  if (fromSource) return fromSource;
  return env[GLOBAL_IMAGE_COOKIE_ENV]?.trim() ?? null;
}
