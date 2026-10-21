import assert from "node:assert/strict";
import test from "node:test";
import {
  qualifyInquiry,
  routeQualifiedInquiry,
  type QualificationInput,
} from "@/lib/policy";
import { insightAnalyticsPolicy as policy } from "@/lib/policy-config";

const completeInquiry: QualificationInput = {
  service: "sales_revenue_analytics",
  businessUseCase: "Forecasting revenue across our retail branches",
  genuineBusinessUseCase: true,
  budgetInr: 50_000,
};

test("qualifies a supported service at the minimum budget", () => {
  assert.deepEqual(qualifyInquiry(completeInquiry, policy), {
    status: "qualified",
    missingFields: [],
    reason: "meets_policy",
    matchedServiceId: "sales_revenue_analytics",
  });
});

test("requests missing information instead of rejecting the inquiry", () => {
  const result = qualifyInquiry(
    { ...completeInquiry, budgetInr: null, service: null },
    policy,
  );

  assert.equal(result.status, "needs_more_information");
  assert.deepEqual(result.missingFields, ["service", "budgetInr"]);
});

test("rejects an explicitly unsupported service when all required details exist", () => {
  const result = qualifyInquiry(
    { ...completeInquiry, service: "social media management" },
    policy,
  );

  assert.equal(result.status, "not_qualified");
  assert.equal(result.reason, "unsupported_service");
});

test("rejects a non-genuine business use case", () => {
  const result = qualifyInquiry(
    { ...completeInquiry, genuineBusinessUseCase: false },
    policy,
  );

  assert.equal(result.status, "not_qualified");
  assert.equal(result.reason, "not_a_genuine_business_use_case");
});

test("rejects a budget below the configured minimum", () => {
  const result = qualifyInquiry(
    { ...completeInquiry, budgetInr: 49_999 },
    policy,
  );

  assert.equal(result.status, "not_qualified");
  assert.equal(result.reason, "budget_below_minimum");
});

test("accepts a configured service name as well as its id", () => {
  const result = qualifyInquiry(
    { ...completeInquiry, service: "Sales and revenue analytics" },
    policy,
  );

  assert.equal(result.status, "qualified");
  assert.equal(result.matchedServiceId, "sales_revenue_analytics");
});

test("routes to the primary representative when explicitly available", () => {
  assert.deepEqual(
    routeQualifiedInquiry(
      "sales_revenue_analytics",
      { asha: "available" },
      policy,
    ),
    {
      status: "assigned",
      representativeId: "asha",
      usedFallback: false,
    },
  );
});

test("routes to the fallback only when primary unavailable and fallback available", () => {
  assert.deepEqual(
    routeQualifiedInquiry(
      "sales_revenue_analytics",
      { asha: "unavailable", rahul: "available" },
      policy,
    ),
    {
      status: "assigned",
      representativeId: "rahul",
      usedFallback: true,
    },
  );
});

test("does not assume primary availability when it has not been checked", () => {
  assert.deepEqual(
    routeQualifiedInquiry("sales_revenue_analytics", {}, policy),
    {
      status: "availability_unconfirmed",
      representativeId: null,
      checkingRepresentativeId: "asha",
    },
  );
});

test("does not assume fallback availability after primary is unavailable", () => {
  assert.deepEqual(
    routeQualifiedInquiry(
      "sales_revenue_analytics",
      { asha: "unavailable" },
      policy,
    ),
    {
      status: "availability_unconfirmed",
      representativeId: null,
      checkingRepresentativeId: "rahul",
    },
  );
});

test("reports no available representative when both are explicitly unavailable", () => {
  assert.deepEqual(
    routeQualifiedInquiry(
      "sales_revenue_analytics",
      { asha: "unavailable", rahul: "unavailable" },
      policy,
    ),
    {
      status: "no_available_representative",
      representativeId: null,
    },
  );
});
