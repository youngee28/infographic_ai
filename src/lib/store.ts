import localforage from "localforage";
import { v4 as uuidv4 } from "uuid";
import type { TableSession } from "@/lib/session-types";
import { tableSessionSchema } from "@/lib/analysis-schema";

export interface Message {
  role: "user" | "ai";
  content: string;
  citations?: number[];
  generatedImageDataUrl?: string;
}

export interface AnnotationMessage {
  role: "user" | "ai";
  content: string;
  citations?: number[];
  generatedImageDataUrl?: string;
}

export interface Annotation {
  id: string; // unique uuid for the annotation
  position: { x: number; y: number; width: number; height: number; pageNumber: number }; // Absolute position normalized to scale 1.0 (PDF coordinate system)
  imageOriginBase64: string; // The base64 crop image to be sent to Gemini
  messages: AnnotationMessage[]; // Mini-chat conversation related to this crop
  createdAt: number;
}

export type { TableSession };
export type PdfSession = TableSession;

// Ensure localforage uses IndexedDB, but only on the client side
if (typeof window !== "undefined") {
  localforage.config({
    driver: localforage.INDEXEDDB,
    name: "TableInfographicAiApp",
    version: 1.0,
    storeName: "table_sessions",
  });
}

export const store = {
  async getSessions(): Promise<TableSession[]> {
    if (typeof window === "undefined") return [];
    
    const sessions: TableSession[] = [];
    await localforage.iterate((value: unknown) => {
      const parsed = tableSessionSchema.safeParse(value);
      if (parsed.success) {
        sessions.push(parsed.data as TableSession);
      }
    });
    // Sort descending by creation time
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getSession(id: string): Promise<TableSession | null> {
    if (typeof window === "undefined") return null;
    const value = await localforage.getItem<unknown>(id);
    const parsed = tableSessionSchema.safeParse(value);
    return parsed.success ? (parsed.data as TableSession) : null;
  },

  async saveSession(session: TableSession): Promise<void> {
    if (typeof window === "undefined") return;
    const parsed = tableSessionSchema.safeParse(session);
    if (!parsed.success) {
      throw new Error("Invalid session data shape");
    }
    await localforage.setItem(session.id, parsed.data);
  },

  async deleteSession(id: string): Promise<void> {
    if (typeof window === "undefined") return;
    await localforage.removeItem(id);
  },

  createNewSessionId(): string {
    return uuidv4();
  }
};
