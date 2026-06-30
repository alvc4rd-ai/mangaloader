import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";

import { FAINT, LINE, MONO, MUT, TX } from "@/components/design/kit";

/**
 * Collapsed-by-default "how it works" guide for the content-archive page. Holds
 * the credential-acquisition walkthrough and speed-lane notes that used to
 * sprawl across the auth panel as loose helper paragraphs.
 */
export function ContentArchiveGuide() {
  return (
    <details
      className="group atlas-radius-control border"
      style={{ borderColor: LINE, background: "var(--panel)" }}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden"
        style={{ color: TX }}
      >
        <BookOpen aria-hidden className="h-3.5 w-3.5" style={{ color: MUT }} />
        Setup guide
        <span className="ml-auto text-[11px] font-normal" style={{ color: FAINT }}>
          tokens · image cookie · speed
        </span>
      </summary>
      <div
        className="grid gap-3 border-t px-3 py-3 text-[11px] leading-5"
        style={{ borderColor: LINE, color: MUT }}
      >
        <p className="m-0" style={{ color: FAINT }}>
          Private operator tooling. Do everything below through a stable VPN exit that can reach the
          lib.me sites and the Server&nbsp;1/2 image hosts.
        </p>

        <Step n={1} title="What you need">
          <ul className="m-0 grid list-disc gap-1 pl-4">
            <li>
              A LibSocial <Em>bearer token</Em> (short-lived) — or a <Em>refresh token</Em> so
              mangaloader mints bearers for you. Either one flips auth to <Em>Ready</Em>.
            </li>
            <li>
              A <Em>DDoS-Guard image cookie</Em> for the Server&nbsp;1/2 hosts (<Code>img2.imglib.info</Code>).
            </li>
          </ul>
        </Step>

        <Step n={2} title="Get the token (dedicated private window, over your VPN)">
          <ul className="m-0 grid list-disc gap-1 pl-4">
            <li>
              Log in at <Code>mangalib.me</Code> — the same lib.me account also covers HentaiLib and
              SlashLib.
            </li>
            <li>
              Open DevTools → <Em>Network</Em>, then click any request to <Code>api.cdnlibs.org</Code>.
            </li>
            <li>
              <Em>Bearer:</Em> copy the <Code>Authorization: Bearer …</Code> value and paste it into{" "}
              <Em>Bearer token</Em> (simplest setup).
            </li>
            <li>
              <Em>Refresh token (recommended):</Em> from the <Code>auth/oauth/token</Code> response,
              copy <Code>refresh_token</Code> (it starts <Code>def50200…</Code>) and paste it into{" "}
              <Em>Refresh token</Em> — mangaloader refreshes bearers automatically.
            </li>
            <li>
              Keep this a separate private window: Passport rotates the refresh token on use and logs
              the old session out.
            </li>
          </ul>
        </Step>

        <Step n={3} title="Get the image cookie (Server 1/2)">
          <ul className="m-0 grid list-disc gap-1 pl-4">
            <li>
              In the same VPN window, open any image hosted on <Code>img2.imglib.info</Code>.
            </li>
            <li>
              DevTools → Network → that image → copy its full <Code>Cookie</Code> header (the{" "}
              <Code>__ddg…</Code> values). Paste it into <Em>Image cookie</Em>.
            </li>
          </ul>
        </Step>

        <Step n={4} title="Pick a download speed (LibSocial only)">
          <ul className="m-0 grid list-disc gap-1 pl-4">
            <li>
              <Em>Quickest</Em> — no pause between pages; fastest on a clean route.
            </li>
            <li>
              <Em>Balanced</Em> — a light ~120&nbsp;ms gap; the safe default.
            </li>
            <li>
              <Em>Safe</Em> — ~400&nbsp;ms gap for flaky sessions or very large titles.
            </li>
            <li>nHentai always downloads at full speed.</li>
          </ul>
        </Step>

        <p className="m-0" style={{ color: FAINT }}>
          Saved tokens are written to a local <Code>.atlas-backups/content-archive-auth.json</Code>{" "}
          (0600, gitignored). <Code>.env.local</Code> still works as a fallback (bearer{" "}
          <Code>ATLAS_CONTENT_ARCHIVE_MANGALIB_BEARER_TOKEN</Code>, refresh{" "}
          <Code>MANGALIB_REFRESH_TOKEN</Code>, cookie <Code>ATLAS_CONTENT_ARCHIVE_IMAGE_COOKIE</Code>).
          Output is unencrypted CBZ in your Google Drive remote (or a local folder) — a private
          archive.
        </p>
      </div>
    </details>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2" style={{ color: TX }}>
        <span
          aria-hidden
          className="atlas-num inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
          style={{
            background: "color-mix(in srgb, var(--accent) 18%, transparent)",
            color: "var(--accent)",
          }}
        >
          {n}
        </span>
        <span className="text-[11px] font-semibold">{title}</span>
      </div>
      <div className="pl-6">{children}</div>
    </div>
  );
}

function Em({ children }: { children: ReactNode }) {
  return (
    <span className="font-medium" style={{ color: TX }}>
      {children}
    </span>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code
      className="rounded px-1 py-0.5 text-[10px]"
      style={{ background: "var(--fill-subtle)", color: TX, fontFamily: MONO }}
    >
      {children}
    </code>
  );
}
