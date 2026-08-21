import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, FileJson, FileSpreadsheet } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UserMenu } from "@/components/UserMenu";
import {
  normalizeAnswer,
  normalizeButtonAnswer,
  normalizePlayerList,
  type LocalSubmissionData,
  type LocalAnswerValue,
} from "@/lib/local-storage";
import { formatBerlinDate, formatBerlinTime } from "@/lib/timezones";

// German local time, auto-adjusted for CET/CEST — not the server's own
// timezone, which may not be Germany's at all depending on where it's hosted.
function formatDate(date: Date) {
  return `${formatBerlinDate(date)} · ${formatBerlinTime(date)}`;
}

function AnswerValue({ value }: { value: LocalAnswerValue }) {
  if (!value) return <>—</>;
  if (value.kind === "file") {
    return (
      <a
        href={`/api/uploads/${value.storedPath}`}
        className="inline-flex items-center gap-1.5 text-royal-600 hover:underline"
      >
        <Download size={12} />
        {value.originalName}
      </a>
    );
  }
  return <>{value.text || "—"}</>;
}

export default async function ResponsesPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/admin/forms/${formId}/responses`);
  }

  const form = await prisma.form.findUnique({ where: { id: formId } });
  if (
    !form ||
    form.adminId !== session.user.id ||
    form.storageProvider !== "local"
  ) {
    notFound();
  }

  const submissions = await prisma.submission.findMany({
    where: { formId },
    orderBy: { submittedAt: "desc" },
  });

  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-royal-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-3">
          <Link
            href="/admin/forms"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-royal-500 hover:bg-royal-50"
            aria-label="Back to Manage forms"
          >
            <ArrowLeft size={18} />
          </Link>
          <span className="text-lg font-semibold text-royal-950">
            {form.title} — Responses
          </span>
          <div className="flex-1" />
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-royal-500">
            {submissions.length} response{submissions.length === 1 ? "" : "s"} ·
            stored locally on this server, not through Google.
          </p>
          {submissions.length > 0 && (
            <div className="flex items-center gap-2">
              <a
                href={`/api/forms/${formId}/export?format=csv`}
                className="flex items-center gap-1.5 rounded-full border border-royal-200 px-3 py-1.5 text-xs font-medium text-royal-600 hover:bg-royal-50"
              >
                <FileSpreadsheet size={12} />
                Export CSV
              </a>
              <a
                href={`/api/forms/${formId}/export?format=json`}
                className="flex items-center gap-1.5 rounded-full border border-royal-200 px-3 py-1.5 text-xs font-medium text-royal-600 hover:bg-royal-50"
              >
                <FileJson size={12} />
                Export JSON
              </a>
            </div>
          )}
        </div>

        {submissions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-royal-200 bg-white p-8 text-center text-sm text-royal-400">
            No responses yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {submissions.map((submission) => {
              const data = JSON.parse(submission.dataJson) as LocalSubmissionData;
              return (
                <div
                  key={submission.id}
                  className="rounded-xl border border-royal-100 bg-white p-5 shadow-sm"
                >
                  <p className="mb-3 flex items-center gap-2 text-xs font-medium text-royal-400">
                    {formatDate(submission.submittedAt)}
                    {data.accessUsername && (
                      <span className="rounded-full bg-royal-100 px-2 py-0.5 text-royal-600">
                        {data.accessUsername}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-col gap-3">
                    {Object.entries(data.answers).map(([fieldId, raw]) => {
                      const answer = normalizeAnswer(fieldId, raw);
                      return (
                        <div key={fieldId}>
                          <p className="text-xs font-medium text-royal-500">
                            {answer.label}
                          </p>
                          <div className="mt-0.5 text-sm text-royal-950">
                            <AnswerValue value={answer.value} />
                          </div>
                        </div>
                      );
                    })}
                    {data.playerListEntries &&
                      Object.entries(data.playerListEntries).map(
                        ([fieldId, raw]) => {
                          const { listLabel, entries } = normalizePlayerList(
                            fieldId,
                            raw,
                          );
                          return (
                          <div key={fieldId}>
                            <p className="text-xs font-medium text-royal-500">
                              {listLabel}
                            </p>
                            <div className="mt-1 flex flex-col gap-2">
                              {entries.map((row, i) => (
                                <div
                                  key={i}
                                  className="rounded-lg border border-royal-100 p-2.5 text-sm"
                                >
                                  <p className="mb-1 text-xs font-semibold text-royal-500">
                                    Entry {i + 1}
                                  </p>
                                  <div className="flex flex-col gap-1">
                                    {row.map((col, j) => (
                                      <div key={j} className="text-royal-950">
                                        <span className="text-royal-500">
                                          {col.label}:{" "}
                                        </span>
                                        <AnswerValue value={col.value} />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          );
                        },
                      )}
                    {data.buttonAnswers &&
                      Object.entries(data.buttonAnswers).map(([fieldId, raw]) => {
                        const { groupLabel, entries } = normalizeButtonAnswer(
                          fieldId,
                          raw,
                        );
                        return (
                          <div key={fieldId}>
                            <p className="text-xs font-medium text-royal-500">
                              {groupLabel}
                            </p>
                            <div className="mt-1 flex flex-col gap-1 rounded-lg border border-royal-100 p-2.5 text-sm">
                              {entries.map((col, j) => (
                                <div key={j} className="text-royal-950">
                                  <span className="text-royal-500">
                                    {col.label}:{" "}
                                  </span>
                                  <AnswerValue value={col.value} />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
