import { Archive } from "lucide-react";

import { AdminPageHeader, Eyebrow } from "@/components/design/admin-kit";
import { CARD, FAINT, LINE, MUT, TX } from "@/components/design/kit";
import { Button } from "@/components/ui/button";
import { sourceLabel } from "@/lib/content-archive/planning";
import {
  loadContentArchiveAdminView,
  type ContentArchiveAdminSearchParams,
  type ContentArchiveFeedbackView,
  type ContentArchiveQueueFormDefaults,
  type EnvLibSocialStatus,
  type LibSocialArchiveChapterPlan,
} from "@/server/content-archive/admin-projection";
import { startContentArchiveJob } from "./actions";
import { ContentArchiveRunsPanel } from "./content-archive-runs-panel";
import { ContentArchiveQueueControls } from "./content-archive-queue-controls";

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
  libSocialSettings: EnvLibSocialStatus;
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

      {showLibSocialAuth ? <EnvStatusPanel settings={libSocialSettings} /> : null}

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

      <p className="m-0 text-[11px] leading-5" style={{ color: FAINT }}>
        Output is unencrypted CBZ in the configured Google Drive remote (or a local folder). Files
        are private operator archives.
      </p>
    </section>
  );
}

function EnvStatusPanel({ settings }: { settings: EnvLibSocialStatus }) {
  return (
    <details
      className="group atlas-radius-control border"
      style={{ borderColor: LINE, background: "var(--panel)" }}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden"
        style={{ color: TX }}
      >
        <span className="font-medium">LibSocial auth (.env.local)</span>
        <span className="text-[11px]" style={{ color: FAINT }}>
          {authStatusLabel(settings)}
        </span>
      </summary>
      <div className="grid gap-2 border-t px-3 py-2" style={{ borderColor: LINE }}>
        <div className="grid grid-cols-2 gap-2 text-[11px]" style={{ color: MUT }}>
          <span>Bearer: {settings.tokenConfigured ? settings.tokenSource : "not set"}</span>
          <span>Refresh: {settings.refreshTokenConfigured ? "env" : "not set"}</span>
          <span>Expires: {formatDateTime(settings.tokenExpiresAt)}</span>
          <span>Image cookie: {settings.imageCookieConfigured ? "env" : "not set"}</span>
        </div>
        <p className="m-0 text-[11px] leading-5" style={{ color: FAINT }}>
          Set <code>ATLAS_CONTENT_ARCHIVE_MANGALIB_BEARER_TOKEN</code> (or{" "}
          <code>MANGALIB_REFRESH_TOKEN</code>) and <code>ATLAS_CONTENT_ARCHIVE_IMAGE_COOKIE</code> in{" "}
          <code>.env.local</code>, then restart the dev server. Server 1/2 image hosts sit behind
          DDoS-Guard, so export the Cookie header from a browser on your VPN IP.
        </p>
      </div>
    </details>
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

function authStatusLabel(settings: EnvLibSocialStatus): string {
  if (settings.tokenConfigured) {
    const exp = settings.tokenExpiresAt;
    if (exp && Number.isFinite(exp.getTime()) && exp.getTime() <= Date.now()) {
      return "bearer expired";
    }
    return "bearer ready";
  }
  if (settings.refreshTokenConfigured) return "refresh ready";
  return "not configured";
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
