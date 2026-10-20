import { VibeLink } from "@/ui/vibe/vibe-button";

export function WorkspaceViewNavigation({ label, items, current }: {
  label: string;
  items: readonly { href: string; label: string }[];
  current: string;
}) {
  return <nav aria-label={label} className="workspace-view-navigation">
    {items.map(item => <VibeLink key={item.href} href={item.href}
      aria-current={item.href === current ? "page" : undefined}
      variant={item.href === current ? "primary" : "outline"}>{item.label}</VibeLink>)}
  </nav>;
}
