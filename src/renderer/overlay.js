const api = window.speechOverlay;
const input = document.querySelector("#overlayText");
const status = document.querySelector("#overlayStatus");
const sendButton = document.querySelector("#sendButton");
let submitting = false;
let openingAnimation;

function restoreText(text, message) {
  input.value = input.value ? `${text}\n${input.value}` : text;
  status.textContent = message;
}

async function submit(event) {
  event.preventDefault();
  if (submitting) return;
  const text = input.value.trim();
  if (!text) { api.dismiss(); return; }
  if (text.length > 4000) { status.textContent = "4000자 이하로 나누어 전송해 주세요."; return; }
  submitting = true;
  sendButton.disabled = true;
  input.value = "";
  status.textContent = "";
  try {
    await api.submit(text);
  } catch (error) {
    restoreText(text, error.message || "전송하지 못했습니다.");
  } finally {
    submitting = false;
    sendButton.disabled = false;
  }
}

document.querySelector("#speechForm").addEventListener("submit", submit);
document.querySelector("#closeButton").addEventListener("click", () => api.dismiss());
input.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return;
  if (event.key === "Escape") { event.preventDefault(); api.dismiss(); }
  if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) submit(event);
});
api.onOpened(({ animate = true } = {}) => {
  const wasOpen = document.body.classList.contains("is-open");
  document.body.classList.add("is-open");
  if (animate && !wasOpen && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    openingAnimation?.cancel();
    openingAnimation = document.body.animate([
      { transform: "translateY(100%)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1 }
    ], { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  }
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
});
api.onHidden(() => {
  openingAnimation?.cancel();
  openingAnimation = null;
  document.body.classList.remove("is-open");
});
api.onFailed(({ text, message }) => restoreText(text, message));
window.lucide?.createIcons();
