import { useEffect, type RefObject } from "react";

export function useCloseOnFieldDisabled(
  triggerRef: RefObject<HTMLButtonElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const closeIfDisabled = () => {
      if (trigger.matches(":disabled")) setOpen(false);
    };
    closeIfDisabled();
    // Portal 不继承禁用状态；以原字段为准，保留首个 legend 的原生例外。
    const observer = new MutationObserver(closeIfDisabled);
    for (let element: HTMLElement | null = trigger; element; element = element.parentElement) {
      if (element === trigger || element.tagName === "FIELDSET") {
        observer.observe(element, { attributes: true, attributeFilter: ["disabled"] });
      }
    }
    return () => observer.disconnect();
  }, [open, setOpen, triggerRef]);
}
