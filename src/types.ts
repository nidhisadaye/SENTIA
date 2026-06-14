export interface SavedFace {
  id: string;
  name: string;
  description: string;
  timestamp: number;
}

export interface ConvMessage {
  role: "user" | "assistant";
  content: string;
}

export type OcrType =
  | "medicine"
  | "menu"
  | "prescription"
  | "govdoc"
  | "currency"
  | "form"
  | "general";

export type AppMode =
  | "idle"
  | "scanning"
  | "reading"
  | "listening"
  | "thinking"
  | "speaking"
  | "settings"
  | "facemanage"
  | "facedeleteconfirm"
  | "savingface"
  | "namingface"
  | "sos"
  | "walkwithme";

export type WwmUrgency = "CLEAR" | "CAUTION" | "STOP" | "DANGER";

export type LangKey = "en" | "hi" | "mr";

