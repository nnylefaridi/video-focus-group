import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile, liveProfiles, toCard } from "@/experts/load";
import { Avatar } from "@/components/Avatar";

const CONFIDENCE: Record<string, string> = {
  well_documented: "Well documented",
  stated_once: "Stated in one source",
  disputed_source: "Source of uncertain authenticity",
};

export function generateStaticParams() {
  return liveProfiles().map((p) => ({ id: p.id }));
}

async function Profile({ params }: { params: PageProps<"/reviewers/[id]">["params"] }) {
  const { id } = await params;
  const p = getProfile(id);
  if (!p) notFound();
  const sources = new Map(p.sources.map((s) => [s.id, s]));
  const principles = p.principles.filter((x) => x.status === "verified");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <Link href="/" className="text-sm text-ink-soft hover:text-ink">
        Back
      </Link>

      <div className="mt-8 flex items-center gap-5">
        <Avatar card={toCard(p)} size={84} />
        <div>
          <h1 className="font-serif text-[2rem] leading-tight text-ink">{p.name}</h1>
          <p className="text-ink-soft">{p.field}</p>
        </div>
      </div>
      <p className="mt-6 text-lg leading-relaxed text-ink">{p.lens}</p>
      <p className="mt-3 text-ink-soft">{p.bio}</p>
      <p className="mt-4 rounded-xl bg-paper-deep px-4 py-3 text-sm text-ink-soft">
        On your panel, {p.name.split(" ")[0]} is an AI interpretation built only from the published work listed below. They don&apos;t take part in or
        endorse any review.
      </p>

      <section className="mt-12">
        <h2 className="font-serif text-2xl text-ink">The questions they ask first</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-ink">
          {p.reasoningPattern.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl text-ink">Documented ideas they review with</h2>
        <ul className="mt-4 space-y-3">
          {principles.map((pr) => (
            <li key={pr.id} className="rounded-2xl border border-line bg-card p-4">
              <p className="text-ink">{pr.statement}</p>
              <p className="mt-2 text-sm text-ink-soft">
                {CONFIDENCE[pr.confidence]} ·{" "}
                {pr.refs.map((r, i) => {
                  const s = sources.get(r.source);
                  return (
                    <span key={i}>
                      {i > 0 && "; "}
                      {s ? (
                        <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
                          {s.title}
                        </a>
                      ) : (
                        r.source
                      )}
                      {r.locator ? `, ${r.locator}` : ""}
                    </span>
                  );
                })}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {p.frameworks.length > 0 && (
        <section className="mt-12">
          <h2 className="font-serif text-2xl text-ink">Frameworks</h2>
          <ul className="mt-4 space-y-4">
            {p.frameworks.map((f) => (
              <li key={f.id}>
                <p className="font-medium text-ink">{f.name}</p>
                <p className="mt-1 text-ink">{f.steps.join(" → ")}</p>
                <p className="mt-1.5 text-sm text-ink-soft">How the panel applies it to video (our interpretation): {f.videoApplication}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.limitations.length > 0 && (
        <section className="mt-12">
          <h2 className="font-serif text-2xl text-ink">Outside their lane</h2>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-ink-soft">
            {p.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12">
        <h2 className="font-serif text-2xl text-ink">Sources</h2>
        <ul className="mt-4 space-y-2">
          {p.sources.map((s) => (
            <li key={s.id} className="text-ink-soft">
              <a href={s.url} target="_blank" rel="noreferrer" className="text-ink underline decoration-line-strong underline-offset-2">
                {s.title}
              </a>
              {s.date ? ` (${s.date})` : ""} · {s.kind === "primary" ? "their own words or work" : "summary by someone else"}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function ReviewerPage(props: PageProps<"/reviewers/[id]">) {
  return (
    <Suspense>
      <Profile params={props.params} />
    </Suspense>
  );
}
