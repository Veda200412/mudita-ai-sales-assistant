import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAuthorizedWorkspaceTakeover,
  isAutomatedActionAllowed,
  workspaceControlRows,
  workspaceTakeoverState,
} from "@/lib/automation-controls";

const actions = ["qualification_follow_up", "assignment", "booking"] as const;
const pausedEmail = [{
  leadId: null,
  channel: "email" as const,
  isEnabled: false,
}];

test("workspace takeover persists disabled controls for every supported channel", () => {
  const rows = workspaceControlRows("representative-user", true, "2026-10-21T12:00:00Z");
  assert.deepEqual(rows.map((row) => row.channel), ["email", "instagram", "whatsapp"]);
  assert.ok(rows.every((row) => row.is_enabled === false));
  assert.ok(rows.every((row) => row.updated_by === "representative-user"));
  assert.deepEqual(
    workspaceTakeoverState(
      rows.map((row) => ({
        leadId: row.lead_id,
        channel: row.channel,
        isEnabled: row.is_enabled,
      })),
      ["email", "instagram", "whatsapp"],
    ),
    { active: true, partiallyActive: false },
  );
});

test("workspace update authorizes before persisting the control state", async () => {
  const request = new Request("https://example.test/api/automation/takeover");
  let savedBy: string | null = null;
  let takeoverValue: boolean | null = null;
  const repository = {
    async setWorkspaceTakeover(actorUserId: string, takeover: boolean) {
      savedBy = actorUserId;
      takeoverValue = takeover;
    },
    async recordChange() {},
  };

  await assert.rejects(
    applyAuthorizedWorkspaceTakeover(
      request,
      async () => {
        throw new Error("unauthorized");
      },
      () => repository,
      true,
    ),
    /unauthorized/,
  );
  assert.equal(savedBy, null);
  assert.equal(takeoverValue, null);

  await applyAuthorizedWorkspaceTakeover(
    request,
    async () => ({ userId: "active-representative" }),
    () => repository,
    true,
  );
  assert.equal(savedBy, "active-representative");
  assert.equal(takeoverValue, true);
});

test("takeover blocks automated qualification follow-ups, assignment, and bookings", () => {
  for (const action of actions) {
    assert.equal(
      isAutomatedActionAllowed({
        controls: pausedEmail,
        action,
        channel: "email",
        leadId: "lead-1",
        initiatedBy: "automation",
      }),
      false,
      `${action} should be paused`,
    );
  }
});

test("lead-specific takeover pauses that lead but allows other leads", () => {
  const leadControl = [{ leadId: "lead-1", channel: null, isEnabled: false }];
  assert.equal(
    isAutomatedActionAllowed({
      controls: leadControl,
      action: "assignment",
      channel: "email",
      leadId: "lead-1",
      initiatedBy: "automation",
    }),
    false,
  );
  assert.equal(
    isAutomatedActionAllowed({
      controls: leadControl,
      action: "assignment",
      channel: "email",
      leadId: "lead-2",
      initiatedBy: "automation",
    }),
    true,
  );
});

test("human-initiated actions and inbound ingestion remain allowed during takeover", () => {
  assert.equal(
    isAutomatedActionAllowed({
      controls: pausedEmail,
      action: "booking",
      channel: "email",
      leadId: "lead-1",
      initiatedBy: "human",
    }),
    true,
  );
});

test("workspace status reports a partial pause instead of claiming full takeover", () => {
  assert.deepEqual(
    workspaceTakeoverState(pausedEmail, ["email", "instagram", "whatsapp"]),
    { active: false, partiallyActive: true },
  );
});
