import type { ReactNode } from "react";

export function WorkbenchPage({
  children,
  className,
  mainClassName,
}: {
  children: ReactNode;
  className: string;
  mainClassName?: string;
}) {
  return (
    <div className={`page ${className}`}>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <main className={mainClassName} id="main-content">
        {children}
      </main>
    </div>
  );
}
