import { z } from "zod";
import { toEnglishDigits } from "./persian";

export const titleSchema = z.string().trim().min(2).max(200);
export const settingTextSchema = z.string().trim().min(2).max(120);

export function parseChapterNumber(input: string): number | null {
  const normalized = toEnglishDigits(input).trim();
  if (!/^\d{1,3}$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isInteger(value) || value < 1 || value > 200) return null;
  return value;
}

export function parseTelegramId(input: string): number | null {
  const normalized = toEnglishDigits(input).trim();
  if (!/^\d{5,15}$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function parseGroupIdInput(input: string): string | null {
  const normalized = toEnglishDigits(input).trim();
  if (!/^-?\d{5,20}$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value === 0) return null;
  return String(value);
}

export function cleanText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
