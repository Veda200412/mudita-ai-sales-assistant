import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Mudita Sales Assistant",
  description:
    "Learn how Mudita Sales Assistant handles inquiry, lead, and conversation data.",
};

const policySections = [
  {
    title: "Information we collect",
    content: (
      <>
        <p>
          When an account owner connects a supported channel, Mudita Sales
          Assistant processes information needed to manage sales inquiries.
          This can include:
        </p>
        <ul>
          <li>
            Incoming Instagram and WhatsApp message text, sender name when
            available, and provider message, thread, and sender identifiers.
          </li>
          <li>
            Gmail inquiry content and related details such as sender name,
            sender email address, subject, message and thread identifiers, and
            message time. Gmail sync is read-only and checks up to 50 recent
            inbox messages from the previous 30 days each time it runs.
          </li>
          <li>
            Lead details and sales qualification information, such as the
            requested service, stated budget, business use case, qualification
            status, and supporting message evidence.
          </li>
          <li>
            Account and operational information needed to provide the
            application, such as representative account identifiers and
            integration or processing logs.
          </li>
        </ul>
        <p>
          Gmail messages that are recognized as automated or otherwise not
          relevant may be ignored as leads, but an operational record of that
          result may still be stored.
        </p>
      </>
    ),
  },
  {
    title: "How we use information",
    content: (
      <>
        <p>
          We use incoming inquiries to create or update leads, show conversation
          history to authorized workspace representatives, and help prioritize
          follow-up. Gemini AI processes the inquiry text and any provided
          structured business details to extract explicitly stated sales facts.
          The application stores qualification results and supporting evidence
          with the lead.
        </p>
        <p>
          AI output is used as assistance for sales qualification and may be
          incomplete or incorrect. Representatives should review the underlying
          inquiry before acting on a result.
        </p>
      </>
    ),
  },
  {
    title: "Storage and retention",
    content: (
      <>
        <p>
          Lead, message, qualification, and operational records are stored in
          the application&apos;s Supabase database. The application does not
          currently apply a fixed automatic deletion schedule or offer
          self-service deletion. Records remain stored until the developer
          removes them in response to a request or through manual maintenance.
        </p>
        <p>
          Some operational log entries may not be removed automatically when a
          lead is removed. Contact the developer if you want related records
          reviewed as part of a deletion request.
        </p>
      </>
    ),
  },
  {
    title: "Service providers and sharing",
    content: (
      <>
        <p>
          Information is shared with providers only as needed to operate
          connected features:
        </p>
        <ul>
          <li>
            Meta receives messages through its Instagram and WhatsApp
            platforms, and delivers inbound message events to the application
            when those channels are configured.
          </li>
          <li>
            Google provides Gmail access for a connected account and Gemini AI
            processing for inquiry qualification.
          </li>
          <li>
            Supabase provides the application database and account services.
          </li>
        </ul>
        <p>
          These providers process information under their own terms and privacy
          practices. The application does not send Gmail replies. Authorized
          workspace representatives can view lead and conversation information
          in the application.
        </p>
      </>
    ),
  },
  {
    title: "Security",
    content: (
      <p>
        The application uses authenticated access for workspace data and keeps
        privileged integration credentials on the server. Stored Google OAuth
        credentials are encrypted by the application. No online system can be
        guaranteed to be completely secure, and we do not claim independent
        security certifications.
      </p>
    ),
  },
  {
    title: "Your choices and deletion requests",
    content: (
      <>
        <p>
          Revoking or disabling a channel connection at its provider can stop
          future data from being retrieved or delivered through that
          connection. This does not delete information already stored in the
          application.
        </p>
        <p>
          To request access to or deletion of information about you, email{" "}
          <a href="mailto:vedapoyarekar12@gmail.com">
            vedapoyarekar12@gmail.com
          </a>
          . Include the channel involved and enough information to identify the
          relevant conversation, but do not send passwords or access tokens.
          The application does not currently provide a self-service deletion
          feature; the developer will review requests and handle them
          individually.
        </p>
      </>
    ),
  },
  {
    title: "Contact",
    content: (
      <p>
        Questions about this policy or a request concerning your data can be
        sent to{" "}
        <a href="mailto:vedapoyarekar12@gmail.com">
          vedapoyarekar12@gmail.com
        </a>
        .
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link className="privacy-brand" href="/" aria-label="Mudita home">
          <span className="privacy-brand-mark" aria-hidden="true">
            M
          </span>
          <span>
            Mudita<span className="privacy-brand-accent">.</span>
          </span>
        </Link>
        <Link className="privacy-back-link" href="/">
          Back to app
        </Link>
      </header>

      <article className="privacy-content">
        <div className="privacy-intro">
          <p className="privacy-eyebrow">MUDITA SALES ASSISTANT</p>
          <h1>Privacy Policy</h1>
          <p className="privacy-updated">Last updated: October 21, 2026</p>
          <p className="privacy-summary">
            This policy explains how Mudita Sales Assistant processes
            information from connected Instagram, WhatsApp, and Gmail inquiries
            and uses AI to help qualify sales leads.
          </p>
        </div>

        <div className="privacy-sections">
          {policySections.map(({ title, content }, index) => (
            <section className="privacy-section" key={title}>
              <span className="privacy-section-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h2>{title}</h2>
                <div className="privacy-section-copy">{content}</div>
              </div>
            </section>
          ))}
        </div>

        <footer className="privacy-footer">
          <span>Mudita Sales Assistant</span>
          <span>Questions? Email the developer</span>
        </footer>
      </article>
    </main>
  );
}
