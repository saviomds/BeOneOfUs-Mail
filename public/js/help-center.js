const widget = document.querySelector("[data-help-center]");
const toggle = widget.querySelector("[data-help-toggle]");
const panel = widget.querySelector("[data-help-panel]");
const close = widget.querySelector("[data-help-close]");

function setOpen(open) {
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  if (open) close.focus();
  else toggle.focus();
}

toggle.addEventListener("click", () => {
  setOpen(panel.hidden);
});

close.addEventListener("click", () => setOpen(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !panel.hidden) setOpen(false);
});

document.addEventListener("click", (event) => {
  if (!panel.hidden && !widget.contains(event.target)) setOpen(false);
});
