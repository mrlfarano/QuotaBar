// Port of the status-bar glyph in Visualization.swift: one square glyph with
// concentric dual rings — outer = 5-hour quota, inner = weekly — both
// band-colored and filling clockwise from 12 o'clock, with a muted full
// track and round line caps. Geometry is parametrized off the Swift
// constants (canvas 20, outer r 8.25 / lw 3.5, inner r 4.25 / lw 2) so both
// platforms draw the same glyph at the tray size Windows expects (16×16).
//
// Rendering is a 4×4-supersampled software rasterizer (no canvas dep); the
// PNG encoder is pure Node (zlib).

import { encodePNG } from './png.js';
import { BandColor } from './core/format.js';

const CANVAS = 20;           // Swift reference canvas
const OUTER_RADIUS = 8.25;   // strokeArc(center:, radius: 8.25, lineWidth: 3.5)
const OUTER_WIDTH = 3.5;
const INNER_RADIUS = 4.25;   // strokeArc(center:, radius: 4.25, lineWidth: 2)
const INNER_WIDTH = 2;
const SAMPLES = 4;           // supersampling grid per axis

const TRACK = [127, 127, 127, 0.45]; // stand-in for tertiaryLabelColor

function hexToRGBA(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    1,
  ];
}

/// Port of dualRingImage(fiveRemaining:fiveBand:weekRemaining:weekBand:).
/// Returns a PNG Buffer at the requested pixel size (16 → 1× tray, 32 → 2×).
export function dualRingPNG({ size = 16, fiveRemaining, fiveBand, weekRemaining, weekBand }) {
  const scale = size / CANVAS;
  const center = size / 2;

  // Weekly-only fallback: weekly takes the outer ring, no inner ring.
  const rings = [];
  const outerRemaining = fiveRemaining ?? weekRemaining;
  const outerColor = fiveBand ?? weekBand;
  if (outerRemaining != null && outerColor != null) {
    rings.push({ radius: OUTER_RADIUS * scale, width: OUTER_WIDTH * scale, fraction: outerRemaining / 100, color: hexToRGBA(BandColor[outerColor]) });
  }
  if (fiveRemaining != null && weekRemaining != null && weekBand != null) {
    rings.push({ radius: INNER_RADIUS * scale, width: INNER_WIDTH * scale, fraction: weekRemaining / 100, color: hexToRGBA(BandColor[weekBand]) });
  }

  return encodePNG(size, size, rasterize(size, center, rings));
}

/// Single-ring variant for per-row menu icons: the gauge's own proportion in
/// its band color.
export function gaugeRingPNG({ pct, band, size = 16 }) {
  const scale = size / CANVAS;
  return encodePNG(size, size, rasterize(size, size / 2, [
    { radius: OUTER_RADIUS * scale, width: OUTER_WIDTH * scale, fraction: pct / 100, color: hexToRGBA(BandColor[band]) },
  ]));
}

function rasterize(size, center, rings) {
  const rgba = new Uint8Array(size * size * 4);
  const step = 1 / SAMPLES;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          const color = samplePixel(x, y, center, rings);
          // Straight-alpha compositing of track + arc over transparent.
          r += color[0] * color[3];
          g += color[1] * color[3];
          b += color[2] * color[3];
          a += color[3];
        }
      }
      const samples = SAMPLES * SAMPLES;
      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round(r / samples);
      rgba[offset + 1] = Math.round(g / samples);
      rgba[offset + 2] = Math.round(b / samples);
      rgba[offset + 3] = Math.round((a / samples) * 255);
    }
  }
  return rgba;
}

/// Top-most color at one supersample: track ring first, band arc on top.
function samplePixel(x, y, center, rings) {
  for (const ring of rings) {
    const dx = x - center;
    const dy = y - center;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const half = ring.width / 2;
    const onTrack = Math.abs(dist - ring.radius) <= half;
    // Round caps: circles of radius width/2 at both arc endpoints.
    const inArc = (inStroke(dist, ring.radius, half) && withinArc(x, y, center, ring)) || capHit(x, y, center, ring);
    if (inArc) return ring.color;
    if (onTrack) return TRACK;
  }
  return [0, 0, 0, 0];
}

function inStroke(dist, radius, half) {
  return Math.abs(dist - radius) <= half;
}

// Angle from 12 o'clock, clockwise (screen y grows downward):
// atan2(dx, -dy) maps 12 o'clock → 0, 3 o'clock → π/2.
function withinArc(x, y, center, ring) {
  const fraction = Math.min(Math.max(ring.fraction, 0), 1);
  if (fraction <= 0.01) return false; // Swift: only draw above the threshold
  const angle = Math.atan2(x - center, -(y - center));
  const theta = angle < 0 ? angle + 2 * Math.PI : angle;
  return theta <= fraction * 2 * Math.PI;
}

function capHit(x, y, center, ring) {
  const fraction = Math.min(Math.max(ring.fraction, 0), 1);
  if (fraction <= 0.01 || fraction >= 0.99) return false;
  const half = ring.width / 2;
  for (const angle of [0, fraction * 2 * Math.PI]) {
    const capX = center + ring.radius * Math.sin(angle);
    const capY = center - ring.radius * Math.cos(angle);
    const dx = x - capX;
    const dy = y - capY;
    if (dx * dx + dy * dy <= half * half) return true;
  }
  return false;
}
