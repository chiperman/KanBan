import type {
  FormEventHandler,
  HTMLAttributes,
  ReactNode,
} from "react";

interface VibeDialogProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit" | "title"> {
  actions: ReactNode;
  children?: ReactNode;
  description: ReactNode;
  eyebrow: string;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  title: string;
  titleId: string;
}

export function VibeDialog({
  actions,
  children,
  className,
  description,
  eyebrow,
  onSubmit,
  title,
  titleId,
  ...overlayProps
}: VibeDialogProps) {
  const panelContent = (
    <>
      <header className="vibe-dialog__header">
        <p className="vibe-dialog__eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
      </header>
      <div className="vibe-dialog__body">
        <p className="vibe-dialog__copy">{description}</p>
        {children}
      </div>
      <footer className="vibe-dialog__footer">{actions}</footer>
    </>
  );
  const panelClassName = ["vibe-dialog", className].filter(Boolean).join(" ");
  const hasExplicitLabel = typeof overlayProps["aria-label"] === "string";

  return (
    <div
      aria-labelledby={hasExplicitLabel ? undefined : titleId}
      aria-modal="true"
      className="vibe-dialog-overlay"
      data-vibe-component="modal"
      role="dialog"
      {...overlayProps}
    >
      {onSubmit ? (
        <form className={panelClassName} onSubmit={onSubmit}>
          {panelContent}
        </form>
      ) : (
        <section className={panelClassName}>{panelContent}</section>
      )}
    </div>
  );
}
