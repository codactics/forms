export type FieldType =
  | "short-text"
  | "long-text"
  | "number"
  | "photo"
  | "dropdown"
  | "checkbox"
  | "player-list"
  | "static-text"
  | "email"
  | "phone"
  | "link"
  | "date"
  | "multiple-choice"
  | "document"
  | "signature"
  | "section-break"
  | "rating"
  | "computed"
  | "button";

export interface FieldPopup {
  enabled: boolean;
  title: string;
  content: string; // markdown
  // false (default): shown once per form-fill session. true: shown every
  // time the trigger fires (every focus, or every Next into the section).
  repeat?: boolean;
}

interface FieldBase {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  // For most field types: fires on focus. For "section-break": fires when
  // the respondent advances into this section via Next. See FieldPopup's
  // "repeat" for whether that's once per session or every time.
  popup?: FieldPopup;
}

export interface ShortTextField extends FieldBase {
  type: "short-text";
}

export interface LongTextField extends FieldBase {
  type: "long-text";
}

export interface NumberField extends FieldBase {
  type: "number";
  min?: number;
  max?: number;
}

export interface PhotoField extends FieldBase {
  type: "photo";
}

export interface DropdownOption {
  label: string;
  imageDataUrl?: string; // optional thumbnail — never required
}

// Forms saved before per-option images existed stored options as plain
// strings — normalize either shape to the same object form wherever
// options are read, rather than migrating old data.
export function normalizeDropdownOption(
  raw: string | DropdownOption,
): DropdownOption {
  return typeof raw === "string" ? { label: raw } : raw;
}

export interface DropdownField extends FieldBase {
  type: "dropdown";
  options: DropdownOption[];
  allowMultiple: boolean;
  allowOther: boolean;
  // Only meaningful when allowMultiple is true. undefined/0 = no limit.
  maxSelections?: number;
}

export interface CheckboxField extends FieldBase {
  type: "checkbox";
  yesLabel: string;
  noLabel: string;
}

export type PlayerListColumnType =
  | "short-text"
  | "number"
  | "dropdown"
  | "checkbox"
  | "photo";

export interface PlayerListColumn {
  id: string;
  type: PlayerListColumnType;
  label: string;
  required: boolean;
  options?: string[];
}

export interface PlayerListField extends FieldBase {
  type: "player-list";
  layout: "row" | "stacked";
  playerCount: number;
  columns: PlayerListColumn[];
}

export interface StaticTextField extends FieldBase {
  type: "static-text";
  content: string;
  color?: string;
}

export interface EmailField extends FieldBase {
  type: "email";
}

export interface PhoneField extends FieldBase {
  type: "phone";
}

export interface LinkField extends FieldBase {
  type: "link";
}

export interface DateField extends FieldBase {
  type: "date";
  min?: string;
  max?: string;
}

export interface MultipleChoiceField extends FieldBase {
  type: "multiple-choice";
  options: string[];
}

export interface DocumentField extends FieldBase {
  type: "document";
}

export interface SignatureField extends FieldBase {
  type: "signature";
}

export interface SectionBreakField extends FieldBase {
  type: "section-break";
  description: string;
  color?: string;
}

export interface RatingField extends FieldBase {
  type: "rating";
  min: number;
  max: number;
  style: "stars" | "slider";
}

export type ComputedOperation = "sum" | "average" | "multiply" | "min" | "max";

export type ComputedTerm =
  | { type: "field"; fieldId: string }
  | { type: "constant"; value: number };

export interface ComputedField extends FieldBase {
  type: "computed";
  operation: ComputedOperation;
  terms: ComputedTerm[];
  // When false, this field isn't shown to the person filling the form — it
  // exists purely as an intermediate step for other Computed fields to
  // reference (e.g. building up a multi-step formula), but is still
  // calculated and still recorded.
  showOnForm: boolean;
}

// A button the respondent clicks to open a small popup form (built from the
// same column types as a Repeating list's columns) — used for things like
// an optional "Add emergency contact" detail that most people can skip.
export interface ButtonField extends FieldBase {
  type: "button";
  buttonStyle: "text" | "image";
  buttonText: string;
  buttonImageDataUrl?: string;
  fields: PlayerListColumn[];
}

export type FormField =
  | ShortTextField
  | LongTextField
  | NumberField
  | PhotoField
  | DropdownField
  | CheckboxField
  | PlayerListField
  | StaticTextField
  | EmailField
  | PhoneField
  | LinkField
  | DateField
  | MultipleChoiceField
  | DocumentField
  | SignatureField
  | SectionBreakField
  | RatingField
  | ComputedField
  | ButtonField;
