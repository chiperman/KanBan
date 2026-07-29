import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  Ref,
  ReactNode,
} from "react";

type VibeButtonVariant = "primary" | "outline" | "text";

interface VibeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  variant?: VibeButtonVariant;
}

interface VibeLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  variant?: VibeButtonVariant;
}

function actionClasses(variant: VibeButtonVariant, className?: string) {
  return ["vibe-button", `vibe-button--${variant}`, className]
    .filter(Boolean)
    .join(" ");
}

export function VibeButton({
  children,
  className,
  ref,
  variant = "outline",
  ...props
}: VibeButtonProps) {
  return (
    <button
      ref={ref}
      className={actionClasses(variant, className)}
      data-vibe-component="button"
      data-vibe-variant={variant}
      {...props}
    >
      {children}
    </button>
  );
}

export function VibeLink({
  children,
  className,
  variant = "outline",
  ...props
}: VibeLinkProps) {
  return (
    <a
      className={actionClasses(variant, className)}
      data-vibe-component="link"
      data-vibe-variant={variant}
      {...props}
    >
      {children}
    </a>
  );
}
