import { initProductDemo } from "./demo.js";
import { initObservatory } from "./observatory.js";

initProductDemo();
initPresentation();
initObservatory();

const copyStatus = document.querySelector("#copy-status");
const resetTimers = new WeakMap();
document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    const value = target.innerText
      .split("\n")
      .map((line) => line.replace(/^\$\s?/, ""))
      .join("\n");
    const label = button.querySelector("span");
    window.clearTimeout(resetTimers.get(button));
    try {
      await navigator.clipboard.writeText(value);
      label.textContent = "已复制";
      copyStatus.textContent = "启动命令已复制，可粘贴到终端。";
      resetTimers.set(
        button,
        window.setTimeout(() => {
          label.textContent = "复制命令";
        }, 2000),
      );
    } catch {
      label.textContent = "复制命令";
      copyStatus.textContent = "复制未完成，请在命令框中手动选择并复制。";
      target.focus();
    }
  });
  button.disabled = false;
});

function initPresentation() {
  const booksSection = document.querySelector(".books-feature");
  const covers = [...document.querySelectorAll(".book-cover")];
  const wordmark = document.querySelector(".footer-wordmark");
  const light = wordmark?.querySelector(".wordmark-light");
  const storage = document.querySelector(".storage-details");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  let coverFrame = null;
  let lightFrame = null;
  let pointer = null;
  let pointerInput = false;
  let storageAnimation = null;
  const allowMotion = () => !reduce.matches && fine.matches;
  const scheduleCovers = () => {
    if (!booksSection || coverFrame !== null) return;
    coverFrame = requestAnimationFrame(() => {
      coverFrame = null;
      // Only the non-interactive book artwork moves; the product stays still.
      if (!allowMotion() || innerWidth < 1024) {
        covers.forEach((cover) => cover.style.removeProperty("transform"));
        return;
      }
      const distance = Math.max(
        0,
        Math.min(1, (booksSection.getBoundingClientRect().top + 180) / 600),
      );
      covers.forEach((cover, index) => {
        cover.style.transform = `rotate(${(index - 1) * distance * 4}deg)`;
      });
    });
  };
  addEventListener("scroll", scheduleCovers, { passive: true });
  addEventListener("resize", scheduleCovers);
  const updatePreferences = () => {
    if (wordmark) wordmark.dataset.reactive = String(allowMotion());
    pointer = null;
    light?.style.removeProperty("mask-image");
    storageAnimation?.cancel();
    scheduleCovers();
  };
  reduce.addEventListener("change", updatePreferences);
  fine.addEventListener("change", updatePreferences);
  updatePreferences();
  document.fonts.ready.then(scheduleCovers);

  const paintLight = () => {
    lightFrame = null;
    if (!light) return;
    if (!pointer || !allowMotion()) {
      light.style.removeProperty("mask-image");
      return;
    }
    const bounds = wordmark.getBoundingClientRect();
    light.style.maskImage = `radial-gradient(circle 240px at ${pointer.x - bounds.left}px ${pointer.y - bounds.top}px, var(--ink) 20%, transparent 100%)`;
  };
  wordmark?.addEventListener("pointermove", (event) => {
    if (!allowMotion()) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (lightFrame === null) lightFrame = requestAnimationFrame(paintLight);
  });
  wordmark?.addEventListener("pointerleave", () => {
    pointer = null;
    if (lightFrame === null) lightFrame = requestAnimationFrame(paintLight);
  });

  document.addEventListener(
    "pointerdown",
    () => {
      pointerInput = true;
    },
    { passive: true },
  );
  document.addEventListener("keydown", () => {
    pointerInput = false;
  });
  storage?.addEventListener("toggle", () => {
    storageAnimation?.cancel();
    if (!storage.open || reduce.matches || !pointerInput) return;
    storageAnimation = storage.querySelector("dl").animate(
      [
        { opacity: 0.7, transform: "translateY(-4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 250, easing: "ease-out" },
    );
  });
}
