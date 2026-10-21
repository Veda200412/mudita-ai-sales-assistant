import {
  qualifyInquiry,
  type QualificationInput,
  type QualificationResult,
} from "@/lib/policy";
import { insightAnalyticsPolicy } from "@/lib/policy-config";

export interface QualificationRequest {
  inquiry: string;
  businessDetails?: {
    service?: string;
    budgetInr?: number;
    businessUseCase?: string;
    genuineBusinessUseCase?: boolean;
  };
}

export interface ExtractedInquiryFacts {
  requestedService: string | null;
  budgetInr: number | null;
  businessUseCase: string | null;
  genuineBusinessUseCase: boolean | null;
  evidence: {
    service: string | null;
    budgetInr: string | null;
    businessUseCase: string | null;
    genuineBusinessUseCase: string | null;
  };
}

export interface QualificationResponse {
  extractedFacts: Omit<ExtractedInquiryFacts, "evidence">;
  finalStatus: QualificationResult["status"];
  reason: QualificationResult["reason"];
  evidence: ExtractedInquiryFacts["evidence"];
  missingInformation: QualificationResult["missingFields"];
}

export type FactExtractor = (
  request: QualificationRequest,
) => Promise<unknown>;

export type QualificationErrorCode =
  | "invalid_request"
  | "missing_credentials"
  | "malformed_model_output"
  | "model_unavailable";

export class QualificationError extends Error {
  constructor(
    public readonly code: QualificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QualificationError";
  }
}

const MAX_INQUIRY_LENGTH = 6000;
const MAX_BUSINESS_DETAIL_LENGTH = 1000;
const extractedFactKeys = [
  "requestedService",
  "budgetInr",
  "businessUseCase",
  "genuineBusinessUseCase",
  "evidence",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function readOptionalString(value: unknown, maxLength: number): string | null {
  if (value === null) return null;
  if (
    typeof value === "string" &&
    value.length <= maxLength &&
    value.trim().length > 0
  ) {
    return value;
  }
  throw new QualificationError(
    "malformed_model_output",
    "Gemini returned structured data with missing or unsupported fields. Please try again.",
  );
}

export function validateQualificationRequest(
  value: unknown,
): QualificationRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["inquiry", "businessDetails"])) {
    throw new QualificationError(
      "invalid_request",
      "Provide an inquiry and optional structured business details.",
    );
  }

  if (
    typeof value.inquiry !== "string" ||
    value.inquiry.trim().length === 0 ||
    value.inquiry.length > MAX_INQUIRY_LENGTH
  ) {
    throw new QualificationError(
      "invalid_request",
      `Inquiry must be between 1 and ${MAX_INQUIRY_LENGTH} characters.`,
    );
  }

  let businessDetails: QualificationRequest["businessDetails"];
  if (value.businessDetails !== undefined) {
    const details = value.businessDetails;
    if (
      !isRecord(details) ||
      !hasOnlyKeys(details, [
        "service",
        "budgetInr",
        "businessUseCase",
        "genuineBusinessUseCase",
      ])
    ) {
      throw new QualificationError(
        "invalid_request",
        "Business details contain an unsupported field or invalid shape.",
      );
    }

    if (
      details.service !== undefined &&
      (typeof details.service !== "string" ||
        details.service.trim().length === 0 ||
        details.service.length > MAX_BUSINESS_DETAIL_LENGTH)
    ) {
      throw new QualificationError(
        "invalid_request",
        "Service must be a non-empty string of at most 1000 characters.",
      );
    }

    if (
      details.businessUseCase !== undefined &&
      (typeof details.businessUseCase !== "string" ||
        details.businessUseCase.trim().length === 0 ||
        details.businessUseCase.length > MAX_BUSINESS_DETAIL_LENGTH)
    ) {
      throw new QualificationError(
        "invalid_request",
        "Business use case must be a non-empty string of at most 1000 characters.",
      );
    }

    if (
      details.budgetInr !== undefined &&
      (typeof details.budgetInr !== "number" ||
        !Number.isFinite(details.budgetInr) ||
        details.budgetInr < 0)
    ) {
      throw new QualificationError(
        "invalid_request",
        "Budget must be a non-negative finite INR amount.",
      );
    }

    if (
      details.genuineBusinessUseCase !== undefined &&
      typeof details.genuineBusinessUseCase !== "boolean"
    ) {
      throw new QualificationError(
        "invalid_request",
        "Genuine business use case must be a boolean when provided.",
      );
    }

    businessDetails = {
      ...(details.service === undefined ? {} : { service: details.service }),
      ...(details.budgetInr === undefined
        ? {}
        : { budgetInr: details.budgetInr }),
      ...(details.businessUseCase === undefined
        ? {}
        : { businessUseCase: details.businessUseCase }),
      ...(details.genuineBusinessUseCase === undefined
        ? {}
        : { genuineBusinessUseCase: details.genuineBusinessUseCase }),
    };
  }

  return {
    inquiry: value.inquiry,
    ...(businessDetails ? { businessDetails } : {}),
  };
}

function getSourceTexts(request: QualificationRequest): string[] {
  const details = request.businessDetails;
  return [
    request.inquiry,
    ...(details?.service ? [details.service] : []),
    ...(details?.businessUseCase ? [details.businessUseCase] : []),
    ...(typeof details?.budgetInr === "number"
      ? [String(details.budgetInr)]
      : []),
    ...(typeof details?.genuineBusinessUseCase === "boolean"
      ? [String(details.genuineBusinessUseCase)]
      : []),
  ];
}

function hasVerbatimEvidence(
  evidence: string | null,
  request: QualificationRequest,
): evidence is string {
  return Boolean(
    evidence &&
      getSourceTexts(request).some((source) => source.includes(evidence)),
  );
}

function normalizePhrase(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim();
}

function supportedServiceFromEvidence(
  evidence: string,
): ExtractedInquiryFacts["requestedService"] {
  const phrase = normalizePhrase(evidence);
  const hasAnalyticsContext = /\b(analytics|analysis|forecasting|reporting)\b/.test(
    phrase,
  );

  if (
    hasAnalyticsContext &&
    /\b(sales|revenue)\b/.test(phrase) &&
    !/\bcustomer\b/.test(phrase)
  ) {
    return "sales_revenue_analytics";
  }
  if (
    /\bcustomer\b/.test(phrase) &&
    /\b(behavio?r|retention|segmentation|churn|journey)\b/.test(phrase)
  ) {
    return "customer_behaviour_analytics";
  }
  if (
    /\b(dashboard|dashboards|reporting)\b/.test(phrase) &&
    /\b(business|kpi|kpis|metrics)\b/.test(phrase)
  ) {
    return "business_dashboards_reporting";
  }
  return null;
}

function isVagueServicePhrase(value: string): boolean {
  const genericTerms = new Set([
    "a",
    "an",
    "analytics",
    "analysis",
    "and",
    "business",
    "can",
    "for",
    "help",
    "i",
    "looking",
    "my",
    "need",
    "our",
    "please",
    "support",
    "the",
    "to",
    "want",
    "we",
    "with",
    "you",
  ]);
  const meaningfulTerms = normalizePhrase(value)
    .split(" ")
    .filter((term) => term && !genericTerms.has(term));
  return meaningfulTerms.length === 0;
}

function isConcreteBusinessUseCase(value: string): boolean {
  const phrase = normalizePhrase(value);
  const describesGoal =
    /\b(forecast\w*|track\w*|increase\w*|grow\w*|reduce\w*|improv\w*|identify\w*|understand\w*|measure\w*|monitor\w*|optim\w*|predict\w*|compare\w*|analy\w*)\b/.test(
      phrase,
    );
  const namesBusinessOutcome =
    /\b(sales|revenue|customer\w*|retention|churn|conversion\w*|demand|inventory|cost\w*|profit\w*|performance|purchase\w*|orders|market\w*)\b/.test(
      phrase,
    );
  return describesGoal && namesBusinessOutcome;
}

function parseBudgetEvidence(evidence: string): number | null {
  const hasCurrency = /₹|\bINR\b|\bRs\.?/i.test(evidence);
  const hasBudgetContext =
    /\b(budget|cost|spend|investment|price)\b/i.test(evidence);
  if (!hasCurrency && !hasBudgetContext) return null;

  const match = evidence.match(
    /(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand|lakh|lac)?/i,
  );
  if (!match) return null;
  const amount = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(amount)) return null;
  const multiplier = match[2]?.toLowerCase();
  if (multiplier === "k" || multiplier === "thousand") return amount * 1_000;
  if (multiplier === "lakh" || multiplier === "lac") return amount * 100_000;
  return amount;
}

function validateExtractedFacts(
  value: unknown,
  request: QualificationRequest,
): ExtractedInquiryFacts {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, extractedFactKeys) ||
    !extractedFactKeys.every((key) => key in value) ||
    !isRecord(value.evidence) ||
    !hasOnlyKeys(value.evidence, [
      "service",
      "budgetInr",
      "businessUseCase",
      "genuineBusinessUseCase",
    ])
  ) {
    throw new QualificationError(
      "malformed_model_output",
      "Gemini returned a field with an invalid type or value. Please try again.",
    );
  }

  const evidence = value.evidence;
  const requestedService = readOptionalString(
    value.requestedService,
    MAX_BUSINESS_DETAIL_LENGTH,
  );
  const businessUseCase = readOptionalString(
    value.businessUseCase,
    MAX_BUSINESS_DETAIL_LENGTH,
  );
  const serviceQuote = readOptionalString(evidence.service, MAX_INQUIRY_LENGTH);
  const budgetQuote = readOptionalString(
    evidence.budgetInr,
    MAX_INQUIRY_LENGTH,
  );
  const businessUseCaseQuote = readOptionalString(
    evidence.businessUseCase,
    MAX_INQUIRY_LENGTH,
  );
  const genuineUseCaseQuote = readOptionalString(
    evidence.genuineBusinessUseCase,
    MAX_INQUIRY_LENGTH,
  );
  const budgetInrFromModel =
    value.budgetInr === null ||
    (typeof value.budgetInr === "number" &&
      Number.isFinite(value.budgetInr) &&
      value.budgetInr >= 0)
      ? value.budgetInr
      : undefined;
  const genuineBusinessUseCaseFromModel =
    value.genuineBusinessUseCase === null ||
    typeof value.genuineBusinessUseCase === "boolean"
      ? value.genuineBusinessUseCase
      : undefined;

  if (
    budgetInrFromModel === undefined ||
    genuineBusinessUseCaseFromModel === undefined
  ) {
    throw new QualificationError(
      "malformed_model_output",
      "Gemini returned an invalid budget or business-use-case value. Please try again.",
    );
  }

  const details = request.businessDetails;
  const modelServiceEvidence =
    requestedService !== null &&
    hasVerbatimEvidence(serviceQuote, request)
      ? serviceQuote
      : null;
  const suppliedService = details?.service;
  const candidateServiceEvidence =
    suppliedService ??
    (modelServiceEvidence && hasVerbatimEvidence(modelServiceEvidence, request)
      ? modelServiceEvidence
      : null);
  const candidateService =
    supportedServiceFromEvidence(candidateServiceEvidence ?? "") ??
    (candidateServiceEvidence &&
    !isVagueServicePhrase(candidateServiceEvidence) &&
    (details?.service ?? requestedService) &&
    hasVerbatimEvidence(details?.service ?? requestedService, request)
      ? (details?.service ?? requestedService)
      : null);
  const serviceEvidence = candidateService ? candidateServiceEvidence : null;
  const modelUseCaseEvidence =
    businessUseCase !== null &&
    businessUseCase === businessUseCaseQuote &&
    hasVerbatimEvidence(businessUseCaseQuote, request)
      ? businessUseCaseQuote
      : null;
  const candidateUseCaseEvidence = details?.businessUseCase ?? modelUseCaseEvidence;
  const useCaseEvidence =
    candidateUseCaseEvidence &&
    isConcreteBusinessUseCase(candidateUseCaseEvidence)
      ? candidateUseCaseEvidence
      : null;
  const verifiedBudgetEvidence =
    typeof details?.budgetInr === "number"
      ? String(details.budgetInr)
      : hasVerbatimEvidence(budgetQuote, request) &&
          parseBudgetEvidence(budgetQuote) === budgetInrFromModel
        ? budgetQuote
        : null;
  const budgetInr =
    typeof details?.budgetInr === "number"
      ? details.budgetInr
      : verifiedBudgetEvidence
        ? budgetInrFromModel
        : null;
  const modelGenuineEvidence =
    genuineUseCaseQuote &&
    useCaseEvidence?.includes(genuineUseCaseQuote) &&
    hasVerbatimEvidence(genuineUseCaseQuote, request)
      ? genuineUseCaseQuote
      : null;
  const genuineEvidence =
    useCaseEvidence === null
      ? null
      : typeof details?.genuineBusinessUseCase === "boolean"
        ? String(details.genuineBusinessUseCase)
        : modelGenuineEvidence;
  const genuineBusinessUseCase =
    useCaseEvidence === null
      ? null
      : typeof details?.genuineBusinessUseCase === "boolean"
      ? details.genuineBusinessUseCase
      : genuineEvidence
        ? genuineBusinessUseCaseFromModel
        : null;

  return {
    requestedService: candidateService,
    budgetInr,
    businessUseCase: useCaseEvidence
      ? details?.businessUseCase ?? businessUseCase
      : null,
    genuineBusinessUseCase,
    evidence: {
      service: serviceEvidence,
      budgetInr: verifiedBudgetEvidence,
      businessUseCase: useCaseEvidence,
      genuineBusinessUseCase: genuineEvidence,
    },
  };
}

export async function runLeadQualification(
  request: unknown,
  apiKey: string | undefined,
  extractFacts: FactExtractor,
): Promise<QualificationResponse> {
  const validatedRequest = validateQualificationRequest(request);
  if (!apiKey?.trim()) {
    throw new QualificationError(
      "missing_credentials",
      "Gemini is not configured. Set GEMINI_API_KEY on the server to enable qualification.",
    );
  }

  let modelOutput: unknown;
  try {
    modelOutput = await extractFacts(validatedRequest);
  } catch (error) {
    if (error instanceof QualificationError) throw error;
    throw new QualificationError(
      "model_unavailable",
      "Gemini could not process this inquiry right now. Please try again later.",
    );
  }

  const facts = validateExtractedFacts(modelOutput, validatedRequest);
  const qualificationInput: QualificationInput = {
    service: facts.requestedService,
    businessUseCase: facts.businessUseCase,
    genuineBusinessUseCase: facts.genuineBusinessUseCase,
    budgetInr: facts.budgetInr,
  };
  const result = qualifyInquiry(qualificationInput, insightAnalyticsPolicy);

  return {
    extractedFacts: {
      requestedService: facts.requestedService,
      budgetInr: facts.budgetInr,
      businessUseCase: facts.businessUseCase,
      genuineBusinessUseCase: facts.genuineBusinessUseCase,
    },
    finalStatus: result.status,
    reason: result.reason,
    evidence: facts.evidence,
    missingInformation: result.missingFields,
  };
}
