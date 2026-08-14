export type ChatRole = "user" | "assistant" | "system" | "context";

export type AttachmentKind = "pdf" | "txt" | "image" | "audio";

export interface ChatAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  sizeLabel: string;
  previewUrl?: string;
}

export interface InjectedMemory {
  id: string;
  title: string;
  excerpt: string;
  weight: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  streaming?: boolean;
  truncated?: boolean;
  quotedFromId?: string;
  attachments?: ChatAttachment[];
  injectedMemories?: InjectedMemory[];
  audio?: {
    durationMs: number;
    peaks: number[];
    playing?: boolean;
    progress?: number;
  };
}

export interface CoreMemory {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  weight: number;
  lastTouched: string;
}

export interface FaceSignal {
  expression: "neutral" | "tense" | "sad" | "engaged" | "distressed";
  confidence: number;
  updatedAt: number;
}

export interface QuoteDraft {
  messageId: string;
  excerpt: string;
}
