import { Archive } from "lucide-react";

import { AdminPageHeader, Eyebrow } from "@/components/design/admin-kit";
import { CARD, FAINT, LINE, MUT, TX } from "@/components/design/kit";
import { Button } from "@/components/ui/button";
import { sourceLabel } from "@/lib/content-archive/planning";
import {
  loadContentArchiveAdminView,
  type ContentArchiveAdminSearchParams,
  type ContentArchiveAuthStatus,
  type ContentArchiveFeedbackView,
  type ContentArchiveQueueFormDefaults,
  type LibSocialArchiveChapterPlan,
} from "@/server/content-archive/admin-projection";
import {
  saveContentArchiveLibSocialBearerToken,
  saveContentArchiveLibSocialImageCookie,
  saveContentArchiveLibSocialRefreshToken,
  startContentArchiveJob,
  testContentArchiveLibSocialAuth,
} from "./actions";
import { ContentArchiveGuide } from "./content-archive-guide";
import { ContentArchiveRunsPanel } from "./content-archive-runs-panel";
import { ContentArchiveQueueControls } from "./content-archive-queue-controls";

const AUTH_RETURN_TO = "/";

export const dynamic = "force-dynamic";

const ANALYZE_FORM_ID = "content-archive-analyze-form";
const QUEUE_FORM_ID = "content-archive-queue-form";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<ContentArchiveAdminSearchParams>;
}) {
  const view = await loadContentArchiveAdminView({
    params: await searchParams,
  });

  return (
    <main className="mx-auto grid w-full max-w-[1100px] gap-5 px-4 py-8 sm:px-6">
      <AdminPageHeader
        eyebrow="mangaloader"
        title="Content Archive"
        description="Private MangaLib, nHentai, SlashLib, and HentaiLib CBZ jobs for your Google Drive content archive. Auth comes from .env.local — no database, no login."
      />

      <Feedback feedback={view.feedback} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ArchiveRequestPanel
          sourceInput={view.sourceInput}
          chapterPlan={view.chapterPlan}
          queueForm={view.queueForm}
          libSocialSettings={view.libSocialSettings}
        />
        <ContentArchiveRunsPanel
          key={view.runPanelKey}
          initialItems={view.runItems}
          recentLimit={view.recentRunLimit}
        />
      </div>
    </main>
  );
}

function ArchiveRequestPanel({
  sourceInput,
  chapterPlan,
  queueForm,
  libSocialSettings,
}: {
  sourceInput: string;
  chapterPlan: LibSocialArchiveChapterPlan | null;
  queueForm: ContentArchiveQueueFormDefaults | null;
  libSocialSettings: ContentArchiveAuthStatus;
}) {
  const label = chapterPlan?.ok
    ? sourceLabel(chapterPlan.source)
    : "MangaLib / nHentai / SlashLib / HentaiLib";
  const showLibSocialAuth = !chapterPlan?.ok || chapterPlan.source !== "nhentai";
  return (
    <section
      className="atlas-radius-panel grid self-start gap-3 p-3 shadow-[var(--shadow-border)]"
      style={{ border: `1px solid ${LINE}`, background: CARD }}
    >
      <div className="min-w-0">
        <Eyebrow>{label}</Eyebrow>
        <h2 className="m-0 mt-1 text-[16px] font-semibold tracking-normal" style={{ color: TX }}>
          Queue archive job
        </h2>
      </div>

      <ContentArchiveGuide />

      {showLibSocialAuth ? <LibSocialAuthPanel settings={libSocialSettings} /> : null}

      <form id={ANALYZE_FORM_ID} action="/" className="grid gap-2">
        <label className="grid gap-1 text-xs font-medium" style={{ color: TX }}>
          Source link
          <input
            name="content_archive_input"
            required
            defaultValue={sourceInput}
            placeholder="https://mangalib.org/... / https://nhentai.net/g/... / https://slashlib.me/... / https://hentailib.me/..."
            className="atlas-radius-control h-9 min-h-0 truncate border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ borderColor: LINE, color: TX }}
          />
        </label>
      </form>

      {chapterPlan?.ok === false ? (
        <p className="atlas-radius-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {chapterPlan.message}
        </p>
      ) : null}

      {chapterPlan?.ok && queueForm ? (
        <ChapterQueueForm plan={chapterPlan} queueForm={queueForm} />
      ) : null}

      <ArchiveActionBar canQueue={Boolean(chapterPlan?.ok)} />
    </section>
  );
}

function LibSocialAuthPanel({ settings }: { settings: ContentArchiveAuthStatus }) {
  const ready = readinessBadge(settings.readiness);
  return (
    <details
      className="group atlas-radius-control border"
      style={{ borderColor: LINE, background: "var(--panel)" }}
      open={settings.readiness !== "ready"}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden"
        style={{ color: TX }}
      >
        <span className="font-medium">LibSocial auth</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: ready.color }}>
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: ready.color }}
          />
          {ready.label}
        </span>
      </summary>
      <div className="grid gap-2.5 border-t px-3 py-2.5" style={{ borderColor: LINE }}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]" style={{ color: MUT }}>
          <span>Bearer: {sourceLabelFor(settings.tokenConfigured, settings.tokenSource)}</span>
          <span>Refresh: {sourceLabelFor(settings.refreshTokenConfigured, settings.refreshTokenSource)}</span>
          <span>Expires: {formatDateTime(settings.tokenExpiresAt)}</span>
          <span>Last refresh: {formatDateTime(settings.lastTokenRefreshAt)}</span>
          <span>Image cookie: {sourceLabelFor(settings.imageCookieConfigured, settings.imageCookieSource)}</span>
          <span>Last test: {formatDateTime(settings.lastTestedAt)}</span>
        </div>

        <p className="m-0 text-[11px] leading-5" style={{ color: ready.color }}>
          {settings.readyDetail}
        </p>

        <AuthSaveForm
          action={saveContentArchiveLibSocialBearerToken}
          field="bearer_token"
          clearField="clear_bearer_token"
          label="Bearer token (JWT)"
          placeholder="Paste a long-lived bearer token (simplest setup)"
          test
        />
        <AuthSaveForm
          action={saveContentArchiveLibSocialRefreshToken}
          field="refresh_token"
          clearField="clear_refresh_token"
          label="Refresh token"
          placeholder="Paste once — mangaloader mints bearer tokens from it"
        />
        <AuthSaveForm
          action={saveContentArchiveLibSocialImageCookie}
          field="image_cookie"
          clearField="clear_image_cookie"
          label="Image Cookie header (DDoS-Guard / Server 1–2)"
          placeholder="Paste Cookie header for img hosts from your VPN browser"
        />

        <p className="m-0 text-[11px] leading-5" style={{ color: FAINT }}>
          Not sure where to find these? Open the setup guide above.
        </p>
      </div>
    </details>
  );
}

function AuthSaveForm({
  action,
  field,
  clearField,
  label,
  placeholder,
  test = false,
}: {
  action: (formData: FormData) => void | Promise<void>;
  field: string;
  clearField: string;
  label: string;
  placeholder: string;
  test?: boolean;
}) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="return_to" value={AUTH_RETURN_TO} />
      <label className="grid min-w-[220px] flex-1 gap-1 text-[11px]" style={{ color: MUT }}>
        {label}
        <input
          name={field}
          type="password"
          autoComplete="off"
          placeholder={placeholder}
          className="atlas-radius-control h-8 min-h-0 border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ borderColor: LINE, color: TX }}
        />
      </label>
      <Button type="submit" size="sm" variant="outline">
        Save
      </Button>
      <Button type="submit" name={clearField} value="1" size="sm" variant="ghost">
        Clear
      </Button>
      {test ? (
        <Button type="submit" formAction={testContentArchiveLibSocialAuth} size="sm">
          Test
        </Button>
      ) : null}
    </form>
  );
}

function ChapterQueueForm({
  plan,
  queueForm,
}: {
  plan: Extract<LibSocialArchiveChapterPlan, { ok: true }>;
  queueForm: ContentArchiveQueueFormDefaults;
}) {
  return (
    <form id={QUEUE_FORM_ID} action={startContentArchiveJob} className="grid gap-3">
      <input type="hidden" name="source_input" value={plan.sourceInput} />
      <input type="hidden" name="title" value={plan.title} />
      {plan.coverUrl ? <input type="hidden" name="cover_url" value={plan.coverUrl} /> : null}
      <input type="hidden" name="return_to" value={queueForm.returnTo} />
      <input type="hidden" name="chapter_picker" value="checkboxes" />

      <ContentArchiveQueueControls
        key={queueForm.selectorKey}
        analyzeFormId={ANALYZE_FORM_ID}
        chapters={plan.chapters}
        coverUrl={plan.coverUrl}
        defaultImageServerId={plan.defaultImageServerId}
        distinctChapterCount={queueForm.distinctChapterCount}
        imageServers={plan.imageServers}
        optionCount={queueForm.optionCount}
        source={plan.source}
        title={plan.title}
        titleSizeEstimate={plan.sizeEstimate}
      />
    </form>
  );
}

function ArchiveActionBar({ canQueue }: { canQueue: boolean }) {
  return (
    <div
      className="atlas-radius-panel flex flex-wrap items-center gap-2 border p-2"
      style={{ borderColor: LINE, background: "var(--panel)" }}
    >
      <Button type="submit" form={ANALYZE_FORM_ID} variant="outline" size="sm">
        <Archive aria-hidden className="h-3.5 w-3.5" />
        Analyze
      </Button>
      {canQueue ? (
        <>
          <Button
            type="submit"
            form={QUEUE_FORM_ID}
            name="run_mode"
            value="dry_run"
            variant="outline"
            size="sm"
          >
            Dry run
          </Button>
          <Button type="submit" form={QUEUE_FORM_ID} name="run_mode" value="archive_upload" size="sm">
            Archive
          </Button>
        </>
      ) : null}
    </div>
  );
}

function Feedback({ feedback }: { feedback: ContentArchiveFeedbackView }) {
  if (!feedback) return null;
  const ok = feedback.status === "ok";
  return (
    <p
      className={
        ok
          ? "atlas-radius-control border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
          : "atlas-radius-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      }
    >
      {feedback.message}
      {feedback.runId ? (
        <span className="atlas-num ml-2 font-mono text-xs">{feedback.runId}</span>
      ) : null}
    </p>
  );
}

function readinessBadge(readiness: ContentArchiveAuthStatus["readiness"]): {
  label: string;
  color: string;
} {
  switch (readiness) {
    case "ready":
      return { label: "Ready", color: "#34d399" };
    case "expired":
      return { label: "Token expired", color: "#fbbf24" };
    default:
      return { label: "Not configured", color: "#f87171" };
  }
}

function sourceLabelFor(
  configured: boolean,
  source: ContentArchiveAuthStatus["tokenSource"],
): string {
  if (!configured) return "not set";
  return source === "ui" ? "saved" : source === "env" ? "env" : "not set";
}

function formatDateTime(value: Date | string | null): string {
  if (!value) return "none";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
