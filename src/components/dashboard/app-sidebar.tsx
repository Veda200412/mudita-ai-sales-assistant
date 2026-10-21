import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ContactRound,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  Settings2,
  Sparkles,
} from "lucide-react";

const navigation = [
  { label: "Overview", href: "#overview", icon: LayoutDashboard, active: true },
  { label: "Leads", href: "#leads", icon: ContactRound, active: false },
  { label: "Inbox", href: "#conversation", icon: Inbox, active: false },
  { label: "Meetings", href: "#meetings", icon: CalendarDays, active: false },
  { label: "Activity", href: "#activity", icon: BarChart3, active: false },
];

export function AppSidebar() {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <a className="brand" href="#overview" aria-label="Mudita home">
        <span className="brand-mark"><Sparkles aria-hidden="true" size={19} /></span>
        <span className="brand-name">mudita<span>.</span></span>
      </a>

      <button className="workspace-switcher" type="button" aria-label="Current workspace">
        <span className="workspace-avatar">M</span>
        <span className="workspace-copy">
          <span className="workspace-label">Workspace</span>
          <span className="workspace-name">Mudita workspace</span>
        </span>
        <ChevronDown aria-hidden="true" size={15} />
      </button>

      <p className="nav-caption">WORKSPACE</p>
      <nav className="primary-nav">
        {navigation.map(({ label, href, icon: Icon, active }) => (
          <a
            className={`nav-link${active ? " active" : ""}`}
            href={href}
            key={label}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{label}</span>
          </a>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <div className="sidebar-plan">
        <div className="plan-icon"><MessageSquareText aria-hidden="true" size={17} /></div>
        <p>One place for every conversation.</p>
        <span>Integrations coming soon</span>
      </div>
      <nav className="secondary-nav" aria-label="Support and settings">
        <a className="nav-link" href="#help">
          <CircleHelp aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>Help center</span>
        </a>
        <a className="nav-link" href="#settings">
          <Settings2 aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>Settings</span>
        </a>
      </nav>
      <div className="profile-row">
        <span className="profile-avatar">M</span>
        <span className="profile-copy">
          <span className="profile-name">Signed out</span>
          <span className="profile-role">Authentication not configured</span>
        </span>
        <ChevronDown aria-hidden="true" size={15} />
      </div>
    </aside>
  );
}
