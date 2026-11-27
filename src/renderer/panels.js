(() => {
  const drawer = document.querySelector("#drawer");
  const closeButton = document.querySelector("#closeDrawerButton");
  const composeButton = document.querySelector("#composeNav");
  const buttons = [...document.querySelectorAll("[data-panel].nav-item")];
  const titles = { phrases: "최근 대화", sounds: "사운드보드", settings: "설정" };
  let active = "";
  let opener;

  function close(restoreFocus = true) {
    active = "";
    drawer.classList.remove("is-open");
    drawer.inert = true;
    buttons.forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-expanded", "false");
    });
    composeButton.classList.add("active");
    composeButton.setAttribute("aria-current", "page");
    if (restoreFocus) opener?.focus({ preventScroll: true });
  }

  buttons.forEach((button) => button.addEventListener("click", () => {
    const panel = button.dataset.panel;
    if (active === panel) { close(); return; }
    active = panel;
    opener = button;
    document.querySelectorAll(".drawer-panel").forEach((element) => {
      element.hidden = element.id !== `${panel}-panel`;
    });
    buttons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-expanded", String(selected));
    });
    composeButton.classList.remove("active");
    composeButton.removeAttribute("aria-current");
    drawer.dataset.panel = panel;
    document.querySelector("#drawerTitle").textContent = titles[panel];
    closeButton.setAttribute("aria-label", `${titles[panel]} 닫기`);
    drawer.inert = false;
    drawer.classList.add("is-open");
    // Keep keyboard navigation inside the newly opened region without trapping the composer.
    closeButton.focus({ preventScroll: true });
  }));
  closeButton.addEventListener("click", () => close());
  composeButton.addEventListener("click", () => {
    close(false);
    document.querySelector("#ttsText").focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing || !active) return;
    if (document.querySelector(".modal-backdrop:not([hidden])")) return;
    event.preventDefault();
    close();
  });
})();
