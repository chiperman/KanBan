const copyButtons = document.querySelectorAll("[data-copy-target]");
const copyStatus = document.querySelector("#copy-status");
const tickerTrack = document.querySelector(".ticker__track");

copyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;

    const value = target.innerText
      .split("\n")
      .map((line) => line.replace(/^\$\s?/, ""))
      .join("\n");

    try {
      await navigator.clipboard.writeText(value);
      button.querySelector("span").textContent = "已复制";
      copyStatus.textContent = "首次启动命令已复制。";
      window.setTimeout(() => {
        button.querySelector("span").textContent = "复制";
      }, 1800);
    } catch {
      copyStatus.textContent = "复制失败，请手动选择命令。";
    }
  });
});

if (tickerTrack) {
  const tickerSets = [...tickerTrack.querySelectorAll(".ticker__set")];
  const tickerUnit = tickerSets[0]?.querySelector(".ticker__unit");
  let resizeFrame;

  const setupTicker = () => {
    if (!tickerUnit) return;

    tickerTrack.classList.remove("is-ready");
    const unitWidth = tickerUnit.getBoundingClientRect().width;
    if (!unitWidth) return;

    const copies = Math.max(2, Math.ceil(window.innerWidth / unitWidth) + 1);

    tickerSets.forEach((set) => {
      const unit = set.querySelector(".ticker__unit");
      const units = [...set.querySelectorAll(".ticker__unit")];
      units.slice(1).forEach((copy) => copy.remove());

      for (let index = 1; index < copies; index += 1) {
        set.append(unit.cloneNode(true));
      }
    });

    tickerTrack.style.setProperty(
      "--ticker-distance",
      `${tickerSets[0].getBoundingClientRect().width}px`,
    );
    tickerTrack.classList.add("is-ready");
  };

  setupTicker();
  document.fonts?.ready.then(setupTicker);

  window.addEventListener("resize", () => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(setupTicker);
  });
}
