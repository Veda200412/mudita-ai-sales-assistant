import { WorkspaceDashboard } from "@/components/dashboard/workspace-dashboard";
import { PolicySection } from "@/components/dashboard/policy-section";

export default function HomePage() {
  return <WorkspaceDashboard policySection={<PolicySection />} />;
}
