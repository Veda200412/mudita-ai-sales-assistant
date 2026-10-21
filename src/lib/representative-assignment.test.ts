import assert from "node:assert/strict";
import test from "node:test";
import {
  assignQualifiedLead,
  runAuthorizedRepresentativeAction,
  type AssignmentOutcome,
  type RepresentativeAssignmentRepository,
} from "@/lib/representative-assignment";

function makeRepository(
  controls: Awaited<ReturnType<RepresentativeAssignmentRepository["getControls"]>> = [],
) {
  let assignedRepresentativeId: string | null = null;
  const outcomes: AssignmentOutcome[] = [];
  const repository: RepresentativeAssignmentRepository = {
    async getLead() {
      return {
        status: "qualified",
        assignedRepresentativeId,
        serviceId: "sales_revenue_analytics",
      };
    },
    async getControls() {
      return controls;
    },
    async findActiveRepresentative(representativeId) {
      return { id: `${representativeId}-database-id` };
    },
    async assignLead(_leadId, representativeId) {
      if (assignedRepresentativeId) return false;
      assignedRepresentativeId = representativeId;
      return true;
    },
    async unassignLead(_leadId, representativeId) {
      if (assignedRepresentativeId === representativeId) {
        assignedRepresentativeId = null;
      }
    },
    async recordOutcome({ outcome }) {
      outcomes.push(outcome);
    },
  };
  return {
    repository,
    outcomes,
    assigned: () => assignedRepresentativeId,
  };
}

const base = {
  leadId: "lead-1",
  actorUserId: "active-user",
  channel: "email" as const,
};

test("leaves qualified lead unassigned and records why availability is unknown", async () => {
  const store = makeRepository();
  const outcome = await assignQualifiedLead({
    ...base,
    repository: store.repository,
  });
  assert.deepEqual(outcome, {
    status: "unassigned",
    reason: "availability_unconfirmed",
    checkingRepresentativeId: "asha",
  });
  assert.equal(store.assigned(), null);
  assert.equal(store.outcomes.length, 1);
});

test("uses policy primary when a verified source confirms availability", async () => {
  const store = makeRepository();
  const outcome = await assignQualifiedLead({
    ...base,
    repository: store.repository,
    availabilitySource: async () => ({
      verified: true,
      availability: { asha: "available" },
    }),
  });
  assert.deepEqual(outcome, {
    status: "assigned",
    representativeId: "asha-database-id",
    usedFallback: false,
  });
  assert.equal(store.assigned(), "asha-database-id");
  assert.equal(store.outcomes.length, 1);
});

test("uses configured fallback only after primary is verified unavailable", async () => {
  const store = makeRepository();
  const outcome = await assignQualifiedLead({
    ...base,
    repository: store.repository,
    availabilitySource: async () => ({
      verified: true,
      availability: { asha: "unavailable", rahul: "available" },
    }),
  });
  assert.deepEqual(outcome, {
    status: "assigned",
    representativeId: "rahul-database-id",
    usedFallback: true,
  });
  assert.equal(store.assigned(), "rahul-database-id");
});

test("does not trust availability data unless its source is verified", async () => {
  const store = makeRepository();
  const outcome = await assignQualifiedLead({
    ...base,
    repository: store.repository,
    availabilitySource: async () => ({
      verified: false,
      availability: { asha: "available" },
    }),
  });
  assert.deepEqual(outcome, {
    status: "unassigned",
    reason: "availability_unconfirmed",
    checkingRepresentativeId: "asha",
  });
  assert.equal(store.assigned(), null);
});

test("does not assign during workspace or per-lead takeover and records the pause", async () => {
  for (const control of [
    { leadId: null, channel: "email" as const, isEnabled: false },
    { leadId: "lead-1", channel: null, isEnabled: false },
  ]) {
    const store = makeRepository([control]);
    const outcome = await assignQualifiedLead({
      ...base,
      repository: store.repository,
      availabilitySource: async () => {
        throw new Error("availability must not be checked during takeover");
      },
    });
    assert.deepEqual(outcome, { status: "unassigned", reason: "takeover_active" });
    assert.equal(store.assigned(), null);
    assert.deepEqual(store.outcomes, [outcome]);
  }
});

test("authorization failure prevents qualified lead assignment work", async () => {
  let assignmentStarted = false;
  await assert.rejects(
    runAuthorizedRepresentativeAction(
      new Request("https://example.test/api/leads"),
      async () => {
        throw new Error("unauthorized");
      },
      async () => {
        assignmentStarted = true;
      },
    ),
    /unauthorized/,
  );
  assert.equal(assignmentStarted, false);
});

test("rolls back assignment if audit persistence fails", async () => {
  const store = makeRepository();
  const repository = {
    ...store.repository,
    async recordOutcome() {
      throw new Error("audit failure");
    },
  };
  await assert.rejects(
    assignQualifiedLead({
      ...base,
      repository,
      availabilitySource: async () => ({
        verified: true,
        availability: { asha: "available" },
      }),
    }),
    /audit failure/,
  );
  assert.equal(store.assigned(), null);
});
