import type { SalesPolicy } from "@/lib/policy";

export const insightAnalyticsPolicy = {
  businessName: "Insight Analytics",
  services: [
    {
      id: "sales_revenue_analytics",
      name: "Sales and revenue analytics",
    },
    {
      id: "customer_behaviour_analytics",
      name: "Customer behaviour analytics",
    },
    {
      id: "business_dashboards_reporting",
      name: "Business dashboards and reporting",
    },
  ],
  qualification: {
    minimumBudgetInr: 50_000,
    requiredInformation: [
      "service",
      "businessUseCase",
      "genuineBusinessUseCase",
      "budgetInr",
    ],
    statuses: [
      "qualified",
      "not_qualified",
      "needs_more_information",
    ],
  },
  representatives: [
    {
      id: "asha",
      name: "Asha",
      expertise: ["Sales and revenue analytics"],
    },
    {
      id: "rahul",
      name: "Rahul",
      expertise: [
        "Customer behaviour analytics",
        "Business dashboards and reporting",
      ],
    },
  ],
  routingRules: {
    sales_revenue_analytics: {
      primary: "asha",
      fallback: "rahul",
    },
    customer_behaviour_analytics: {
      primary: "rahul",
      fallback: "asha",
    },
    business_dashboards_reporting: {
      primary: "rahul",
      fallback: "asha",
    },
  },
  workingHours: {
    timeZone: "Asia/Kolkata",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    start: "10:00",
    end: "18:00",
  },
} as const satisfies SalesPolicy;
