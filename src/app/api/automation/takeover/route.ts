import { NextResponse } from "next/server";
import {
  AutomationControlError,
  automationChannels,
  createAutomationControlRepository,
} from "@/lib/supabase/automation-control-repository";
import {
  applyAuthorizedWorkspaceTakeover,
  workspaceTakeoverState,
} from "@/lib/automation-controls";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function makeRepository() {
  return createAutomationControlRepository(createSupabaseAdminClient());
}

export async function GET(request: Request) {
  try {
    await authorizeActiveRepresentative(request);
    const leadId = new URL(request.url).searchParams.get("leadId");
    if (leadId && !isUuid(leadId)) {
      return NextResponse.json({ error: "leadId must be a UUID." }, { status: 400 });
    }
    const repository = makeRepository();
    const [workspaceRows, leadRows] = await Promise.all([
      repository.getWorkspaceControls(),
      leadId ? repository.getLeadControls(leadId) : Promise.resolve([]),
    ]);
    if (leadId) {
      const { data: lead, error } = await createSupabaseAdminClient()
        .from("leads")
        .select("id")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw new AutomationControlError();
      if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    }
    const controls = [...workspaceRows, ...leadRows].map((row) => ({
      leadId: row.lead_id,
      channel: row.channel,
      isEnabled: row.is_enabled,
    }));
    const state = workspaceTakeoverState(controls, automationChannels);
    return NextResponse.json({
      takeoverActive: state.active,
      partiallyActive: state.partiallyActive,
      leadId,
      leadTakeoverActive: leadRows.some((row) => !row.is_enabled),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[automation-controls] State could not be loaded");
    return NextResponse.json(
      { error: "Automation state could not be loaded." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body) || typeof body.takeover !== "boolean") {
      return NextResponse.json(
        { error: "takeover must be a boolean." },
        { status: 400 },
      );
    }
    const scope = body.scope === undefined ? "workspace" : body.scope;
    if (scope !== "workspace" && scope !== "lead") {
      return NextResponse.json(
        { error: "scope must be workspace or lead." },
        { status: 400 },
      );
    }
    if (scope === "workspace") {
      if (body.leadId !== undefined) {
        return NextResponse.json(
          { error: "leadId is not valid for workspace takeover." },
          { status: 400 },
        );
      }
      await applyAuthorizedWorkspaceTakeover(
        request,
        authorizeActiveRepresentative,
        makeRepository,
        body.takeover,
      );
      return NextResponse.json({
        takeoverActive: body.takeover,
        partiallyActive: false,
      });
    }
    if (!isUuid(body.leadId)) {
      return NextResponse.json(
        { error: "A valid leadId is required for lead takeover." },
        { status: 400 },
      );
    }
    const actor = await authorizeActiveRepresentative(request);
    const repository = makeRepository();
    const client = createSupabaseAdminClient();
    const { data: lead, error } = await client
      .from("leads")
      .select("id")
      .eq("id", body.leadId)
      .maybeSingle();
    if (error) throw new AutomationControlError();
    if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    const { error: upsertError } = await client
      .from("automation_controls")
      .upsert({
        lead_id: body.leadId,
        channel: null,
        is_enabled: !body.takeover,
        updated_by: actor.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "lead_id,channel" });
    if (upsertError) throw new AutomationControlError();
    await repository.recordChange(
      actor.userId,
      body.takeover,
      "lead",
      body.leadId,
    );
    return NextResponse.json({
      takeoverActive: body.takeover,
      leadId: body.leadId,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AutomationControlError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[automation-controls] State could not be updated");
    return NextResponse.json(
      { error: "Automation state could not be updated." },
      { status: 503 },
    );
  }
}
