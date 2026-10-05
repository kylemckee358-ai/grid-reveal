const { buildGrid } = require("./src/gridBuilder");

const rowsInput = document.getElementById("rows");
const colsInput = document.getElementById("cols");
const frameDelayInput = document.getElementById("frame-delay");
const revealOrderInput = document.getElementById("reveal-order");
const reverseOrderInput = document.getElementById("reverse-order");
const buildButton = document.getElementById("build-button");
const statusEl = document.getElementById("status");

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.classList.remove("error", "success");
  if (kind) {
    statusEl.classList.add(kind);
  }
}

function updateButtonLabel() {
  const rows = parseInt(rowsInput.value, 10) || 3;
  const cols = parseInt(colsInput.value, 10) || 3;
  buildButton.textContent = `${rows}×${cols} Grid`;
}

rowsInput.addEventListener("input", updateButtonLabel);
colsInput.addEventListener("input", updateButtonLabel);
updateButtonLabel();

buildButton.addEventListener("click", async () => {
  const rows = parseInt(rowsInput.value, 10);
  const cols = parseInt(colsInput.value, 10);
  const frameDelay = parseInt(frameDelayInput.value, 10);

  if (!rows || rows < 2 || !cols || cols < 2) {
    setStatus("Rows and columns must both be 2 or more.", "error");
    return;
  }
  if (Number.isNaN(frameDelay) || frameDelay < 0) {
    setStatus("Frame delay must be 0 or more.", "error");
    return;
  }

  buildButton.disabled = true;
  setStatus("Working...");

  const revealOrder = revealOrderInput.value;
  const reverseOrder = reverseOrderInput.checked;

  try {
    const resultMessage = await buildGrid(
      { rows, cols, frameDelay, revealOrder, reverseOrder },
      (progress) => {
        setStatus(progress);
      }
    );
    setStatus(resultMessage, "success");
  } catch (err) {
    setStatus(err && err.message ? err.message : String(err), "error");
  } finally {
    buildButton.disabled = false;
  }
});
