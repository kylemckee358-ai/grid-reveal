const { buildGrid } = require("./src/gridBuilder");
const { isOutlineAvailable } = require("./src/gridOutline");

const rowsInput = document.getElementById("rows");
const colsInput = document.getElementById("cols");
const frameDelayInput = document.getElementById("frame-delay");
const revealOrderInput = document.getElementById("reveal-order");
const reverseOrderInput = document.getElementById("reverse-order");
const gridOutlineInput = document.getElementById("grid-outline");
const outlineColorInput = document.getElementById("outline-color");
const outlineNoteEl = document.getElementById("outline-note");
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

function updateOutlineAvailability() {
  const rows = parseInt(rowsInput.value, 10) || 0;
  const cols = parseInt(colsInput.value, 10) || 0;
  const available = isOutlineAvailable(rows, cols);

  gridOutlineInput.disabled = !available;
  outlineColorInput.disabled = !available || !gridOutlineInput.checked;
  if (!available) {
    gridOutlineInput.checked = false;
  }
  outlineNoteEl.hidden = available;
}

rowsInput.addEventListener("input", () => {
  updateButtonLabel();
  updateOutlineAvailability();
});
colsInput.addEventListener("input", () => {
  updateButtonLabel();
  updateOutlineAvailability();
});
gridOutlineInput.addEventListener("input", updateOutlineAvailability);
updateButtonLabel();
updateOutlineAvailability();

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
  const gridOutline = gridOutlineInput.checked;
  const outlineColor = outlineColorInput.value;

  try {
    const resultMessage = await buildGrid(
      { rows, cols, frameDelay, revealOrder, reverseOrder, gridOutline, outlineColor },
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
