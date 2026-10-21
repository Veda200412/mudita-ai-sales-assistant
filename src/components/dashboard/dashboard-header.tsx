export function DashboardHeader({
  userLabel,
  onSignOut,
}: {
  userLabel: string;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span>Workspace</span>
        <span className="breadcrumb-divider">/</span>
        <span className="breadcrumb-current">Overview</span>
      </div>
      <div className="topbar-actions">
        <span className="topbar-divider" />
        <span className="topbar-avatar" aria-label={userLabel}>
          {userLabel.slice(0, 1).toUpperCase()}
        </span>
        <span className="signed-in-label">{userLabel}</span>
        <button className="quiet-button" type="button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
