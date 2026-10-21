export const qualificationStatuses = [
  "qualified",
  "not_qualified",
  "needs_more_information",
] as const;

export type QualificationStatus = (typeof qualificationStatuses)[number];

export type SupportedServiceId =
  | "sales_revenue_analytics"
  | "customer_behaviour_analytics"
  | "business_dashboards_reporting";

export type RepresentativeId = "asha" | "rahul";
export type QualificationInformationField =
  | "service"
  | "businessUseCase"
  | "genuineBusinessUseCase"
  | "budgetInr";

export interface SalesPolicy {
  businessName: string;
  services: readonly {
    id: SupportedServiceId;
    name: string;
  }[];
  qualification: {
    minimumBudgetInr: number;
    requiredInformation: readonly QualificationInformationField[];
    statuses: readonly QualificationStatus[];
  };
  representatives: readonly {
    id: RepresentativeId;
    name: string;
    expertise: readonly string[];
  }[];
  routingRules: Readonly<
    Record<
      SupportedServiceId,
      {
        primary: RepresentativeId;
        fallback: RepresentativeId;
      }
    >
  >;
  workingHours: {
    timeZone: string;
    days: readonly string[];
    start: string;
    end: string;
  };
}

export type QualificationInput = {
  service: string | null;
  businessUseCase: string | null;
  genuineBusinessUseCase: boolean | null;
  budgetInr: number | null;
};

export type QualificationResult =
  | {
      status: "needs_more_information";
      missingFields: readonly QualificationInformationField[];
      reason: "required_information_missing";
      matchedServiceId: null;
    }
  | {
      status: "not_qualified";
      missingFields: readonly [];
      reason:
        | "unsupported_service"
        | "not_a_genuine_business_use_case"
        | "budget_below_minimum";
      matchedServiceId: SupportedServiceId | null;
    }
  | {
      status: "qualified";
      missingFields: readonly [];
      reason: "meets_policy";
      matchedServiceId: SupportedServiceId;
    };

export type RepresentativeAvailability = Partial<
  Record<RepresentativeId, "available" | "unavailable">
>;

export type RoutingResult =
  | {
      status: "assigned";
      representativeId: RepresentativeId;
      usedFallback: boolean;
    }
  | {
      status: "availability_unconfirmed";
      representativeId: null;
      checkingRepresentativeId: RepresentativeId;
    }
  | {
      status: "no_available_representative";
      representativeId: null;
    };

export function qualifyInquiry(
  input: QualificationInput,
  policy: SalesPolicy,
): QualificationResult {
  const hasInformation: Record<QualificationInformationField, boolean> = {
    service: Boolean(input.service?.trim()),
    businessUseCase: Boolean(input.businessUseCase?.trim()),
    genuineBusinessUseCase:
      typeof input.genuineBusinessUseCase === "boolean",
    budgetInr:
      typeof input.budgetInr === "number" &&
      Number.isFinite(input.budgetInr),
  };
  const missingFields = policy.qualification.requiredInformation.filter(
    (field) => !hasInformation[field],
  );

  if (missingFields.length > 0) {
    return {
      status: "needs_more_information",
      missingFields,
      reason: "required_information_missing",
      matchedServiceId: null,
    };
  }

  const normalizedService =
    input.service?.trim().toLocaleLowerCase("en-IN") ?? "";
  const matchedService = policy.services.find(
    (service) =>
      service.id.toLocaleLowerCase("en-IN") === normalizedService ||
      service.name.toLocaleLowerCase("en-IN") === normalizedService,
  );

  if (!matchedService) {
    return {
      status: "not_qualified",
      missingFields: [],
      reason: "unsupported_service",
      matchedServiceId: null,
    };
  }

  if (input.genuineBusinessUseCase !== true) {
    return {
      status: "not_qualified",
      missingFields: [],
      reason: "not_a_genuine_business_use_case",
      matchedServiceId: matchedService.id,
    };
  }

  if (
    typeof input.budgetInr === "number" &&
    input.budgetInr < policy.qualification.minimumBudgetInr
  ) {
    return {
      status: "not_qualified",
      missingFields: [],
      reason: "budget_below_minimum",
      matchedServiceId: matchedService.id,
    };
  }

  return {
    status: "qualified",
    missingFields: [],
    reason: "meets_policy",
    matchedServiceId: matchedService.id,
  };
}

export function routeQualifiedInquiry(
  serviceId: SupportedServiceId,
  availability: RepresentativeAvailability,
  policy: SalesPolicy,
): RoutingResult {
  const rule = policy.routingRules[serviceId];
  const primaryAvailability = availability[rule.primary];

  if (primaryAvailability === "available") {
    return {
      status: "assigned",
      representativeId: rule.primary,
      usedFallback: false,
    };
  }

  if (primaryAvailability === undefined) {
    return {
      status: "availability_unconfirmed",
      representativeId: null,
      checkingRepresentativeId: rule.primary,
    };
  }

  const fallbackAvailability = availability[rule.fallback];
  if (fallbackAvailability === "available") {
    return {
      status: "assigned",
      representativeId: rule.fallback,
      usedFallback: true,
    };
  }

  if (fallbackAvailability === undefined) {
    return {
      status: "availability_unconfirmed",
      representativeId: null,
      checkingRepresentativeId: rule.fallback,
    };
  }

  return {
    status: "no_available_representative",
    representativeId: null,
  };
}
