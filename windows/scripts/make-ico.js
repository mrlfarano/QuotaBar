// Generates build/QuotaBar.ico from the shared app icon
// (../docs/icon-1024.png) with zero npm dependencies: a small PNG decoder
// (zlib inflate + unfilter), a box-filter downscaler, and a multi-size ICO
// writer (32bpp BMP entries). Electron Tray/exe icons regenerate from the
// same source as the macOS AppIcon.icns, so both platforms brand alike.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE_PNG = path.join(root, '..', 'docs', 'icon-1024.png');
const OUT_ICO = path.join(root, 'build', 'QuotaBar.ico');
const SIZES = [256, 48, 32, 16];

// MARK: PNG decoding (8-bit, non-interlaced, RGB/RGBA/gray/gray+alpha)

export function decodePNG(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR');
  if (header.depth !== 8 || header.interlace !== 0) throw new Error('unsupported PNG: need 8-bit non-interlaced');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${header.colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4); // RGBA out

  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    unfilterLine(line, previous, filter, channels);
    for (let x = 0; x < width; x++) {
      const at = x * channels;
      const out = (y * width + x) * 4;
      if (header.colorType === 0) {
        pixels[out] = pixels[out + 1] = pixels[out + 2] = line[at];
        pixels[out + 3] = 255;
      } else if (header.colorType === 4) {
        pixels[out] = pixels[out + 1] = pixels[out + 2] = line[at];
        pixels[out + 3] = line[at + 1];
      } else if (header.colorType === 2) {
        pixels[out] = line[at];
        pixels[out + 1] = line[at + 1];
        pixels[out + 2] = line[at + 2];
        pixels[out + 3] = 255;
      } else {
        line.copy(pixels, out, at, at + 4);
      }
    }
    previous = line;
  }
  return { width, height, pixels };
}

function unfilterLine(line, previous, filter, channels) {
  const bpp = channels;
  switch (filter) {
    case 0: return;
    case 1: // Sub
      for (let i = bpp; i < line.length; i++) line[i] = (line[i] + line[i - bpp]) & 0xff;
      return;
    case 2: // Up
      for (let i = 0; i < line.length; i++) line[i] = (line[i] + previous[i]) & 0xff;
      return;
    case 3: // Average
      for (let i = 0; i < line.length; i++) {
        const left = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xff;
      }
      return;
    case 4: // Paeth
      for (let i = 0; i < line.length; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = previous[i];
        const c = i >= bpp ? previous[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i] + predictor) & 0xff;
      }
      return;
    default:
      throw new Error(`unsupported PNG filter ${filter}`);
  }
}

// MARK: box-filter downscale (area average — clean for large factors)

export function resizeRGBA({ width, height, pixels }, target) {
  const out = Buffer.alloc(target * target * 4);
  const fx = width / target;
  const fy = height / target;
  for (let ty = 0; ty < target; ty++) {
    for (let tx = 0; tx < target; tx++) {
      const x0 = Math.floor(tx * fx);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * fx));
      const y0 = Math.floor(ty * fy);
      const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * fy));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const at = (y * width + x) * 4;
          r += pixels[at];
          g += pixels[at + 1];
          b += pixels[at + 2];
          a += pixels[at + 3];
          n++;
        }
      }
      const to = (ty * target + tx) * 4;
      out[to] = Math.round(r / n);
      out[to + 1] = Math.round(g / n);
      out[to + 2] = Math.round(b / n);
      out[to + 3] = Math.round(a / n);
    }
  }
  return out;
}

// MARK: ICO writing (32bpp BMP entries)

function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);           // biSize
  header.writeInt32LE(size, 4);          // biWidth
  header.writeInt32LE(size * 2, 8);      // biHeight = image + AND mask
  header.writeUInt16LE(1, 12);           // biPlanes
  header.writeUInt16LE(32, 14);          // biBitCount
  header.writeUInt32LE(0, 16);           // biCompression = BI_RGB
  header.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  // Bottom-up BGRA.
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const from = src + x * 4;
      const to = (y * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  const maskStride = Math.ceil(size / 32) * 4; // fully transparent via alpha
  const mask = Buffer.alloc(maskStride * size);
  return Buffer.concat([header, pixels, mask]);
}

export function buildICO(png) {
  const entries = SIZES.map((size) => ({ size, data: bmpEntry(size, resizeRGBA(png, size)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const directory = Buffer.alloc(entries.length * 16);
  entries.forEach(({ size, data }, i) => {
    const at = i * 16;
    directory[at] = size === 256 ? 0 : size;
    directory[at + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, at + 4);  // planes
    directory.writeUInt16LE(32, at + 6); // bpp
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, directory, ...entries.map((e) => e.data)]);
}

/// Regenerates build/QuotaBar.ico from docs/icon-1024.png.
export function makeIco() {
  const png = decodePNG(fs.readFileSync(SOURCE_PNG));
  fs.mkdirSync(path.dirname(OUT_ICO), { recursive: true });
  fs.writeFileSync(OUT_ICO, buildICO(png));
  return OUT_ICO;
}

// Direct run: node scripts/make-ico.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Icon written: ${makeIco()}`);
}
