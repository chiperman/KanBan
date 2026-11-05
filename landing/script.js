const copyButtons = document.querySelectorAll("[data-copy-target]");
const copyStatus = document.querySelector("#copy-status");

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
