// js/lib/qrcode.js
// Self-contained Pure Vanilla JS QR Code Generator (ISO/IEC 18004, Byte Mode, EC Level M, Versions 1–10)
// Zero external dependencies — works completely offline and renders crisp Canvas / SVG / Data URLs.

// GF(256) exp/log tables with primitive polynomial 0x11d (x^8 + x^4 + x^3 + x^2 + 1)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    for (let j = 0; j < ecLen - 1; j++) {
      res[j] = res[j + 1];
    }
    res[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        res[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return res;
}

// Version specs for Error Correction Level M (Versions 1 to 10)
// blocks: array of [blockCount, dataCodewordsPerBlock], ecPerBlock: EC codewords per block
const VERSION_SPECS_M = [
  null, // 1-indexed
  { version: 1, totalData: 16, ecPerBlock: 10, blocks: [[1, 16]], align: [] },
  { version: 2, totalData: 28, ecPerBlock: 16, blocks: [[1, 28]], align: [6, 18] },
  { version: 3, totalData: 44, ecPerBlock: 26, blocks: [[1, 44]], align: [6, 22] },
  { version: 4, totalData: 64, ecPerBlock: 18, blocks: [[2, 32]], align: [6, 26] },
  { version: 5, totalData: 86, ecPerBlock: 24, blocks: [[2, 43]], align: [6, 30] },
  { version: 6, totalData: 108, ecPerBlock: 16, blocks: [[4, 27]], align: [6, 34] },
  { version: 7, totalData: 124, ecPerBlock: 18, blocks: [[4, 31]], align: [6, 22, 38] },
  { version: 8, totalData: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]], align: [6, 24, 42] },
  { version: 9, totalData: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]], align: [6, 26, 46] },
  { version: 10, totalData: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]], align: [6, 28, 50] }
];

function selectVersion(byteLen) {
  for (let v = 1; v < VERSION_SPECS_M.length; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const totalBitsNeeded = 4 + countBits + byteLen * 8;
    const capacityBits = VERSION_SPECS_M[v].totalData * 8;
    if (totalBitsNeeded <= capacityBits) {
      return VERSION_SPECS_M[v];
    }
  }
  throw new Error("Text is too long for QR code (max 213 UTF-8 bytes).");
}

function encodeDataCodewords(bytes, spec) {
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Mode indicator: Byte mode = 0100
  pushBits(0b0100, 4);
  // Character count indicator
  pushBits(bytes.length, spec.version <= 9 ? 8 : 16);
  // Payload bytes
  for (let i = 0; i < bytes.length; i++) {
    pushBits(bytes[i], 8);
  }

  const maxBits = spec.totalData * 8;
  // Terminator (up to 4 zero bits)
  const termLen = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < termLen; i++) bits.push(0);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Convert to bytes
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }

  // Pad with alternating 0xEC, 0x11
  const pads = [0xec, 0x11];
  let p = 0;
  while (codewords.length < spec.totalData) {
    codewords.push(pads[p++ & 1]);
  }

  // Split into RS blocks and interleave
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, len] of spec.blocks) {
    for (let b = 0; b < count; b++) {
      const slice = codewords.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(slice);
      ecBlocks.push(rsEncode(slice, spec.ecPerBlock));
    }
  }

  const interleaved = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) interleaved.push(blk[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const ec of ecBlocks) {
      interleaved.push(ec[i]);
    }
  }

  return interleaved;
}

function computeFormatBits(maskPattern) {
  // EC Level M = 00
  const data = (0b00 << 3) | (maskPattern & 0b111);
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | rem;
}

function buildMatrix(spec, codewords) {
  const size = spec.version * 4 + 17;
  // 0 = white, 1 = black
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r, c, dark) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = dark ? 1 : 0;
    isFunc[r][c] = 1;
  };

  // 1. Finder patterns + separators
  const drawFinder = (top, left) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r, c, inOuter && (onBorder || inCore));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Alignment patterns
  const centers = spec.align;
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      const cr = centers[i];
      const cc = centers[j];
      // Skip corners overlapping finders
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === centers.length - 1) ||
        (i === centers.length - 1 && j === 0)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunc(cr + dr, cc + dc, dist !== 1);
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // 4. Dark module + Reserve format info areas
  setFunc(size - 8, 8, true);
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunc(8, i, false);
      setFunc(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunc(8, size - 1 - i, false);
  }
  for (let i = 0; i < 7; i++) {
    setFunc(size - 1 - i, 8, false);
  }

  // 5. Version info (V7+)
  if (spec.version >= 7) {
    const vBits = computeVersionBits(spec.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((vBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunc(a, b, dark);
      setFunc(b, a, dark);
    }
  }

  // 6. Place data bits in zig-zag columns
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (isFunc[r][c]) continue;
        let dark = 0;
        if (bitIdx < totalBits) {
          dark = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        modules[r][c] = dark;
      }
    }
  }

  // 7. Try all 8 mask patterns and select the lowest penalty score
  const maskFn = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  const writeFormat = (grid, maskId) => {
    const fBits = computeFormatBits(maskId);
    // Bit 0 is LSB, bit 14 is MSB
    // Around top-left finder
    for (let i = 0; i <= 5; i++) grid[8][i] = (fBits >>> (14 - i)) & 1;
    grid[8][7] = (fBits >>> 8) & 1;
    grid[8][8] = (fBits >>> 7) & 1;
    grid[7][8] = (fBits >>> 6) & 1;
    for (let i = 9; i < 15; i++) grid[14 - i][8] = (fBits >>> (14 - i)) & 1;

    // Split across bottom-left and top-right finders
    for (let i = 0; i < 7; i++) grid[size - 1 - i][8] = (fBits >>> (14 - i)) & 1;
    for (let i = 7; i < 15; i++) grid[8][size - 15 + i] = (fBits >>> (14 - i)) & 1;
  };

  const evaluatePenalty = (grid) => {
    let penalty = 0;

    // Rule 1: adjacent modules in row/col of same color
    for (let r = 0; r < size; r++) {
      let runColor = grid[r][0];
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (grid[r][c] === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runColor = grid[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }
    for (let c = 0; c < size; c++) {
      let runColor = grid[0][c];
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (grid[r][c] === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runColor = grid[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }

    // Rule 2: 2x2 blocks of same color
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = grid[r][c];
        if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
          penalty += 3;
        }
      }
    }

    // Rule 3: finder-like 1:1:3:1:1 patterns
    const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c <= size - 11; c++) {
        let m1 = true;
        let m2 = true;
        for (let k = 0; k < 11; k++) {
          if (grid[r][c + k] !== p1[k]) m1 = false;
          if (grid[r][c + k] !== p2[k]) m2 = false;
        }
        if (m1 || m2) penalty += 40;
      }
    }
    for (let c = 0; c < size; c++) {
      for (let r = 0; r <= size - 11; r++) {
        let m1 = true;
        let m2 = true;
        for (let k = 0; k < 11; k++) {
          if (grid[r + k][c] !== p1[k]) m1 = false;
          if (grid[r + k][c] !== p2[k]) m2 = false;
        }
        if (m1 || m2) penalty += 40;
      }
    }

    // Rule 4: dark/light balance
    let darkCount = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        darkCount += grid[r][c];
      }
    }
    const pct = (darkCount * 100) / (size * size);
    const k = Math.floor(Math.abs(pct - 50) / 5);
    penalty += k * 10;

    return penalty;
  };

  let bestGrid = null;
  let bestPenalty = Infinity;

  for (let m = 0; m < 8; m++) {
    const candidate = modules.map((row) => new Uint8Array(row));
    const fn = maskFn[m];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunc[r][c] && fn(r, c)) {
          candidate[r][c] ^= 1;
        }
      }
    }
    writeFormat(candidate, m);
    const pen = evaluatePenalty(candidate);
    if (pen < bestPenalty) {
      bestPenalty = pen;
      bestGrid = candidate;
    }
  }

  return bestGrid;
}

/**
 * Generates a QR Code matrix (2D array of 0/1) for the given text string.
 * @param {string} text
 * @returns {Array<Uint8Array>}
 */
export function generateQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  const spec = selectVersion(bytes.length);
  const codewords = encodeDataCodewords(bytes, spec);
  return buildMatrix(spec, codewords);
}

/**
 * Draws a crisp QR code onto an HTMLCanvasElement.
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.size=200] - Target pixel width/height
 * @param {number} [options.quietZone=4] - Border modules
 */
export function renderQrToCanvas(canvas, text, { size = 200, quietZone = 4 } = {}) {
  const matrix = generateQrMatrix(text);
  const count = matrix.length;
  const totalModules = count + quietZone * 2;
  const scale = Math.max(2, Math.floor(size / totalModules));
  const actualSize = totalModules * scale;

  canvas.width = actualSize;
  canvas.height = actualSize;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.imageRendering = "pixelated";

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, actualSize, actualSize);

  ctx.fillStyle = "#000000";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (matrix[r][c]) {
        ctx.fillRect((c + quietZone) * scale, (r + quietZone) * scale, scale, scale);
      }
    }
  }
}

/**
 * Generates an inline SVG string for a QR code (ideal for crisp printing).
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.size=160]
 * @param {number} [options.quietZone=4]
 * @returns {string}
 */
export function generateQrSvg(text, { size = 160, quietZone = 4 } = {}) {
  const matrix = generateQrMatrix(text);
  const count = matrix.length;
  const total = count + quietZone * 2;
  const rects = [];

  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (matrix[r][c]) {
        rects.push(`<rect x="${c + quietZone}" y="${r + quietZone}" width="1" height="1"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><g fill="#000000">${rects.join("")}</g></svg>`;
}
