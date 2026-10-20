import Link from "next/link";
import type { ReactNode } from "react";
import { VibeIcon } from "@/ui/vibe/vibe-icon";

/** A visible, keyboard-accessible link from an entity name to its details. */
export function VibeEntityLink({ href, children, "aria-label": label }: {
  href: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Link href={href} className="vibe-entity-link" aria-label={label} data-vibe-component="entity-link">
      <span>{children}</span>
      <VibeIcon name="arrow-right" />
    </Link>
  );
}
