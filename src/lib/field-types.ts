import {
  Type,
  AlignLeft,
  Hash,
  Image,
  ChevronDownSquare,
  CheckSquare,
  Rows3,
  StickyNote,
  Mail,
  Phone,
  Calendar,
  CircleDot,
  FileText,
  PenTool,
  SeparatorHorizontal,
  Star,
  Calculator,
  type LucideIcon,
} from "lucide-react";
import type {
  FieldType,
  FormField,
  PlayerListColumn,
  PlayerListColumnType,
} from "@/types/form-builder";

function createId() {
  return crypto.randomUUID();
}

export interface FieldTypeDef {
  type: FieldType;
  label: string;
  description: string;
  icon: LucideIcon;
  create: () => FormField;
}

export const FIELD_TYPE_DEFS: FieldTypeDef[] = [
  {
    type: "short-text",
    label: "Short answer",
    description: "Single-line text, e.g. team name",
    icon: Type,
    create: () => ({
      id: createId(),
      type: "short-text",
      label: "Untitled question",
      required: false,
    }),
  },
  {
    type: "long-text",
    label: "Paragraph",
    description: "Multi-line text",
    icon: AlignLeft,
    create: () => ({
      id: createId(),
      type: "long-text",
      label: "Untitled question",
      required: false,
    }),
  },
  {
    type: "number",
    label: "Number",
    description: "Numeric input, e.g. number of players",
    icon: Hash,
    create: () => ({
      id: createId(),
      type: "number",
      label: "Untitled question",
      required: false,
    }),
  },
  {
    type: "email",
    label: "Email",
    description: "Email address with format validation",
    icon: Mail,
    create: () => ({
      id: createId(),
      type: "email",
      label: "Untitled question",
      required: false,
    }),
  },
  {
    type: "phone",
    label: "Phone number",
    description: "Contact phone number",
    icon: Phone,
    create: () => ({
      id: createId(),
      type: "phone",
      label: "Untitled question",
      required: false,
    }),
  },
  {
    type: "date",
    label: "Date",
    description: "Event date, deadline, or date of birth",
    icon: Calendar,
    create: () => ({
      id: createId(),
      type: "date",
      label: "Untitled question",
      required: false,
    }),
  },
  {
    type: "photo",
    label: "Photo upload",
    description: "Single image, e.g. team or player photo",
    icon: Image,
    create: () => ({
      id: createId(),
      type: "photo",
      label: "Untitled question",
      required: false,
    }),
  },
  {
    type: "document",
    label: "Document upload",
    description: "PDF or document, e.g. ID proof or signed waiver",
    icon: FileText,
    create: () => ({
      id: createId(),
      type: "document",
      label: "Untitled question",
      required: false,
    }),
  },
  {
    type: "dropdown",
    label: "Dropdown",
    description: "Choose one option from a list",
    icon: ChevronDownSquare,
    create: () => ({
      id: createId(),
      type: "dropdown",
      label: "Untitled question",
      required: false,
      options: ["Option 1", "Option 2"],
      allowMultiple: false,
      allowOther: false,
    }),
  },
  {
    type: "multiple-choice",
    label: "Multiple choice",
    description: "Visible radio-button options, pick one",
    icon: CircleDot,
    create: () => ({
      id: createId(),
      type: "multiple-choice",
      label: "Untitled question",
      required: false,
      options: ["Option 1", "Option 2"],
    }),
  },
  {
    type: "checkbox",
    label: "Yes / No",
    description: "A single checkbox, e.g. agree to rules",
    icon: CheckSquare,
    create: () => ({
      id: createId(),
      type: "checkbox",
      label: "Untitled question",
      required: false,
      yesLabel: "Yes",
      noLabel: "No",
    }),
  },
  {
    type: "signature",
    label: "E-signature",
    description: "Draw a signature, e.g. agreeing to contract terms",
    icon: PenTool,
    create: () => ({
      id: createId(),
      type: "signature",
      label: "Untitled question",
      required: false,
    }),
  },
  {
    type: "static-text",
    label: "Message",
    description: "Write a static note or instructions for the form",
    icon: StickyNote,
    create: () => ({
      id: createId(),
      type: "static-text",
      label: "",
      required: false,
      content: "Write your message here.",
    }),
  },
  {
    type: "section-break",
    label: "Section break",
    description: "Splits the form into multiple steps/pages",
    icon: SeparatorHorizontal,
    create: () => ({
      id: createId(),
      type: "section-break",
      label: "New section",
      required: false,
      description: "",
    }),
  },
  {
    type: "rating",
    label: "Rating",
    description: "Star rating or slider scale, e.g. skill rating 1–10",
    icon: Star,
    create: () => ({
      id: createId(),
      type: "rating",
      label: "Untitled question",
      required: false,
      min: 1,
      max: 5,
      style: "stars",
    }),
  },
  {
    type: "computed",
    label: "Computed",
    description: "Auto-calculate a value from other fields, e.g. total = quantity × price",
    icon: Calculator,
    create: () => ({
      id: createId(),
      type: "computed",
      label: "Untitled question",
      required: false,
      operation: "sum",
      terms: [],
      showOnForm: true,
    }),
  },
  {
    type: "player-list",
    label: "Repeating list",
    description: "A repeating group of entries you define, e.g. players, guests, or items",
    icon: Rows3,
    create: () => ({
      id: createId(),
      type: "player-list",
      label: "List",
      required: true,
      layout: "row",
      playerCount: 5,
      columns: [],
    }),
  },
];

export function getFieldTypeDef(type: FieldType): FieldTypeDef {
  const def = FIELD_TYPE_DEFS.find((d) => d.type === type);
  if (!def) throw new Error(`Unknown field type: ${type}`);
  return def;
}

export function createField(type: FieldType): FormField {
  return getFieldTypeDef(type).create();
}

export interface PlayerListColumnTypeDef {
  type: PlayerListColumnType;
  label: string;
  icon: LucideIcon;
  create: () => PlayerListColumn;
}

export const PLAYER_LIST_COLUMN_DEFS: PlayerListColumnTypeDef[] = [
  {
    type: "short-text",
    label: "Short answer",
    icon: Type,
    create: () => ({
      id: createId(),
      type: "short-text",
      label: "New field",
      required: false,
    }),
  },
  {
    type: "number",
    label: "Number",
    icon: Hash,
    create: () => ({
      id: createId(),
      type: "number",
      label: "New field",
      required: false,
    }),
  },
  {
    type: "dropdown",
    label: "Dropdown",
    icon: ChevronDownSquare,
    create: () => ({
      id: createId(),
      type: "dropdown",
      label: "New field",
      required: false,
      options: ["Option 1", "Option 2"],
    }),
  },
  {
    type: "checkbox",
    label: "Yes / No",
    icon: CheckSquare,
    create: () => ({
      id: createId(),
      type: "checkbox",
      label: "New field",
      required: false,
    }),
  },
];

export const PHOTO_COLUMN_DEF: PlayerListColumnTypeDef = {
  type: "photo",
  label: "Photo",
  icon: Image,
  create: () => ({
    id: createId(),
    type: "photo",
    label: "Photo",
    required: false,
  }),
};
