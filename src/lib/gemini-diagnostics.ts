import { ApiError } from "@google/genai";

export type GeminiFailureCategory =
  | "authentication_or_permission"
  | "invalid_request_or_generation_config"
  | "model_or_endpoint_not_found"
  | "quota_or_rate_limit"
  | "provider_error"
  | "unexpected_http_error"
  | "network_dns_tls_error"
  | "timeout_or_abort"
  | "sdk_error"
  | "unknown_error";

export interface GeminiFailureDiagnostic {
  status: number | null;
  category: GeminiFailureCategory;
  errorName: string;
  causeName: string | null;
  causeCode: string | null;
  safeMessage: string;
}

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  cause?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
};

function asErrorLike(value: unknown): ErrorLike | null {
  return typeof value === "object" && value !== null
    ? (value as ErrorLike)
    : null;
}

function safeName(value: unknown): string {
  return typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)
    ? value
    : "Error";
}

function safeCode(value: unknown): string | null {
  return typeof value === "string" &&
    /^(?:E[A-Z0-9_]{1,31}|ABORT_ERR|UND_ERR_[A-Z0-9_]{1,31})$/.test(value)
    ? value
    : null;
}

function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  let current = error;
  while (chain.length < 5) {
    const entry = asErrorLike(current);
    if (!entry) break;
    chain.push(entry);
    current = entry.cause;
  }
  return chain;
}

function statusFrom(chain: ErrorLike[]): number | null {
  for (const error of chain) {
    const status =
      typeof error.status === "number"
        ? error.status
        : typeof error.statusCode === "number"
          ? error.statusCode
          : null;
    if (status !== null && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status;
    }
  }
  return null;
}

function categoryForHttpStatus(status: number): GeminiFailureCategory {
  if (status === 401 || status === 403) return "authentication_or_permission";
  if (status === 400 || status === 422) {
    return "invalid_request_or_generation_config";
  }
  if (status === 404) return "model_or_endpoint_not_found";
  if (status === 429) return "quota_or_rate_limit";
  if (status >= 500) return "provider_error";
  return "unexpected_http_error";
}

function safeMessageFor(
  category: GeminiFailureCategory,
  status: number | null,
  code: string | null,
): string {
  if (status !== null) return `Gemini API returned HTTP ${status}.`;
  if (category === "timeout_or_abort") {
    return "Gemini request timed out or was aborted.";
  }
  if (category === "network_dns_tls_error") {
    return code
      ? `Gemini network request failed (${code}).`
      : "Gemini network, DNS, or TLS connection failed.";
  }
  if (category === "sdk_error") return "The Google GenAI SDK reported an error.";
  return "Gemini request failed with an unclassified SDK or runtime error.";
}

function statusCategoryMessage(category: GeminiFailureCategory): string {
  switch (category) {
    case "authentication_or_permission":
      return "Check that GEMINI_API_KEY is valid and has Gemini API access.";
    case "invalid_request_or_generation_config":
      return "The Gemini API rejected the extraction request configuration.";
    case "model_or_endpoint_not_found":
      return "The configured Gemini model or API endpoint was not found.";
    case "quota_or_rate_limit":
      return "Gemini quota or rate limit was reached. Check API usage and quota.";
    case "provider_error":
      return "The Gemini service returned a server error. Try again later.";
    case "unexpected_http_error":
      return "The Gemini API request failed. Check server logs for safe diagnostics.";
    case "network_dns_tls_error":
      return "Could not reach Gemini. Check network, DNS, firewall, and TLS settings.";
    case "timeout_or_abort":
      return "Gemini timed out. Check connectivity and try again later.";
    case "sdk_error":
      return "The Google GenAI SDK failed before returning a Gemini API response.";
    case "unknown_error":
      return "Gemini failed unexpectedly. Check server logs for safe diagnostics.";
  }
}

export function diagnoseGeminiFailure(
  error: unknown,
): GeminiFailureDiagnostic {
  const chain = errorChain(error);
  const root = chain[0];
  const rootName = safeName(root?.name);
  const cause = chain[1];
  const causeName = cause ? safeName(cause.name) : null;
  const causeCode = chain
    .map((entry) => safeCode(entry.code))
    .find((code) => code !== null) ?? null;
  const status = statusFrom(chain);

  let category: GeminiFailureCategory;
  if (status !== null) {
    category = categoryForHttpStatus(status);
  } else if (
    chain.some((entry) =>
      [
        "AbortError",
        "TimeoutError",
        "RequestTimeoutError",
        "APIConnectionTimeoutError",
      ].includes(safeName(entry.name)),
    ) ||
    causeCode === "ABORT_ERR" ||
    chain.some((entry) =>
      typeof entry.message === "string" &&
      /\b(timeout|timed out|aborted)\b/i.test(entry.message),
    )
  ) {
    category = "timeout_or_abort";
  } else if (
    chain.some((entry) =>
      ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(
        safeCode(entry.code) ?? "",
      ),
    ) ||
    chain.some((entry) =>
      typeof entry.message === "string" &&
      /\b(dns|tls|certificate|socket|network|fetch failed)\b/i.test(entry.message),
    )
  ) {
    category = "network_dns_tls_error";
  } else if (
    chain.some((entry) =>
      ["ApiError", "APIConnectionError", "APIUserAbortError"].includes(
        safeName(entry.name),
      ),
    ) ||
    error instanceof ApiError
  ) {
    category = "sdk_error";
  } else {
    category = "unknown_error";
  }

  return {
    status,
    category,
    errorName: rootName,
    causeName,
    causeCode,
    safeMessage: safeMessageFor(category, status, causeCode),
  };
}

export function getGeminiFailureAction(category: GeminiFailureCategory): string {
  return statusCategoryMessage(category);
}
