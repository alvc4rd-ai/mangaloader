/* Stateless admin chrome primitives for mangaloader (ported subset of the
 * Atlas admin kit). Only the header + eyebrow the content-archive page needs;
 * the source/severity badges were dropped along with the Atlas design tokens
 * module they depended on. */

import type { ReactNode } from "react";
import { FAINT, LINE, MONO, MUT, TX } from "./kit";

export function Eyebrow({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: color || FAINT,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

export function AdminPageHeader({
  eyebrow,
  title,
  meta,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      className="flex flex-wrap items-end gap-x-4 gap-y-3 pb-4"
      style={{ borderBottom: `1px solid ${LINE}` }}
    >
      <div className="grid min-w-0 gap-1.5">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1
            className="atlas-text-balance m-0 text-[22px] font-bold tracking-normal"
            style={{ color: TX }}
          >
            {title}
          </h1>
          {meta ? (
            <span className="text-[12.5px]" style={{ color: FAINT }}>
              {meta}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="atlas-text-pretty m-0 max-w-[70ch] text-[13px]" style={{ color: MUT }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
