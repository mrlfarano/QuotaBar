import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encodePNG } from '../src/png.js';
import { dualRingPNG, gaugeRingPNG } from '../src/ringicon.js';
import { decodePNG, resizeRGBA, buildICO } from '../scripts/make-ico.js';

test('PNG encoding preserves RGBA and emits valid chunk CRCs', () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 32, 64, 128, 255]);
  const png = encodePNG(2, 2, pixels);
  assert.deepEqual(decodePNG(png), { width: 2, height: 2, pixels });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  // Independent bitwise CRC checks catch corrupted PNG chunks, including IHDR.
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    let crc = 0xffffffff;
    for (const byte of png.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, png.readUInt32BE(offset + 8 + length));
    offset += 12 + length;
  }
});

for (const size of [16, 32]) {
  test(`tray icons render transparent ${size}px images for each band`, () => {
    for (const band of ['green', 'yellow', 'red']) {
      const png = dualRingPNG({ size, fiveRemaining: 50, fiveBand: band, weekRemaining: 20, weekBand: 'red' });
      const image = decodePNG(png);
      assert.equal(image.width, size);
      assert.equal(image.height, size);
      assert.equal(image.pixels[3], 0, 'Corner must remain transparent');
      assert.ok(image.pixels.some((v, i) => i % 4 === 3 && v > 0), 'Glyph cannot be blank');
      assert.equal(decodePNG(gaugeRingPNG({ size, pct: 50, band })).width, size);
    }
  });
}

test('box downscale averages colors and alpha', () => {
  assert.deepEqual(resizeRGBA({ width: 2, height: 2, pixels: Buffer.from([
    0, 0, 0, 0, 100, 0, 0, 100, 0, 100, 0, 200, 0, 0, 100, 100,
  ]) }, 1), Buffer.from([25, 25, 25, 100]));
});

test('packaging icon contains bounded 32-bit BMP entries at all Windows sizes', () => {
  const png = decodePNG(fs.readFileSync(new URL('../../docs/icon-1024.png', import.meta.url)));
  const ico = buildICO(png);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 4);
  let end = 70;
  for (const [i, size] of [256, 48, 32, 16].entries()) {
    const at = 6 + i * 16;
    assert.equal(ico[at] || 256, size);
    assert.equal(ico[at + 1] || 256, size);
    assert.equal(ico.readUInt16LE(at + 6), 32);
    const length = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    assert.equal(offset, end);
    assert.equal(ico.readUInt32LE(offset), 40);
    assert.equal(ico.readInt32LE(offset + 4), size);
    assert.equal(ico.readInt32LE(offset + 8), size * 2);
    end = offset + length;
    assert.ok(end <= ico.length);
  }
  assert.equal(end, ico.length);
});

test('PNG decoder rejects unsupported image format', () => {
  assert.throws(() => decodePNG(Buffer.alloc(16)), /not a PNG/);
  const png = encodePNG(1, 1, Buffer.from([0, 0, 0, 255]));
  png[24] = 16;
  assert.throws(() => decodePNG(png), /8-bit non-interlaced/);
});
