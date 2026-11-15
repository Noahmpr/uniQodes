export class TelegramApiError extends Error {
  readonly statusCode: number;
  readonly errorCode: number;
  readonly description: string;
  readonly retryAfterSeconds: number | null;

  constructor(statusCode: number, errorCode: number, description: string, retryAfterSeconds: number | null) {
    super(description);
    this.name = "TelegramApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.description = description;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface TelegramClient {
  call<T>(method: string, body?: Record<string, unknown>): Promise<T>;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export function createTelegramClient(token: string, fetchImpl: typeof fetch = fetch): TelegramClient {
  return {
    async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
      let response: Response;
      try {
        response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "network";
        throw new TelegramApiError(0, 0, message, null);
      }
      const payload = (await response.json()) as TelegramResponse<T>;
      if (!payload.ok) {
        throw new TelegramApiError(
          response.status,
          payload.error_code ?? response.status,
          payload.description ?? "telegram error",
          payload.parameters?.retry_after ?? null,
        );
      }
      return payload.result as T;
    },
  };
}

export function isMessageNotModified(error: unknown): boolean {
  return error instanceof TelegramApiError && error.description.toLowerCase().includes("message is not modified");
}

export function isMessageMissing(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) return false;
  const text = error.description.toLowerCase();
  return (
    text.includes("message to edit not found") ||
    text.includes("message to delete not found") ||
    text.includes("message identifier") ||
    text.includes("message can't be found")
  );
}

export function isPermanentDeliveryFailure(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) return false;
  const text = error.description.toLowerCase();
  return (
    error.errorCode === 403 ||
    text.includes("blocked") ||
    text.includes("deactivated") ||
    text.includes("chat not found") ||
    text.includes("can't initiate conversation")
  );
}

export function errorText(error: unknown): string {
  if (error instanceof TelegramApiError) return error.description.slice(0, 300);
  if (error instanceof Error) return error.message.slice(0, 300);
  return "unknown";
}
