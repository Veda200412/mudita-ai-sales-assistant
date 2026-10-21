import type { ReactNode } from "react";

interface SectionCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  titleId?: string;
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
  titleId,
}: SectionCardProps) {
  return (
    <section className={`panel-card ${className}`}>
      <div className="panel-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
