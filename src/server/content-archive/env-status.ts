import "server-only";

import { resolveContentArchiveImageCookie } from "@/lib/content-archive/image-cookie";
import {
  contentArchiveEnvBearerToken,
  contentArchiveEnvRefreshToken,
  libSocialTokenExpiry,
} from "./access";

export type EnvLibSocialStatus = {
  tokenConfigured: boolean;
  tokenSource: "env" | "none";
  tokenExpiresAt: Date | null;
  refreshTokenConfigured: boolean;
  imageCookieConfigured: boolean;
};

export function getEnvLibSocialStatus(
  env: NodeJS.ProcessEnv = process.env,
): EnvLibSocialStatus {
  const bearer = contentArchiveEnvBearerToken(env);
  const cookie =
    resolveContentArchiveImageCookie("mangalib", env) ??
    resolveContentArchiveImageCookie("hentailib", env);
  return {
    tokenConfigured: Boolean(bearer),
    tokenSource: bearer ? "env" : "none",
    tokenExpiresAt: libSocialTokenExpiry(bearer),
    refreshTokenConfigured: Boolean(contentArchiveEnvRefreshToken(env)),
    imageCookieConfigured: Boolean(cookie),
  };
}
