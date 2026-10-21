import "server-only";

import { BadgeIndianRupee, BriefcaseBusiness, Clock3, UsersRound } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { insightAnalyticsPolicy as policy } from "@/lib/policy-config";

export function PolicySection() {
  return (
    <SectionCard
      title={`${policy.businessName} policy`}
      description="Server-configured qualification, assignment, and working hours."
      className="policy-card"
      titleId="policy-title"
    >
        <h3 className="policy-subheading">
          <BriefcaseBusiness aria-hidden="true" size={15} />
          Supported services
        </h3>
        <ul className="policy-service-list">
          {policy.services.map((service) => (
            <li key={service.id}>{service.name}</li>
          ))}
        </ul>

        <div className="policy-divider" />
        <h3 className="policy-subheading">
          <BadgeIndianRupee aria-hidden="true" size={15} />
          Qualification
        </h3>
        <ul className="policy-criteria-list">
          <li>Inquiry matches a supported service.</li>
          <li>Genuine business use case is established.</li>
          <li>Minimum budget: INR {policy.qualification.minimumBudgetInr.toLocaleString("en-IN")}.</li>
          <li>Missing required information means more information is needed.</li>
        </ul>
        <div className="policy-statuses">
          {policy.qualification.statuses.map((status) => (
            <span className={`policy-status ${status}`} key={status}>
              {status.replaceAll("_", " ")}
            </span>
          ))}
        </div>

        <div className="policy-divider" />
        <h3 className="policy-subheading">
          <UsersRound aria-hidden="true" size={15} />
          Representatives and routing
        </h3>
        <ul className="policy-rep-list">
          {policy.representatives.map((representative) => (
            <li key={representative.id}>
              <strong>{representative.name}</strong>
              <span>{representative.expertise.join(" · ")}</span>
            </li>
          ))}
        </ul>
        <p className="policy-note">
          Service-specific primary and fallback assignments are explicit. Availability must be checked; it is never presumed.
        </p>

        <div className="policy-divider" />
        <h3 className="policy-subheading">
          <Clock3 aria-hidden="true" size={15} />
          Working hours
        </h3>
        <p className="policy-hours">
          {policy.workingHours.days[0]}–{policy.workingHours.days[4]}, {policy.workingHours.start}–{policy.workingHours.end} ({policy.workingHours.timeZone})
        </p>
    </SectionCard>
  );
}
