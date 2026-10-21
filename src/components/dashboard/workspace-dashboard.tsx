"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { Activity, ArrowDownUp, Inbox, LoaderCircle, LogIn } from "lucide-react";
import { ActionLog } from "@/components/dashboard/action-log";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { ConversationPanel } from "@/components/dashboard/conversation-panel";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { CalendarBookingPanel } from "@/components/dashboard/calendar-booking-panel";
import { GmailIntegrationCard } from "@/components/dashboard/gmail-integration-card";
import { MetaIntegrationStatus } from "@/components/dashboard/meta-integration-status";
import { LeadDetailsPanel } from "@/components/dashboard/lead-details-panel";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { QualificationTestPanel } from "@/components/dashboard/qualification-test-panel";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { TakeoverControl } from "@/components/dashboard/takeover-control";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  ActionLogEntry,
  DashboardStats,
  Lead,
  Message,
} from "@/lib/types/lead";

type BrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

interface DashboardPayload {
  leads: Lead[];
  messages: Message[];
  actionLogs: ActionLogEntry[];
  stats: DashboardStats;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardPayload(value: unknown): value is DashboardPayload {
  if (
    !isRecord(value) ||
    !Array.isArray(value.leads) ||
    !Array.isArray(value.messages) ||
    !Array.isArray(value.actionLogs) ||
    !isRecord(value.stats)
  ) {
    return false;
  }
  const stats = value.stats;
  return [
    "totalLeads",
    "qualifiedLeads",
    "pendingFollowUps",
    "bookedMeetings",
  ].every((key) => typeof stats[key] === "number");
}

export function WorkspaceDashboard({
  policySection,
}: {
  policySection: ReactNode;
}) {
  const [client, setClient] = useState<BrowserClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const loadDashboard = useCallback(async (accessToken: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/dashboard", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Workspace data could not be loaded.";
        setLoadError(message);
        setDashboard(null);
        return;
      }
      if (!isDashboardPayload(body)) {
        setLoadError("The workspace returned an invalid data response.");
        setDashboard(null);
        return;
      }
      setDashboard(body);
      setSelectedLeadId((current) =>
        current && body.leads.some((lead) => lead.id === current)
          ? current
          : (body.leads[0]?.id ?? null),
      );
    } catch {
      setLoadError("Could not reach the workspace data endpoint.");
      setDashboard(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let browserClient: BrowserClient;
    try {
      browserClient = createSupabaseBrowserClient();
      if (active) setClient(browserClient);
    } catch {
      setLoadError(
        "Supabase sign-in is not configured. Add the public Supabase URL and anon key to the server environment.",
      );
      setIsLoading(false);
      return;
    }

    browserClient.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setLoadError("Could not restore your Supabase session. Please sign in.");
        setIsLoading(false);
        return;
      }
      setSession(data.session);
      if (data.session) void loadDashboard(data.session.access_token);
      else setIsLoading(false);
    });

    const {
      data: { subscription },
    } = browserClient.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setDashboard(null);
      if (nextSession) void loadDashboard(nextSession.access_token);
      else setIsLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadDashboard]);

  const selectedLead = useMemo(
    () =>
      dashboard?.leads.find((lead) => lead.id === selectedLeadId) ?? null,
    [dashboard?.leads, selectedLeadId],
  );

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSignInError(null);
    setIsSigningIn(true);
    try {
      if (!client) {
        setSignInError("Supabase sign-in is not configured.");
        return;
      }
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        setSignInError("Sign-in failed. Check your credentials and try again.");
      }
    } catch {
      setSignInError("Sign-in could not be completed. Please try again.");
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) setLoadError("Sign-out could not be completed. Please retry.");
  }

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="sign-in-title">
          <div className="auth-brand-mark">M</div>
          <p className="eyebrow">Mudita · Sales operations</p>
          <h1 id="sign-in-title">Sign in to your workspace</h1>
          <p>
            Access is limited to accounts linked to an active sales
            representative.
          </p>
          {loadError ? <p className="auth-message" role="alert">{loadError}</p> : null}
          <form onSubmit={handleSignIn} className="auth-form">
            <label htmlFor="workspace-email">Email</label>
            <input
              id="workspace-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <label htmlFor="workspace-password">Password</label>
            <input
              id="workspace-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {signInError ? (
              <p className="auth-message" role="alert">{signInError}</p>
            ) : null}
            <button type="submit" disabled={isSigningIn || !client}>
              {isSigningIn ? (
                <LoaderCircle aria-hidden="true" className="spin" size={16} />
              ) : (
                <LogIn aria-hidden="true" size={16} />
              )}
              {isSigningIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="auth-footnote">
            Accounts must be provisioned in Supabase Auth and linked to an
            active sales representative.
          </p>
        </section>
      </main>
    );
  }

  const leads = dashboard?.leads ?? [];
  const actionLogs = dashboard?.actionLogs ?? [];
  const stats = dashboard?.stats ?? {
    totalLeads: 0,
    qualifiedLeads: 0,
    pendingFollowUps: 0,
    bookedMeetings: 0,
  };

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="main-content" id="overview">
        <DashboardHeader
          userLabel={session.user.email ?? "Sales representative"}
          onSignOut={handleSignOut}
        />
        <div className="dashboard-content">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">Workspace overview</p>
              <h1>Sales overview</h1>
              <p className="welcome-copy">
                Keep every conversation moving forward.
              </p>
            </div>
            <div className="workspace-status" role="status">
              <span className={`status-dot ${loadError ? "offline" : ""}`} />
              <span>
                {loadError
                  ? "Workspace data unavailable"
                  : isLoading
                    ? "Loading workspace data"
                    : "Supabase workspace connected"}
              </span>
            </div>
          </div>

          {loadError ? (
            <div className="workspace-error" role="alert">
              {loadError}
              <button
                className="quiet-button"
                type="button"
                onClick={() => void loadDashboard(session.access_token)}
              >
                Retry
              </button>
            </div>
          ) : null}
          {isLoading && !dashboard ? (
            <div className="workspace-loading" role="status">
              <LoaderCircle aria-hidden="true" className="spin" size={18} />
              Loading persisted workspace data…
            </div>
          ) : null}

          <StatsCards stats={stats} />
          <GmailIntegrationCard
            accessToken={session.access_token}
            onSynced={() => void loadDashboard(session.access_token)}
          />
          <MetaIntegrationStatus accessToken={session.access_token} />
          {policySection}
          <QualificationTestPanel
            accessToken={session.access_token}
            onLeadSaved={() => void loadDashboard(session.access_token)}
          />

          <section className="leads-section" id="leads" aria-labelledby="leads-title">
            <div className="section-heading">
              <div>
                <div className="heading-title">
                  <h2 id="leads-title">Leads</h2>
                  <span className="count-pill">
                    {dashboard ? stats.totalLeads : "—"}
                  </span>
                </div>
                <p>Review persisted lead records and conversations.</p>
              </div>
              <div className="section-actions" aria-label="Lead table options">
                <span className="data-source-note">
                  <Inbox aria-hidden="true" size={15} />
                  {dashboard ? "Supabase · Latest 100 leads" : "Loading records"}
                </span>
                <button className="quiet-button" type="button" disabled>
                  <ArrowDownUp aria-hidden="true" size={15} />
                  Export
                </button>
              </div>
            </div>
            <LeadsTable
              leads={leads}
              selectedLeadId={selectedLeadId}
              onSelectLead={setSelectedLeadId}
            />
          </section>

          <section className="workspace-grid" aria-label="Lead workspace">
            <div className="conversation-column">
              <ConversationPanel
                lead={selectedLead}
                messages={dashboard?.messages ?? []}
              />
              <ActionLog entries={actionLogs} />
            </div>
            <aside className="details-column" aria-label="Lead information and controls">
              <LeadDetailsPanel lead={selectedLead} />
              <CalendarBookingPanel
                accessToken={session.access_token}
                lead={selectedLead}
              />
              <TakeoverControl
                accessToken={session.access_token}
                leadId={selectedLead?.id ?? null}
              />
            </aside>
          </section>

          <div className="footer-note">
            <Activity aria-hidden="true" size={14} />
            <span>Dashboard workspace · Gmail is inbound-only; no email replies are sent</span>
          </div>
        </div>
      </main>
    </div>
  );
}
