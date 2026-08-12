"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, FileText, Check, CircleCheck, CircleAlert, Star } from "lucide-react";
import type { FormField, PlayerListColumn, DropdownField } from "@/types/form-builder";
import type { FormTheme } from "@/types/theme";
import { initialSubmitState, type SubmitState } from "@/types/submission";
import { applyOperation, formatComputedResult } from "@/lib/computed";
import { HeaderPreview } from "@/components/design/HeaderPreview";
import { MarkdownContent, InlineMarkdown } from "@/components/shared/MarkdownContent";
import { SignaturePad } from "./SignaturePad";

async function noopSubmitAction(): Promise<SubmitState> {
  return initialSubmitState;
}

interface FormSection {
  title: string | null;
  description: string;
  color?: string;
  fields: FormField[];
}

function splitIntoSections(fields: FormField[]): FormSection[] {
  const sections: FormSection[] = [{ title: null, description: "", fields: [] }];
  for (const field of fields) {
    if (field.type === "section-break") {
      sections.push({
        title: field.label || "Untitled section",
        description: field.description,
        color: field.color,
        fields: [],
      });
    } else {
      sections[sections.length - 1].fields.push(field);
    }
  }
  const nonEmpty = sections.filter((s) => s.fields.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : sections;
}

// A structured (not React-specific) representation of one answer's value,
// so the exact same data can drive both the on-screen review card and the
// PDF export without keeping two separate extraction passes in sync.
type ReviewValue =
  | { kind: "text"; text: string }
  | { kind: "image"; dataUrl: string; alt: string }
  | { kind: "rows"; entries: { label: string; value: string }[][] };

interface ReviewItem {
  id: string;
  label: string;
  value: ReviewValue;
}

interface ReviewSection {
  title: string | null;
  items: ReviewItem[];
}

function reviewPlayerListRows(
  field: Extract<FormField, { type: "player-list" }>,
  formData: FormData,
) {
  const rows: { label: string; value: string }[][] = [];
  for (let i = 0; i < field.playerCount; i++) {
    const row = field.columns.map((column) => {
      const key = `player-${i}-${column.id}`;
      if (column.type === "photo") {
        const file = formData.get(key);
        return {
          label: column.label,
          value: file instanceof File && file.size > 0 ? file.name : "",
        };
      }
      return { label: column.label, value: String(formData.get(key) ?? "") };
    });
    if (row.some((c) => c.value)) rows.push(row);
  }
  return rows;
}

function reviewValueForField(field: FormField, formData: FormData): ReviewValue {
  switch (field.type) {
    case "dropdown": {
      const otherText = String(formData.get(`${field.id}__other`) ?? "");
      if (field.allowMultiple) {
        const resolved = formData
          .getAll(field.id)
          .map(String)
          .map((v) => (v === "__other__" ? otherText : v))
          .filter(Boolean);
        return { kind: "text", text: resolved.length ? resolved.join(", ") : "—" };
      }
      const selected = String(formData.get(field.id) ?? "");
      const resolved = selected === "__other__" ? otherText : selected;
      return { kind: "text", text: resolved || "—" };
    }
    case "photo":
    case "document": {
      const file = formData.get(field.id);
      return {
        kind: "text",
        text: file instanceof File && file.size > 0 ? file.name : "No file uploaded",
      };
    }
    case "signature": {
      const raw = formData.get(field.id);
      const dataUrl = typeof raw === "string" ? raw : "";
      return dataUrl
        ? { kind: "image", dataUrl, alt: "Signature" }
        : { kind: "text", text: "Not signed" };
    }
    default:
      return { kind: "text", text: String(formData.get(field.id) ?? "") || "—" };
  }
}

function reviewValueNode(value: ReviewValue): ReactNode {
  switch (value.kind) {
    case "text":
      return value.text;
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value.dataUrl}
          alt={value.alt}
          className="h-16 rounded border border-royal-100 bg-white"
        />
      );
    case "rows":
      return value.entries.length === 0 ? (
        "No entries"
      ) : (
        <div className="flex flex-col gap-1.5">
          {value.entries.map((row, i) => (
            <div key={i} className="text-xs text-royal-700">
              <span className="font-medium text-royal-500">Entry {i + 1}: </span>
              {row.map((c) => `${c.label}: ${c.value || "—"}`).join(", ")}
            </div>
          ))}
        </div>
      );
  }
}

function buildReviewSections(
  sections: FormSection[],
  formData: FormData,
): ReviewSection[] {
  return sections
    .map((section) => {
      const items: ReviewItem[] = [];
      for (const field of section.fields) {
        if (field.type === "static-text" || field.type === "section-break") {
          continue;
        }
        if (field.type === "computed" && !field.showOnForm) continue;
        if (field.type === "player-list") {
          items.push({
            id: field.id,
            label: field.label || "Untitled question",
            value: { kind: "rows", entries: reviewPlayerListRows(field, formData) },
          });
          continue;
        }
        items.push({
          id: field.id,
          label: field.label || "Untitled question",
          value: reviewValueForField(field, formData),
        });
      }
      return { title: section.title, items };
    })
    .filter((s) => s.items.length > 0);
}

export function FormRenderer({
  title,
  fields,
  theme,
  submitAction,
}: {
  title: string;
  fields: FormField[];
  theme?: FormTheme;
  submitAction?: (
    prevState: SubmitState,
    formData: FormData,
  ) => Promise<SubmitState>;
}) {
  const sections = splitIntoSections(fields);
  const [step, setStep] = useState(0);
  const currentStep = Math.min(step, sections.length - 1);
  const isMultiStep = sections.length > 1;
  const isLastStep = currentStep === sections.length - 1;
  const formRef = useRef<HTMLFormElement>(null);
  const [showReview, setShowReview] = useState(false);
  const [reviewSections, setReviewSections] = useState<ReviewSection[]>([]);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // Guards against a fast reflexive second click landing on the button
  // that just replaced whatever was in that same screen spot a moment
  // earlier (Next → Review, or Review → Done) — without this, that click
  // could skip straight past the review screen the user hasn't seen yet.
  const [justEnteredReview, setJustEnteredReview] = useState(false);
  const [state, formAction, isPending] = useActionState(
    submitAction ?? noopSubmitAction,
    initialSubmitState,
  );

  function tryEnterReview() {
    const formEl = formRef.current;
    if (!formEl || !formEl.reportValidity()) return;
    setReviewSections(buildReviewSections(sections, new FormData(formEl)));
    setShowReview(true);
    setJustEnteredReview(true);
    window.setTimeout(() => setJustEnteredReview(false), 400);
  }

  async function downloadReviewAsPdf() {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const { jsPDF, GState } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 48;
      const contentWidth = pageWidth - margin * 2;
      const headerHeight = 46;
      const bottomLimit = pageHeight - margin;
      let y = margin + headerHeight;

      // Admin's own form logo if they set one, otherwise fall back to the
      // Codactis logo — fetched as a data URL since jsPDF can't reference
      // a plain file path.
      const watermarkDataUrl =
        theme?.logo.dataUrl ||
        (await fetch("/logo/codactics.png")
          .then((res) => res.blob())
          .then(
            (blob) =>
              new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              }),
          )
          .catch(() => null));

      // jsPDF's built-in fonts don't reliably render an em dash.
      const pdfSafe = (text: string) => text.replace(/—/g, "-");

      function ensureSpace(needed: number) {
        if (y + needed > bottomLimit) {
          pdf.addPage();
          y = margin + headerHeight;
        }
      }

      function writeLines(text: string, size: number, color: number) {
        pdf.setFontSize(size);
        pdf.setTextColor(color);
        const lines = pdf.splitTextToSize(pdfSafe(text), contentWidth) as string[];
        for (const line of lines) {
          ensureSpace(size + 4);
          pdf.text(line, margin, y);
          y += size + 4;
        }
      }

      for (const section of reviewSections) {
        if (section.title) {
          ensureSpace(30);
          pdf.setFont("helvetica", "bold");
          writeLines(section.title, 13, 20);
          pdf.setFont("helvetica", "normal");
          y += 4;
        }

        for (const item of section.items) {
          ensureSpace(28);
          pdf.setFont("helvetica", "bold");
          writeLines(item.label, 9, 110);
          pdf.setFont("helvetica", "normal");

          if (item.value.kind === "text") {
            writeLines(item.value.text, 11, 20);
          } else if (item.value.kind === "image") {
            try {
              const props = pdf.getImageProperties(item.value.dataUrl);
              const imgWidth = 140;
              const imgHeight = (props.height * imgWidth) / props.width;
              ensureSpace(imgHeight);
              pdf.addImage(item.value.dataUrl, margin, y, imgWidth, imgHeight);
              y += imgHeight + 4;
            } catch {
              writeLines("Signed", 11, 20);
            }
          } else {
            if (item.value.entries.length === 0) {
              writeLines("No entries", 11, 20);
            } else {
              item.value.entries.forEach((row, i) => {
                const line = `Entry ${i + 1}: ${row
                  .map((c) => `${c.label}: ${c.value || "—"}`)
                  .join(", ")}`;
                writeLines(line, 10, 20);
              });
            }
          }
          y += 8;
        }
        y += 6;
      }

      // Applied per-page after all content is written, since pages are
      // only created on demand above and we don't know the final count
      // (or want a header/watermark/footer on every one of them) until now.
      const downloadedAt = `Downloaded ${new Date().toLocaleString()}`;
      const totalPages = pdf.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        pdf.setPage(p);

        if (watermarkDataUrl) {
          try {
            const props = pdf.getImageProperties(watermarkDataUrl);
            const maxDim = 220;
            let wmWidth = maxDim;
            let wmHeight = (props.height * wmWidth) / props.width;
            if (wmHeight > maxDim) {
              wmHeight = maxDim;
              wmWidth = (props.width * wmHeight) / props.height;
            }
            pdf.saveGraphicsState();
            pdf.setGState(new GState({ opacity: 0.12 }));
            pdf.addImage(
              watermarkDataUrl,
              (pageWidth - wmWidth) / 2,
              (pageHeight - wmHeight) / 2,
              wmWidth,
              wmHeight,
            );
            pdf.restoreGraphicsState();
          } catch (err) {
            console.error("PDF watermark failed to draw", err);
          }
        }

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(14);
        pdf.setTextColor(20);
        pdf.text(title || "Untitled form", margin, margin);
        pdf.setDrawColor(180);
        pdf.setLineWidth(1);
        pdf.line(margin, margin + 10, pageWidth - margin, margin + 10);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(90);
        pdf.text(downloadedAt, margin, pageHeight - 32);
        pdf.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 32, {
          align: "right",
        });
        pdf.text(
          "Developed and maintained by CODACTICS  •  http://forms.codactics.com/",
          pageWidth / 2,
          pageHeight - 18,
          { align: "center" },
        );
      }

      const safeTitle = (title || "form").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      pdf.save(`${safeTitle}-submission.pdf`);
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {theme ? (
        <HeaderPreview theme={theme} title={title} />
      ) : (
        <div className="rounded-2xl border-t-4 border-royal-600 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-royal-950">
            <InlineMarkdown content={title || "Untitled form"} />
          </h1>
        </div>
      )}

      {theme?.note && (
        <div className="rounded-xl border border-royal-100 bg-white p-4">
          <MarkdownContent content={theme.note} />
        </div>
      )}

      {state.status === "success" ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-royal-100 bg-white p-10 text-center shadow-sm">
          <CircleCheck size={28} className="text-royal-600" />
          <h2 className="text-lg font-semibold text-royal-950">
            Response recorded
          </h2>
          <p className="max-w-sm text-sm text-royal-500">
            Thanks — your submission has been saved.
          </p>
          <button
            type="button"
            disabled={downloadingPdf}
            onClick={downloadReviewAsPdf}
            className="mt-1 rounded-full border border-royal-200 px-6 py-2.5 text-sm font-medium text-royal-600 transition-colors hover:bg-royal-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloadingPdf ? "Preparing…" : "Download PDF"}
          </button>
        </div>
      ) : fields.length === 0 ? (
        <p className="rounded-xl border border-dashed border-royal-200 bg-white p-8 text-center text-sm text-royal-400">
          This form doesn't have any fields yet.
        </p>
      ) : (
        <form ref={formRef} className="flex flex-col gap-4" action={formAction}>
          {state.status === "error" && state.message && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <CircleAlert size={16} className="shrink-0" />
              {state.message}
            </div>
          )}

          {!showReview && isMultiStep && (
            <div className="flex items-center justify-center gap-2 pb-1">
              {sections.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full ${
                    i === currentStep ? "bg-royal-600" : "bg-royal-200"
                  }`}
                />
              ))}
            </div>
          )}

          {sections.map((section, i) => (
            <div
              key={i}
              className={
                !showReview && i === currentStep
                  ? "flex flex-col gap-4"
                  : "hidden"
              }
            >
              {section.title && (
                <div>
                  <h2
                    className="text-lg font-semibold text-royal-950"
                    style={section.color ? { color: section.color } : undefined}
                  >
                    {section.title}
                  </h2>
                  {section.description && (
                    <div className="mt-1">
                      <MarkdownContent
                        content={section.description}
                        color={section.color}
                      />
                    </div>
                  )}
                </div>
              )}
              {section.fields.map((field) => (
                <FieldRenderer key={field.id} field={field} />
              ))}
            </div>
          ))}

          {showReview && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-royal-100 bg-white p-5 shadow-sm">
                <h2 className="mb-1 text-lg font-semibold text-royal-950">
                  Review your answers
                </h2>
                <p className="mb-4 text-sm text-royal-500">
                  Check everything below before finishing. Use Edit to change
                  anything.
                </p>
                <div className="flex flex-col gap-5">
                  {reviewSections.map((section, i) => (
                    <div key={i} className="flex flex-col gap-3">
                      {section.title && (
                        <h3 className="text-sm font-semibold text-royal-800">
                          {section.title}
                        </h3>
                      )}
                      {section.items.map((item) => (
                        <div
                          key={item.id}
                          className="border-b border-royal-50 pb-2 last:border-0 last:pb-0"
                        >
                          <p className="text-xs font-medium text-royal-500">
                            {item.label}
                          </p>
                          <div className="mt-0.5 text-sm text-royal-950">
                            {reviewValueNode(item.value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setShowReview(false);
                    setStep(0);
                  }}
                  className="rounded-full border border-royal-200 px-6 py-2.5 text-sm font-medium text-royal-600 transition-colors hover:bg-royal-50"
                >
                  Edit
                </button>
                <button
                  type="submit"
                  disabled={isPending || justEnteredReview}
                  className="rounded-full bg-royal-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-royal-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? "Submitting…" : "Done"}
                </button>
              </div>
            </div>
          )}

          {!showReview && (
            <div className="mt-2 flex items-center justify-between">
              {isMultiStep && !isLastStep ? (
                <>
                  <button
                    type="button"
                    disabled={currentStep === 0}
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    className="rounded-full border border-royal-200 px-6 py-2.5 text-sm font-medium text-royal-600 transition-colors hover:bg-royal-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.min(sections.length - 1, s + 1))}
                    className="rounded-full bg-royal-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-royal-700"
                  >
                    Next
                  </button>
                </>
              ) : isMultiStep ? (
                <>
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    className="rounded-full border border-royal-200 px-6 py-2.5 text-sm font-medium text-royal-600 transition-colors hover:bg-royal-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={tryEnterReview}
                    className="rounded-full bg-royal-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-royal-700"
                  >
                    Review
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={tryEnterReview}
                    className="rounded-full bg-royal-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-royal-700"
                  >
                    Review
                  </button>
                  <button
                    type="reset"
                    className="rounded-full border border-royal-200 px-6 py-2.5 text-sm font-medium text-royal-600 transition-colors hover:bg-royal-50"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          )}

          {!showReview && isMultiStep && (
            <button
              type="reset"
              onClick={() => setStep(0)}
              className="self-center text-xs font-medium text-royal-400 hover:text-royal-600 hover:underline"
            >
              Clear form
            </button>
          )}
        </form>
      )}
    </div>
  );
}

function FieldCard({
  label,
  required,
  children,
}: {
  label: string;
  required: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-royal-100 bg-white p-5 shadow-sm">
      <label className="mb-2 block text-sm font-medium text-royal-950">
        {label || "Untitled question"}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function FieldRenderer({ field }: { field: FormField }) {
  switch (field.type) {
    case "short-text":
      return (
        <FieldCard label={field.label} required={field.required}>
          <input
            name={field.id}
            required={field.required}
            className="w-full rounded-md border border-royal-200 px-3 py-2 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
          />
        </FieldCard>
      );
    case "long-text":
      return (
        <FieldCard label={field.label} required={field.required}>
          <textarea
            name={field.id}
            required={field.required}
            rows={3}
            className="w-full rounded-md border border-royal-200 px-3 py-2 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
          />
        </FieldCard>
      );
    case "number":
      return (
        <FieldCard label={field.label} required={field.required}>
          <input
            type="number"
            name={field.id}
            required={field.required}
            min={field.min}
            max={field.max}
            className="w-40 rounded-md border border-royal-200 px-3 py-2 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
          />
        </FieldCard>
      );
    case "email":
      return (
        <FieldCard label={field.label} required={field.required}>
          <input
            type="email"
            name={field.id}
            required={field.required}
            placeholder="name@example.com"
            className="w-full rounded-md border border-royal-200 px-3 py-2 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
          />
        </FieldCard>
      );
    case "phone":
      return (
        <FieldCard label={field.label} required={field.required}>
          <input
            type="tel"
            name={field.id}
            required={field.required}
            placeholder="+1 555 000 1234"
            className="w-full rounded-md border border-royal-200 px-3 py-2 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
          />
        </FieldCard>
      );
    case "link":
      return (
        <FieldCard label={field.label} required={field.required}>
          <input
            type="url"
            name={field.id}
            required={field.required}
            placeholder="https://instagram.com/yourhandle"
            className="w-full rounded-md border border-royal-200 px-3 py-2 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
          />
        </FieldCard>
      );
    case "date":
      return (
        <FieldCard label={field.label} required={field.required}>
          <input
            type="date"
            name={field.id}
            required={field.required}
            min={field.min}
            max={field.max}
            className="w-48 rounded-md border border-royal-200 px-3 py-2 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
          />
        </FieldCard>
      );
    case "photo":
      return (
        <FieldCard label={field.label} required={field.required}>
          <PhotoUploadInput name={field.id} required={field.required} />
        </FieldCard>
      );
    case "document":
      return (
        <FieldCard label={field.label} required={field.required}>
          <DocumentUploadInput name={field.id} required={field.required} />
        </FieldCard>
      );
    case "signature":
      return (
        <FieldCard label={field.label} required={field.required}>
          <SignaturePad name={field.id} />
        </FieldCard>
      );
    case "dropdown":
      return (
        <FieldCard label={field.label} required={field.required}>
          <DropdownFieldInput field={field} />
        </FieldCard>
      );
    case "multiple-choice":
      return (
        <FieldCard label={field.label} required={field.required}>
          <div className="flex flex-col gap-2">
            {field.options.map((option, i) => (
              <label
                key={i}
                className="flex items-center gap-2 text-sm text-royal-800"
              >
                <input
                  type="radio"
                  name={field.id}
                  value={option}
                  required={field.required}
                />
                {option}
              </label>
            ))}
          </div>
        </FieldCard>
      );
    case "checkbox":
      return (
        <FieldCard label={field.label} required={field.required}>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-royal-800">
              <input
                type="radio"
                name={field.id}
                value={field.yesLabel}
                required={field.required}
              />
              {field.yesLabel}
            </label>
            <label className="flex items-center gap-2 text-sm text-royal-800">
              <input type="radio" name={field.id} value={field.noLabel} />
              {field.noLabel}
            </label>
          </div>
        </FieldCard>
      );
    case "rating":
      return (
        <FieldCard label={field.label} required={field.required}>
          {field.style === "stars" ? (
            <StarRatingInput name={field.id} max={field.max} />
          ) : (
            <SliderRatingInput
              name={field.id}
              min={field.min}
              max={field.max}
            />
          )}
        </FieldCard>
      );
    case "computed":
      return field.showOnForm ? (
        <FieldCard label={field.label} required={false}>
          <ComputedFieldDisplay field={field} />
        </FieldCard>
      ) : (
        <div className="hidden">
          <ComputedFieldDisplay field={field} />
        </div>
      );
    case "player-list":
      return <PlayerListRenderer field={field} />;
    case "static-text":
      return field.content ? (
        <div className="rounded-xl border border-royal-100 bg-royal-50/60 p-5">
          <MarkdownContent content={field.content} color={field.color} />
        </div>
      ) : null;
    case "section-break":
      return null;
  }
}

function StarRatingInput({ name, max }: { name: string; max: number }) {
  const count = Math.max(1, Math.min(max, 10));
  const [value, setValue] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const display = hovered ?? value;
  const hiddenRef = useRef<HTMLInputElement>(null);

  // The hidden input's value is set by React, not real typing, so it never
  // fires a native "input" event on its own — dispatch one manually so any
  // Computed field listening for changes on this field (by name) still
  // reacts, the same way it would to a real text/range input.
  useEffect(() => {
    hiddenRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [value]);

  // A native form reset only resets real HTML controls — it has no idea
  // this React state exists, so without this the stars would stay filled
  // in after clicking "Clear."
  useEffect(() => {
    const formEl = hiddenRef.current?.closest("form");
    if (!formEl) return;
    const handleReset = () => setValue(0);
    formEl.addEventListener("reset", handleReset);
    return () => formEl.removeEventListener("reset", handleReset);
  }, []);

  return (
    <div className="flex items-center gap-1">
      <input
        ref={hiddenRef}
        type="hidden"
        name={name}
        value={value || ""}
        readOnly
      />
      {Array.from({ length: count }).map((_, i) => {
        const starValue = i + 1;
        const filled = starValue <= display;
        return (
          <button
            key={i}
            type="button"
            onClick={() => setValue(starValue === value ? 0 : starValue)}
            onMouseEnter={() => setHovered(starValue)}
            onMouseLeave={() => setHovered(null)}
            className={`transition-colors ${filled ? "text-royal-500" : "text-royal-300"} hover:text-royal-500`}
            aria-label={`${starValue} out of ${count}`}
          >
            <Star size={24} fill={filled ? "currentColor" : "none"} />
          </button>
        );
      })}
      {value > 0 && (
        <span className="ml-2 text-xs text-royal-400">
          {value} / {count}
        </span>
      )}
    </div>
  );
}

function SliderRatingInput({
  name,
  min,
  max,
}: {
  name: string;
  min: number;
  max: number;
}) {
  const [value, setValue] = useState(min);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const formEl = inputRef.current?.closest("form");
    if (!formEl) return;
    const handleReset = () => setValue(min);
    formEl.addEventListener("reset", handleReset);
    return () => formEl.removeEventListener("reset", handleReset);
  }, [min]);

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="range"
        name={name}
        min={min}
        max={max}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full max-w-xs accent-royal-600"
      />
      <span className="w-10 text-center text-sm font-medium text-royal-700">
        {value}
      </span>
    </div>
  );
}

function ComputedFieldDisplay({
  field,
}: {
  field: Extract<FormField, { type: "computed" }>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState(0);

  useEffect(() => {
    const formEl = containerRef.current?.closest("form");
    if (!formEl) return;

    function recompute() {
      const values = field.terms.map((term) => {
        if (term.type === "constant") return term.value;
        const el = formEl!.querySelector(
          `[name="${term.fieldId}"]`,
        ) as HTMLInputElement | null;
        const num = el ? parseFloat(el.value) : NaN;
        return Number.isFinite(num) ? num : 0;
      });
      setResult(applyOperation(field.operation, values));
    }

    recompute();
    const listenTo = field.terms
      .filter((t) => t.type === "field")
      .map((t) => formEl!.querySelector(`[name="${t.fieldId}"]`))
      .filter((el): el is Element => el !== null);
    listenTo.forEach((el) => el.addEventListener("input", recompute));

    // On a native form reset, the referenced controls' values are only
    // guaranteed to be back at their defaults *after* this event finishes
    // dispatching — recompute on the next tick rather than reading stale
    // values synchronously here.
    function handleFormReset() {
      setTimeout(recompute, 0);
    }
    formEl.addEventListener("reset", handleFormReset);

    return () => {
      listenTo.forEach((el) => el.removeEventListener("input", recompute));
      formEl.removeEventListener("reset", handleFormReset);
    };
  }, [field]);

  // Propagate to any Computed field chained onto this one, same trick as
  // the star rating's hidden input.
  useEffect(() => {
    hiddenRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [result]);

  return (
    <div ref={containerRef}>
      <input
        ref={hiddenRef}
        type="hidden"
        name={field.id}
        value={formatComputedResult(result)}
        readOnly
      />
      <div className="rounded-md border border-royal-200 bg-royal-50/60 px-4 py-3 text-lg font-semibold text-royal-950">
        {formatComputedResult(result)}
      </div>
    </div>
  );
}

const PHOTO_MIME_TYPES = ["image/png", "image/jpeg"];

function PhotoUploadInput({
  required,
  name,
}: {
  required: boolean;
  name?: string;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setFileName(null);
      setError(null);
      return;
    }
    if (!PHOTO_MIME_TYPES.includes(file.type)) {
      setError("Please upload a PNG or JPEG photo.");
      setFileName(null);
      e.target.value = "";
      return;
    }
    setError(null);
    setFileName(file.name);
  }

  // The browser does clear the file input itself on reset, but our
  // "Uploaded: ..." label is separate React state that doesn't know that
  // happened unless we're told explicitly.
  useEffect(() => {
    const formEl = inputRef.current?.closest("form");
    if (!formEl) return;
    const handleReset = () => {
      setFileName(null);
      setError(null);
    };
    formEl.addEventListener("reset", handleReset);
    return () => formEl.removeEventListener("reset", handleReset);
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-royal-300 bg-royal-50/40 px-4 py-6 text-royal-500 transition-colors hover:bg-royal-50">
        <Image size={18} />
        <span className="text-sm">
          {fileName ? "Click to replace photo" : "Click to upload a photo"}
        </span>
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept="image/png,image/jpeg"
          required={required}
          onChange={handleChange}
          className="hidden"
        />
      </label>
      {fileName && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-green-600">
          <Check size={12} />
          Uploaded: {fileName}
        </p>
      )}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

function DocumentUploadInput({
  required,
  name,
}: {
  required: boolean;
  name?: string;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileName(e.target.files?.[0]?.name ?? null);
  }

  useEffect(() => {
    const formEl = inputRef.current?.closest("form");
    if (!formEl) return;
    const handleReset = () => setFileName(null);
    formEl.addEventListener("reset", handleReset);
    return () => formEl.removeEventListener("reset", handleReset);
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-royal-300 bg-royal-50/40 px-4 py-6 text-royal-500 transition-colors hover:bg-royal-50">
        <FileText size={18} />
        <span className="text-sm">
          {fileName ? "Click to replace document" : "Click to upload a document"}
        </span>
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept=".pdf,.doc,.docx"
          required={required}
          onChange={handleChange}
          className="hidden"
        />
      </label>
      {fileName && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-green-600">
          <Check size={12} />
          Uploaded: {fileName}
        </p>
      )}
    </div>
  );
}

const DROPDOWN_OTHER_VALUE = "__other__";

function DropdownFieldInput({ field }: { field: DropdownField }) {
  const [selected, setSelected] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const showOther = field.allowOther && selected.includes(DROPDOWN_OTHER_VALUE);

  useEffect(() => {
    const formEl = containerRef.current?.closest("form");
    if (!formEl) return;
    const handleReset = () => setSelected([]);
    formEl.addEventListener("reset", handleReset);
    return () => formEl.removeEventListener("reset", handleReset);
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {field.allowMultiple ? (
        <div className="flex flex-col gap-2">
          {field.options.map((option, i) => (
            <label
              key={i}
              className="flex items-center gap-2 text-sm text-royal-800"
            >
              <input
                type="checkbox"
                name={field.id}
                value={option}
                className="h-4 w-4 rounded border-royal-300"
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked
                      ? [...prev, option]
                      : prev.filter((v) => v !== option),
                  )
                }
              />
              {option}
            </label>
          ))}
          {field.allowOther && (
            <label className="flex items-center gap-2 text-sm text-royal-800">
              <input
                type="checkbox"
                name={field.id}
                value={DROPDOWN_OTHER_VALUE}
                className="h-4 w-4 rounded border-royal-300"
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked
                      ? [...prev, DROPDOWN_OTHER_VALUE]
                      : prev.filter((v) => v !== DROPDOWN_OTHER_VALUE),
                  )
                }
              />
              Other
            </label>
          )}
        </div>
      ) : (
        <select
          name={field.id}
          required={field.required}
          defaultValue=""
          className="w-full rounded-md border border-royal-200 px-3 py-2 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
          onChange={(e) => setSelected(e.target.value ? [e.target.value] : [])}
        >
          <option value="" disabled>
            Select...
          </option>
          {field.options.map((option, i) => (
            <option key={i}>{option}</option>
          ))}
          {field.allowOther && (
            <option value={DROPDOWN_OTHER_VALUE}>Other</option>
          )}
        </select>
      )}
      {showOther && (
        <input
          type="text"
          name={`${field.id}__other`}
          required={field.required}
          placeholder="Please specify"
          className="w-full rounded-md border border-royal-200 px-3 py-2 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
        />
      )}
    </div>
  );
}

function CompactPhotoUpload({
  name,
  required,
}: {
  name: string;
  required: boolean;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setFileName(null);
      setError(null);
      return;
    }
    if (!PHOTO_MIME_TYPES.includes(file.type)) {
      setError("PNG or JPEG only");
      setFileName(null);
      e.target.value = "";
      return;
    }
    setError(null);
    setFileName(file.name);
  }

  useEffect(() => {
    const formEl = inputRef.current?.closest("form");
    if (!formEl) return;
    const handleReset = () => {
      setFileName(null);
      setError(null);
    };
    formEl.addEventListener("reset", handleReset);
    return () => formEl.removeEventListener("reset", handleReset);
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-royal-300 bg-royal-50/40 px-2.5 py-1.5 text-royal-500 transition-colors hover:bg-royal-50">
        <Image size={14} />
        <span className="max-w-[90px] truncate text-xs">
          {fileName ?? "Upload"}
        </span>
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept="image/png,image/jpeg"
          required={required}
          onChange={handleChange}
          className="hidden"
        />
      </label>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

function PlayerListRenderer({
  field,
}: {
  field: Extract<FormField, { type: "player-list" }>;
}) {
  return (
    <div className="rounded-xl border border-royal-100 bg-white p-5 shadow-sm">
      <p className="mb-4 text-sm font-medium text-royal-950">
        {field.label || "Untitled question"}
        {field.required && <span className="ml-0.5 text-red-500">*</span>}
      </p>

      {field.columns.length === 0 ? (
        <p className="text-sm text-royal-400">No fields configured.</p>
      ) : field.layout === "row" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="bg-royal-50">
                {field.columns.map((column) => (
                  <th
                    key={column.id}
                    className="whitespace-nowrap px-3 py-2 text-left font-medium text-royal-700"
                  >
                    {column.label}
                    {column.required && (
                      <span className="ml-0.5 text-red-500">*</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: field.playerCount }).map((_, i) => (
                <tr key={i} className="border-t border-royal-100">
                  {field.columns.map((column) => (
                    <td key={column.id} className="px-3 py-2">
                      <PlayerColumnInput
                        column={column}
                        name={`player-${i}-${column.id}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {Array.from({ length: field.playerCount }).map((_, i) => (
            <div key={i} className="rounded-lg border border-royal-100 p-3">
              <p className="mb-2 text-xs font-semibold text-royal-500">
                Entry {i + 1}
              </p>
              <div className="flex flex-col gap-2">
                {field.columns.map((column) => (
                  <div key={column.id} className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-royal-600">
                      {column.label}
                      {column.required && (
                        <span className="ml-0.5 text-red-500">*</span>
                      )}
                    </label>
                    <PlayerColumnInput
                      column={column}
                      name={`player-${i}-${column.id}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerColumnInput({
  column,
  name,
}: {
  column: PlayerListColumn;
  name: string;
}) {
  switch (column.type) {
    case "short-text":
      return (
        <input
          name={name}
          required={column.required}
          className="w-full min-w-[120px] rounded-md border border-royal-200 px-2.5 py-1.5 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
        />
      );
    case "number":
      return (
        <input
          type="number"
          name={name}
          required={column.required}
          className="w-24 rounded-md border border-royal-200 px-2.5 py-1.5 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
        />
      );
    case "dropdown":
      return (
        <select
          name={name}
          required={column.required}
          defaultValue=""
          className="w-full min-w-[120px] rounded-md border border-royal-200 px-2.5 py-1.5 text-sm text-royal-950 focus:border-royal-500 focus:outline-none"
        >
          <option value="" disabled>
            Select...
          </option>
          {(column.options ?? []).map((option, i) => (
            <option key={i}>{option}</option>
          ))}
        </select>
      );
    case "checkbox":
      return (
        <div className="flex items-center gap-4 text-sm text-royal-800">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name={name}
              value="Yes"
              required={column.required}
            />
            Yes
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name={name} value="No" />
            No
          </label>
        </div>
      );
    case "photo":
      return <CompactPhotoUpload name={name} required={column.required} />;
  }
}
