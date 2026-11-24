// js/hero-motion.js
// Deterministic Canvas Motion Graphic for CEIT Landing Portal
// Crafted using motion-showreel principles (minimal-ui + blueprint):
//   - Closed-form damped spring physics (no stateful drift)
//   - Blueprint drafting geometry + minimal floating UI morph + interactive cursor tap
//   - Pure Vanilla Canvas, HiDPI crisp, respects prefers-reduced-motion

const LOOP_DURATION = 9.0; // seconds per seamless loop

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function easeOutCubic(u) {
  const c = clamp(u);
  return 1 - Math.pow(1 - c, 3);
}

/**
 * Closed-form underdamped / critically damped spring (0 -> 1).
 * Matches motion-showreel minimal-ui spring specs:
 *   pills/indicators: omega = 14, zeta = 0.8
 *   containers/cards: omega = 10, zeta = 0.78
 */
function spring(elapsed, omega = 11, zeta = 0.78) {
  if (elapsed <= 0) return 0;
  if (elapsed > 2.2) return 1;
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * omega * elapsed);
    return 1 - env * (Math.cos(wd * elapsed) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * elapsed));
  }
  const env = Math.exp(-omega * elapsed);
  return 1 - env * (1 + omega * elapsed);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawBlueprintBoard(ctx, cx, cy, scale, reveal) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  const w = 186;
  const h = 122;
  const x = -w / 2;
  const y = -h / 2;

  // Blueprint drafting extension / dimension lines
  ctx.strokeStyle = "rgba(35, 75, 122, 0.28)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  const dimGrow = easeOutCubic(reveal);
  ctx.beginPath();
  ctx.moveTo(x, y - 16);
  ctx.lineTo(x + w * dimGrow, y - 16);
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x, y - 4);
  ctx.moveTo(x + w * dimGrow, y - 22);
  ctx.lineTo(x + w * dimGrow, y - 4);
  ctx.stroke();
  ctx.setLineDash([]);

  // Dimension label
  if (reveal > 0.35) {
    ctx.fillStyle = "rgba(35, 75, 122, 0.72)";
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText("BOARD · REV R3", 0, y - 22);
  }

  // Main PCB silhouette (blueprint light drafting tint)
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = "#eef4fc";
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = "#1b4680";
  ctx.stroke();

  // USB port block on left
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1b4680";
  ctx.lineWidth = 1.5;
  ctx.fillRect(x - 8, y + 18, 26, 28);
  ctx.strokeRect(x - 8, y + 18, 26, 28);

  // Barrel jack lower left
  ctx.fillRect(x - 6, y + 76, 24, 24);
  ctx.strokeRect(x - 6, y + 76, 24, 24);

  // MCU IC chip in center with pins
  const icX = x + 68;
  const icY = y + 48;
  const icW = 72;
  const icH = 26;
  ctx.fillStyle = "#1b4680";
  roundRect(ctx, icX, icY, icW, icH, 3);
  ctx.fill();

  // IC Pins
  ctx.strokeStyle = "#1b4680";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 8; i++) {
    const px = icX + 7 + i * 8.2;
    ctx.beginPath();
    ctx.moveTo(px, icY - 5);
    ctx.lineTo(px, icY);
    ctx.moveTo(px, icY + icH);
    ctx.lineTo(px, icY + icH + 5);
    ctx.stroke();
  }

  // Header pin strips (top & bottom)
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#234b7a";
  ctx.lineWidth = 1.2;
  ctx.fillRect(x + 42, y + 8, 118, 12);
  ctx.strokeRect(x + 42, y + 8, 118, 12);
  ctx.fillRect(x + 58, y + h - 20, 102, 12);
  ctx.strokeRect(x + 58, y + h - 20, 102, 12);

  // Blueprint mounting holes
  for (const [hx, hy] of [[x + 14, y + 12], [x + w - 12, y + 12], [x + w - 12, y + h - 12]]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#1b4680";
    ctx.stroke();
  }

  // Chip label
  ctx.fillStyle = "#ffffff";
  ctx.font = '600 9px "IBM Plex Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText("ATMEGA328P", icX + icW / 2, icY + 16);

  ctx.restore();
}

function drawQrTag(ctx, x, y, size, scanProgress) {
  ctx.save();
  // Floating white QR card
  ctx.shadowColor = "rgba(18, 20, 26, 0.10)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, size, size + 24, 10);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "#d9dfe8";
  ctx.stroke();

  // Mini schematic QR pattern (clean 7x7 finder-accurate graphic)
  const pad = 12;
  const inner = size - pad * 2;
  const cells = 9;
  const cell = inner / cells;
  const pattern = [
    "111010111",
    "101001101",
    "111010111",
    "000101000",
    "101110101",
    "010011010",
    "111010101",
    "101001010",
    "111011101"
  ];
  ctx.fillStyle = "#12141a";
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (pattern[r][c] === "1") {
        ctx.fillRect(x + pad + c * cell, y + pad + r * cell, cell - 0.6, cell - 0.6);
      }
    }
  }

  // Code caption
  ctx.fillStyle = "#2558f5";
  ctx.font = '600 10px "IBM Plex Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText("MCU-ARDUN-01", x + size / 2, y + size + 13);

  // Active scan beam when scanning
  if (scanProgress > 0 && scanProgress < 1) {
    const beamY = y + pad + inner * scanProgress;
    ctx.strokeStyle = "#0f8a5f";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x + 8, beamY);
    ctx.lineTo(x + size - 8, beamY);
    ctx.stroke();

    // Subtle green highlight band
    const grad = ctx.createLinearGradient(0, beamY - 14, 0, beamY + 2);
    grad.addColorStop(0, "rgba(15, 138, 95, 0)");
    grad.addColorStop(1, "rgba(15, 138, 95, 0.18)");
    ctx.fillStyle = grad;
    ctx.fillRect(x + 8, beamY - 14, size - 16, 16);
  }

  ctx.restore();
}

function drawCursor(ctx, x, y, pressScale, ripple) {
  ctx.save();
  ctx.translate(x, y);

  if (ripple > 0 && ripple < 1) {
    ctx.beginPath();
    ctx.arc(0, 0, 6 + ripple * 22, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(37, 88, 245, ${(1 - ripple) * 0.55})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.scale(pressScale, pressScale);
  ctx.shadowColor = "rgba(18, 20, 26, 0.22)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 18);
  ctx.lineTo(4.8, 14.2);
  ctx.lineTo(8.5, 21.5);
  ctx.lineTo(11.3, 20.1);
  ctx.lineTo(7.6, 12.8);
  ctx.lineTo(13.2, 12.8);
  ctx.closePath();
  ctx.fillStyle = "#12141a";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();
}

/**
 * Deterministic render(t) — draws the exact frame at time t (seconds).
 */
export function renderHeroFrame(ctx, w, h, t) {
  const time = ((t % LOOP_DURATION) + LOOP_DURATION) % LOOP_DURATION;
  ctx.clearRect(0, 0, w, h);

  // Quiet alabaster drafting stage
  ctx.fillStyle = "#fbfbfa";
  ctx.fillRect(0, 0, w, h);

  // Subtle blueprint registration ticks in corners
  ctx.strokeStyle = "rgba(35, 75, 122, 0.14)";
  ctx.lineWidth = 1;
  const step = 28;
  for (let gx = step; gx < w; gx += step) {
    for (let gy = step; gy < h; gy += step) {
      ctx.beginPath();
      ctx.moveTo(gx - 2, gy);
      ctx.lineTo(gx + 2, gy);
      ctx.moveTo(gx, gy - 2);
      ctx.lineTo(gx, gy + 2);
      ctx.stroke();
    }
  }

  // Timeline phases:
  // 0.0 -> 2.4s : Blueprint PCB + QR tag assemble with spring
  // 2.2 -> 4.0s : Scan beam sweeps QR code
  // 3.6 -> 6.8s : Floating Checkout Card springs in, cursor clicks "Confirm Sign Out" at t=5.1s
  // 5.1 -> 8.2s : Button morphs cleanly to Confirmed Emerald badge ("Signed Out · Due in 7d")
  // 8.2 -> 9.0s : Soft fade/reset to seamless loop

  const fadeOut = time > 8.25 ? 1 - easeOutCubic((time - 8.25) / 0.65) : 1;
  const fadeIn = time < 0.35 ? easeOutCubic(time / 0.35) : 1;
  const masterAlpha = fadeIn * fadeOut;

  ctx.save();
  ctx.globalAlpha = masterAlpha;

  const boardReveal = spring(time - 0.1, 9, 0.82);
  const qrSpring = spring(time - 0.55, 11, 0.78);
  const cardSpring = spring(time - 3.6, 10.5, 0.78);
  const scanP = clamp((time - 2.0) / 1.45, 0, 1);

  const leftShift = cardSpring * (w * 0.11);
  const boardX = w * 0.36 - leftShift;
  const boardY = h * 0.52;
  const boardScale = Math.min(w / 560, h / 315) * (0.94 + 0.06 * boardReveal);

  drawBlueprintBoard(ctx, boardX, boardY, boardScale, boardReveal);

  // Leader line connecting PCB to QR Tag
  const qrSize = Math.round(92 * Math.min(w / 560, 1.05));
  const qrX = w * 0.57 - leftShift * 0.85;
  const qrY = h * 0.52 - (qrSize + 24) / 2 + (1 - qrSpring) * 18;

  ctx.strokeStyle = "rgba(35, 75, 122, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(boardX + 94 * boardScale, boardY);
  ctx.lineTo(qrX - 6, boardY);
  ctx.stroke();
  ctx.setLineDash([]);

  drawQrTag(ctx, qrX, qrY, qrSize, time >= 2.0 && time <= 3.55 ? scanP : 0);

  // Floating Minimal Checkout Card (enters from right with spring)
  if (cardSpring > 0.01) {
    const cardW = Math.min(215, w * 0.39);
    const cardH = 166;
    const cardX = w - cardW - 22 + (1 - cardSpring) * 34;
    const cardY = (h - cardH) / 2;

    ctx.save();
    ctx.globalAlpha = masterAlpha * clamp(cardSpring * 1.2);
    ctx.shadowColor = "rgba(18, 20, 26, 0.12)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    roundRect(ctx, cardX, cardY, cardW, cardH, 14);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e4e3dd";
    ctx.stroke();

    // Card header badge
    roundRect(ctx, cardX + 14, cardY + 14, 72, 20, 10);
    ctx.fillStyle = "#ecfdf5";
    ctx.fill();
    ctx.fillStyle = "#0f8a5f";
    ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText("• IN STOCK", cardX + 22, cardY + 27);

    // Component title & code
    ctx.fillStyle = "#12141a";
    ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText("Arduino Uno R3", cardX + 14, cardY + 55);

    ctx.fillStyle = "#767d8a";
    ctx.font = '500 10.5px "IBM Plex Mono", monospace';
    ctx.fillText("MCU-ARDUN-01 · Bin B-3", cardX + 14, cardY + 73);

    // Duration pills
    const pills = ["1d", "3d", "7d", "14d"];
    pills.forEach((label, idx) => {
      const px = cardX + 14 + idx * 45;
      const py = cardY + 86;
      const isSelected = idx === 2;
      roundRect(ctx, px, py, 39, 22, 11);
      ctx.fillStyle = isSelected ? "#2558f5" : "#f4f5f7";
      ctx.fill();
      ctx.fillStyle = isSelected ? "#ffffff" : "#4c5360";
      ctx.font = '600 10.5px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(label, px + 19.5, py + 14.5);
    });

    // Morphing CTA button -> Confirmed Emerald State
    const clickedAt = 5.25;
    const confirmedP = spring(time - clickedAt, 14, 0.82);
    const btnX = cardX + 14;
    const btnY = cardY + 120;
    const btnW = cardW - 28;
    const btnH = 32;

    const btnScale = time > clickedAt - 0.1 && time < clickedAt + 0.14 ? 0.96 : 1;
    ctx.save();
    ctx.translate(btnX + btnW / 2, btnY + btnH / 2);
    ctx.scale(btnScale, btnScale);
    roundRect(ctx, -btnW / 2, -btnH / 2, btnW, btnH, 8);
    ctx.fillStyle = confirmedP > 0.35 ? "#0f8a5f" : "#2558f5";
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = '700 11.5px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(
      confirmedP > 0.35 ? "✓ Signed Out · Due in 7d" : "Confirm Sign Out",
      0,
      4
    );
    ctx.restore();

    // Animated Cursor gliding to click button
    if (time >= 4.2 && time <= 6.8) {
      const glide = easeOutCubic((time - 4.2) / 0.85);
      const startX = cardX + cardW - 10;
      const startY = cardY + cardH + 22;
      const targetX = btnX + btnW * 0.62;
      const targetY = btnY + btnH * 0.55;
      const cxPos = startX + (targetX - startX) * glide;
      const cyPos = startY + (targetY - startY) * glide;
      const isPress = time >= clickedAt - 0.08 && time <= clickedAt + 0.14;
      const rippleP = clamp((time - clickedAt) / 0.45, 0, 1);
      drawCursor(ctx, cxPos, cyPos, isPress ? 0.86 : 1, time >= clickedAt ? rippleP : 0);
    }

    ctx.restore();
  }

  // Bottom-left blueprint title block
  ctx.fillStyle = "rgba(18, 20, 26, 0.48)";
  ctx.font = '500 10px "IBM Plex Mono", monospace';
  ctx.textAlign = "left";
  const stageLabel =
    time < 2.0
      ? "01 · COMPONENT IDENTIFIED"
      : time < 3.6
        ? "02 · QR BIN LABEL SCANNED"
        : time < 5.25
          ? "03 · SELECT LOAN DURATION"
          : "04 · INVENTORY SYNCED LIVE";
  ctx.fillText(stageLabel, 16, h - 14);

  ctx.restore();
}

/**
 * Initializes the live deterministic Canvas animation on a target canvas element.
 * @param {HTMLCanvasElement} canvas
 */
export function mountHeroMotion(canvas) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext("2d");
  const prefersReduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let rafId = null;
  let startMs = performance.now();

  function resizeAndDraw(t) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderHeroFrame(ctx, rect.width, rect.height, t);
  }

  if (prefersReduced) {
    // Render crisp final confirmed frame for reduced-motion users
    resizeAndDraw(6.0);
    window.addEventListener("resize", () => resizeAndDraw(6.0));
    return () => {};
  }

  const loop = (now) => {
    const elapsed = (now - startMs) / 1000;
    resizeAndDraw(elapsed);
    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
  };
}
