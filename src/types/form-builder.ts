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
  | "computed";

interface FieldBase {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
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

export interface DropdownField extends FieldBase {
  type: "dropdown";
  options: string[];
  allowMultiple: boolean;
  allowOther: boolean;
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
  | ComputedField;
