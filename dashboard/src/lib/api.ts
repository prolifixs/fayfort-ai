export const API_BASE = (import.meta.env.VITE_FAYFORT_API_URL as string | undefined)?.replace(/\/$/, "") || "http://127.0.0.1:8001";

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt?: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const API_TIMEOUT_MS = 20_000;

export async function apiRequest<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(API_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(API_BASE + path, {
      ...init,
      signal,
      headers: {
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        Authorization: "Bearer " + accessToken,
        ...init.headers,
      },
    });
  } catch (error) {
    if (timeoutSignal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) {
      throw new ApiRequestError("FayFort API did not respond within 20 seconds. Check the API connection, then retry.", 0);
    }
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail: unknown = body?.detail;
    let message = "Request failed (" + response.status + ")";
    let retryAt: string | undefined;
    if (typeof detail === "string" && detail.trim()) {
      message = detail;
    } else if (detail && typeof detail === "object" && "message" in detail && typeof (detail as { message?: unknown }).message === "string") {
      message = (detail as { message: string }).message;
      const diagnostic = (detail as { diagnostic?: unknown }).diagnostic;
      const code = (detail as { code?: unknown }).code;
      if (typeof diagnostic === "string" && diagnostic.trim()) message += " Diagnostic: " + diagnostic.trim();
      if (typeof code === "string" && code.trim()) message += " (" + code.trim() + ")";
      const value = (detail as { retry_at?: unknown }).retry_at;
      if (typeof value === "string") retryAt = value;
    } else if (Array.isArray(detail)) {
      const issues = detail.map((issue: unknown) => {
        if (!issue || typeof issue !== "object") return "";
        const item = issue as { loc?: unknown; msg?: unknown };
        const location = Array.isArray(item.loc)
          ? item.loc.filter((part) => typeof part === "string" || typeof part === "number").join(".")
          : "";
        const reason = typeof item.msg === "string" ? item.msg : "Invalid value";
        return location ? location + ": " + reason : reason;
      }).filter(Boolean);
      if (issues.length) message = issues.join("; ");
    } else if (detail && typeof detail === "object") {
      const item = detail as { message?: unknown; error?: unknown };
      if (typeof item.message === "string") message = item.message;
      else if (typeof item.error === "string") message = item.error;
    }
    throw new ApiRequestError(message, response.status, retryAt);
  }
  return body as T;
}

export function websocketUrl(path: string): string {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = path;
  url.search = "";
  return url.toString();
}
