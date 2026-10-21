export type AutomationChannel = "email" | "instagram" | "whatsapp";
export type AutomatedAction =
  | "qualification_follow_up"
  | "assignment"
  | "booking";

export interface AutomationControlState {
  leadId: string | null;
  channel: AutomationChannel | null;
  isEnabled: boolean;
}

export async function applyAuthorizedWorkspaceTakeover(
  request: Request,
  authorize: (request: Request) => Promise<{ userId: string }>,
  createRepository: () => {
    setWorkspaceTakeover(actorUserId: string, takeover: boolean): Promise<void>;
    recordChange(
      actorUserId: string,
      takeover: boolean,
      scope: "workspace",
    ): Promise<void>;
  },
  takeover: boolean,
): Promise<void> {
  const actor = await authorize(request);
  const repository = createRepository();
  await repository.setWorkspaceTakeover(actor.userId, takeover);
  await repository.recordChange(actor.userId, takeover, "workspace");
}

export function workspaceControlRows(
  actorUserId: string,
  takeover: boolean,
  updatedAt: string,
) {
  return (["email", "instagram", "whatsapp"] as const).map((channel) => ({
    lead_id: null,
    channel,
    is_enabled: !takeover,
    updated_by: actorUserId,
    updated_at: updatedAt,
  }));
}

export function isAutomatedActionAllowed(input: {
  controls: AutomationControlState[];
  action: AutomatedAction;
  channel: AutomationChannel;
  leadId?: string | null;
  initiatedBy: "automation" | "human";
}): boolean {
  if (input.initiatedBy === "human") return true;
  const requiresAutomationGuard =
    input.action === "qualification_follow_up" ||
    input.action === "assignment" ||
    input.action === "booking";
  if (!requiresAutomationGuard) return true;
  const channelPaused = input.controls.some(
    (control) =>
      control.leadId === null &&
      control.channel === input.channel &&
      !control.isEnabled,
  );
  const leadPaused =
    input.leadId != null &&
    input.controls.some(
      (control) =>
        control.leadId === input.leadId &&
        !control.isEnabled,
    );
  return !channelPaused && !leadPaused;
}

export function workspaceTakeoverState(
  controls: AutomationControlState[],
  channels: readonly AutomationChannel[],
): { active: boolean; partiallyActive: boolean } {
  const pausedCount = channels.filter((channel) =>
    controls.some(
      (control) =>
        control.leadId === null &&
        control.channel === channel &&
        !control.isEnabled,
    ),
  ).length;
  return {
    active: pausedCount === channels.length,
    partiallyActive: pausedCount > 0 && pausedCount < channels.length,
  };
}
