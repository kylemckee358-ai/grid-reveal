/**
 * Computes reveal order for the grid, independent of the grid-building
 * logic in gridBuilder.js.
 *
 * A grid's cells are always addressed row-major, 0-indexed: cell index
 * i = row * cols + col (so for a 3x3 grid, cell 0 is top-left, cell 8 is
 * bottom-right). That addressing is fixed - it's what determines each
 * cell's crop position - but the ORDER cells reveal in is independent of
 * it, and can group multiple cells into the same reveal step.
 *
 * computeRevealGroups returns an ordered array of groups, each group an
 * array of cell indices that reveal together at the same step:
 *
 *   - "sequential": 1 cell per group, in row-major order (1,2,3,4,...).
 *   - "spiral": 1 cell per group, clockwise from top-left into the center.
 *   - "horizontal": 1 column per group, left to right (col 0's 3 cells
 *     together, then col 1's, then col 2's).
 *   - "vertical": 1 row per group, top to bottom.
 *
 * `reverse` flips the step order (last group first), not the cells within
 * a group.
 */

function computeRevealGroups(rows, cols, order, reverse) {
  let groups;
  switch (order) {
    case "spiral":
      groups = spiralCellOrder(rows, cols).map((cell) => [cell]);
      break;
    case "horizontal":
      groups = [];
      for (let col = 0; col < cols; col += 1) {
        const group = [];
        for (let row = 0; row < rows; row += 1) {
          group.push(row * cols + col);
        }
        groups.push(group);
      }
      break;
    case "vertical":
      groups = [];
      for (let row = 0; row < rows; row += 1) {
        const group = [];
        for (let col = 0; col < cols; col += 1) {
          group.push(row * cols + col);
        }
        groups.push(group);
      }
      break;
    case "sequential":
    default:
      groups = [];
      for (let i = 0; i < rows * cols; i += 1) {
        groups.push([i]);
      }
      break;
  }
  return reverse ? groups.slice().reverse() : groups;
}

/**
 * Clockwise spiral traversal of a rows x cols grid, starting top-left,
 * ending at the center. Returns a flat array of cell indices in order.
 */
function spiralCellOrder(rows, cols) {
  const result = [];
  let top = 0;
  let bottom = rows - 1;
  let left = 0;
  let right = cols - 1;

  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c += 1) result.push(top * cols + c);
    top += 1;

    for (let r = top; r <= bottom; r += 1) result.push(r * cols + right);
    right -= 1;

    if (top <= bottom) {
      for (let c = right; c >= left; c -= 1) result.push(bottom * cols + c);
      bottom -= 1;
    }

    if (left <= right) {
      for (let r = bottom; r >= top; r -= 1) result.push(r * cols + left);
      left += 1;
    }
  }

  return result;
}

/**
 * Flattens groups into a per-cell lookup: result[cellIndex] = which group
 * (0-indexed step number) that cell belongs to.
 */
function groupIndexByCell(groups) {
  const byCell = [];
  groups.forEach((group, groupIndex) => {
    for (const cell of group) {
      byCell[cell] = groupIndex;
    }
  });
  return byCell;
}

module.exports = { computeRevealGroups, groupIndexByCell };
