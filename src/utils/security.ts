export function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

export function parseAdminIds(raw: string | undefined): Set<number> {
  if (!raw) return new Set();
  const ids = raw
    .split(/[\s,]+/)
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return new Set(ids);
}

export function parseGroupChatId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value === 0) return null;
  return value;
}

export function isAdmin(adminIds: ReadonlySet<number>, telegramId: number | undefined): boolean {
  return telegramId !== undefined && adminIds.has(telegramId);
}

const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export function isWebhookSecretValid(secret: string | undefined): secret is string {
  return typeof secret === "string" && WEBHOOK_SECRET_PATTERN.test(secret);
}

export function isWebhookAuthorized(header: string | null, secret: string): boolean {
  if (!header || !isWebhookSecretValid(secret)) return false;
  return safeEqual(header, secret);
}
