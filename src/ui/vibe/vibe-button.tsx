import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  Ref,
  ReactNode,
} from "react";
import Link from "next/link";

type VibeButtonVariant = "primary" | "outline" | "text";
type VibeButtonSize = "regular" | "compact";
type VibeButtonShape = "default" | "square";
type VibeButtonTone = "default" | "danger";

interface VibeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  variant?: VibeButtonVariant;
  size?: VibeButtonSize;
  shape?: VibeButtonShape;
  tone?: VibeButtonTone;
}

interface VibeLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  variant?: VibeButtonVariant;
  size?: VibeButtonSize;
  shape?: VibeButtonShape;
  tone?: VibeButtonTone;
}

function actionClasses(
  variant: VibeButtonVariant,
  size: VibeButtonSize,
  shape: VibeButtonShape,
  tone: VibeButtonTone,
  className?: string,
) {
  return [
    "vibe-button",
    `vibe-button--${variant}`,
    `vibe-button--${size}`,
    shape === "square" ? "vibe-button--square" : null,
    tone === "danger" ? "vibe-button--danger" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function VibeButton({
  children,
  className,
  ref,
  variant = "outline",
  size = "regular",
  shape = "default",
  tone = "default",
  ...props
}: VibeButtonProps) {
  return (
    <button
      ref={ref}
      className={actionClasses(variant, size, shape, tone, className)}
      data-vibe-component="button"
      data-vibe-variant={variant}
      data-vibe-size={size}
      data-vibe-shape={shape}
      data-vibe-tone={tone}
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
  size = "regular",
  shape = "default",
  tone = "default",
  ...props
}: VibeLinkProps) {
  const classNames = actionClasses(variant, size, shape, tone, className);
  if (typeof props.href === "string" && props.href.startsWith("/")) {
    return (
      <Link
        className={classNames}
        data-vibe-component="link"
        data-vibe-variant={variant}
        data-vibe-size={size}
        data-vibe-shape={shape}
        data-vibe-tone={tone}
        {...props}
        href={props.href}
      >
        {children}
      </Link>
    );
  }
  return (
    <a
      className={classNames}
      data-vibe-component="link"
      data-vibe-variant={variant}
      data-vibe-size={size}
      data-vibe-shape={shape}
      data-vibe-tone={tone}
      {...props}
    >
      {children}
    </a>
  );
}
