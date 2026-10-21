import { NextResponse } from "next/server";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type {
  ActionLogEntry,
  Lead,
  Message,
  SalesRepresentative,
} from "@/lib/types/lead";
import type { Json } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isJsonObject(
  value: Json,
): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  try {
    await authorizeActiveRepresentative(request);
    const client = createSupabaseAdminClient();
    const [
      { data: leadRows, error: leadsError },
      totalLeadsResult,
      qualifiedLeadsResult,
      followUpsResult,
      meetingsResult,
    ] = await Promise.all([
      client
        .from("leads")
        .select(
          "id,full_name,email,company,channel,status,assigned_representative_id,qualification_evidence,last_activity_at,created_at",
        )
        .order("last_activity_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(100),
      client.from("leads").select("id", { count: "exact", head: true }),
      client
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "qualified"),
      client
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "follow_up"),
      client
        .from("meetings")
        .select("id", { count: "exact", head: true })
        .eq("status", "confirmed"),
    ]);

    const countError = [
      totalLeadsResult.error,
      qualifiedLeadsResult.error,
      followUpsResult.error,
      meetingsResult.error,
    ].find(Boolean);
    if (leadsError || countError) {
      console.error("[dashboard] Lead query failed", {
        code: leadsError?.code ?? countError?.code ?? "unknown",
      });
      return NextResponse.json(
        { error: "Persisted leads could not be loaded." },
        { status: 503 },
      );
    }

    const leads = leadRows ?? [];
    const allLeadIds = leads.map((lead) => lead.id);
    const representativeIds = Array.from(
      new Set(
        leads.flatMap((lead) =>
          lead.assigned_representative_id
            ? [lead.assigned_representative_id]
            : [],
        ),
      ),
    );
    const [
      messageResult,
      actionLogResult,
      ignoredCleanupResult,
      representativesResult,
      cleanupSummaryResult,
    ] = await Promise.all([
      allLeadIds.length > 0
          ? client
              .from("messages")
              .select("id,lead_id,direction,body,sent_at")
              .in("lead_id", allLeadIds)
              .order("sent_at", { ascending: true })
              .limit(1000)
          : Promise.resolve({ data: [], error: null }),
      allLeadIds.length > 0
          ? client
              .from("action_logs")
              .select("id,lead_id,action_type,summary,created_at")
              .in("lead_id", allLeadIds)
              .order("created_at", { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
      client
          .from("action_logs")
          .select("lead_id")
          .eq("action_type", "gmail_cleanup_ignored")
          .contains("metadata", { source: "historical_lead_cleanup" })
          .limit(5000),
      representativeIds.length > 0
          ? client
              .from("sales_representatives")
              .select("id,display_name,email,is_active")
              .in("id", representativeIds)
          : Promise.resolve({ data: [], error: null }),
      client
          .from("action_logs")
          .select("id,lead_id,action_type,summary,created_at")
          .eq("action_type", "gmail_cleanup_confirmed")
          .order("created_at", { ascending: false })
          .limit(25),
    ]);

    const failedResult = [
      messageResult.error,
      actionLogResult.error,
      ignoredCleanupResult.error,
      representativesResult.error,
      cleanupSummaryResult.error,
    ].find(Boolean);
    if (failedResult) {
      console.error("[dashboard] Related-record query failed", {
        code: failedResult.code ?? "unknown",
      });
      return NextResponse.json(
        { error: "Lead conversations could not be loaded." },
        { status: 503 },
      );
    }

    const ignoredLeadIds = new Set([
      ...(ignoredCleanupResult.data ?? []).flatMap((entry) =>
        entry.lead_id ? [entry.lead_id] : [],
      ),
      ...(actionLogResult.data ?? []).flatMap((entry) =>
        entry.action_type === "gmail_cleanup_ignored" && entry.lead_id
          ? [entry.lead_id]
          : [],
      ),
    ]);
    const visibleLeads = leads.filter((lead) => !ignoredLeadIds.has(lead.id));
    const representatives = new Map<string, SalesRepresentative>(
      (representativesResult.data ?? []).map((representative) => [
        representative.id,
        {
          id: representative.id,
          displayName: representative.display_name,
          email: representative.email,
          isActive: representative.is_active,
        },
      ]),
    );
    const mappedLeads: Lead[] = [];
    for (const lead of visibleLeads) {
      if (!isJsonObject(lead.qualification_evidence)) {
        console.error(
          "[dashboard] Lead qualification evidence has invalid shape",
        );
        return NextResponse.json(
          { error: "Lead details could not be loaded safely." },
          { status: 503 },
        );
      }
      mappedLeads.push({
        id: lead.id,
        fullName: lead.full_name,
        email: lead.email,
        company: lead.company,
        channel: lead.channel,
        status: lead.status,
        assignedRepresentative: lead.assigned_representative_id
          ? (representatives.get(lead.assigned_representative_id) ?? null)
          : null,
        qualificationEvidence: lead.qualification_evidence,
        lastActivityAt: lead.last_activity_at,
        createdAt: lead.created_at,
      });
    }
    const messages: Message[] = (messageResult.data ?? []).map((message) => ({
      id: message.id,
      leadId: message.lead_id,
      direction: message.direction,
      body: message.body,
      sentAt: message.sent_at,
    }));
    const actionLogs: ActionLogEntry[] = [
      ...(actionLogResult.data ?? []).filter(
        (entry) =>
          entry.action_type === "gmail_cleanup_ignored" ||
          !entry.lead_id ||
          !ignoredLeadIds.has(entry.lead_id),
      ),
      ...(cleanupSummaryResult.data ?? []),
    ].map((entry) => ({
      id: entry.id,
      leadId: entry.lead_id,
      actionType: entry.action_type,
      summary: entry.summary,
      createdAt: entry.created_at,
    }));

    return NextResponse.json({
      leads: mappedLeads,
      messages,
      actionLogs,
      stats: {
        totalLeads: Math.max(
          0,
          (totalLeadsResult.count ?? 0) - ignoredLeadIds.size,
        ),
        qualifiedLeads: Math.max(
          0,
          (qualifiedLeadsResult.count ?? 0) -
            leads.filter(
              (lead) =>
                ignoredLeadIds.has(lead.id) && lead.status === "qualified",
            ).length,
        ),
        pendingFollowUps: Math.max(
          0,
          (followUpsResult.count ?? 0) -
            leads.filter(
              (lead) =>
                ignoredLeadIds.has(lead.id) && lead.status === "follow_up",
            ).length,
        ),
        bookedMeetings: meetingsResult.count ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[dashboard] Unexpected data loading failure");
    return NextResponse.json(
      { error: "Dashboard data could not be loaded." },
      { status: 500 },
    );
  }
}
