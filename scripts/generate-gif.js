#!/usr/bin/env node
// 无 GUI 的命令行生成器（开发用）：生成两张图之间的过渡 GIF
// 用法：node scripts/generate-gif.js <图1> <图2> <输出.gif> [aba|ab]
// 依赖：canvas（devDependency）、lib/primitive.js（调用 primitive）、lib/encoder.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { imageToData, SIZE } = require('../lib/primitive');
const { createEncoder } = require('../lib/encoder');

const OUT_SIZE = 320;
const TRANSITION_DURATION = 1200;
const STAGGER = 1;
const HOLD = 600;

function coverToSquare(img, size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const s = Math.max(size / img.width, size / img.height);
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' + Math.round(lerp(a[1], b[1], t)) + ',' + Math.round(lerp(a[2], b[2], t)) + ')';
}

function buildSegments(dataA, dataB, direction, count) {
  const raw = direction === 'ab'
    ? [{ from: dataA, to: dataB, holdAfter: 0 }]
    : [{ from: dataA, to: dataB, holdAfter: HOLD }, { from: dataB, to: dataA, holdAfter: HOLD }];
  let cursor = 0;
  const segs = raw.map((s) => {
    const len = TRANSITION_DURATION + STAGGER * (count - 1);
    const seg = { from: s.from, to: s.to, start: cursor, len, holdAfter: s.holdAfter };
    cursor += len + s.holdAfter;
    return seg;
  });
  return { segs, total: cursor };
}

function drawFrame(ctx, segs, count, t, scaleX, scaleY, outW, outH) {
  let seg = segs[segs.length - 1];
  for (const s of segs) {
    if (t >= s.start && t < s.start + s.len + s.holdAfter) { seg = s; break; }
  }
  const localT = t - seg.start;
  const inHold = localT >= seg.len;
  const A = seg.from, B = seg.to;

  const rectP = inHold ? 1 : clamp01(localT / TRANSITION_DURATION);
  ctx.fillStyle = lerpColor(A.rect.fill, B.rect.fill, rectP);
  ctx.fillRect(0, 0, outW, outH);

  for (let i = 0; i < count; i++) {
    const p = inHold ? 1 : clamp01((localT - i * STAGGER) / TRANSITION_DURATION);
    const pa = A.points[i], pb = B.points[i];
    ctx.fillStyle = lerpColor(pa.fill, pb.fill, p);
    ctx.globalAlpha = lerp(parseFloat(pa['fill-opacity']), parseFloat(pb['fill-opacity']), p);
    ctx.beginPath();
    ctx.ellipse(
      lerp(pa.cx, pb.cx, p) * scaleX,
      lerp(pa.cy, pb.cy, p) * scaleY,
      lerp(pa.rx, pb.rx, p) * scaleX,
      lerp(pa.ry, pb.ry, p) * scaleY,
      0, 0, Math.PI * 2
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

async function main() {
  const [imgAPath, imgBPath, outPath, direction = 'aba'] = process.argv.slice(2);
  if (!imgAPath || !imgBPath || !outPath) {
    console.error('用法：node scripts/generate-gif.js <图1> <图2> <输出.gif> [aba|ab]');
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
  const tmpA = path.join(tmpDir, 'a.png');
  const tmpB = path.join(tmpDir, 'b.png');
  fs.writeFileSync(tmpA, coverToSquare(await loadImage(imgAPath), SIZE).toBuffer('image/png'));
  fs.writeFileSync(tmpB, coverToSquare(await loadImage(imgBPath), SIZE).toBuffer('image/png'));

  console.log('生成形状（n=3000，约 10-20 秒）...');
  const dataA = await imageToData(tmpA, (p) => process.stdout.write('\r图1 ' + Math.round(p * 100) + '%   '));
  process.stdout.write('\n');
  const dataB = await imageToData(tmpB, (p) => process.stdout.write('\r图2 ' + Math.round(p * 100) + '%   '));
  process.stdout.write('\n');
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const count = Math.min(dataA.points.length, dataB.points.length);
  const scaleX = OUT_SIZE / dataA.width;
  const scaleY = OUT_SIZE / dataA.height;
  const fps = direction === 'aba' ? 8 : 15;
  const { segs, total } = buildSegments(dataA, dataB, direction, count);
  const interval = 1000 / fps;
  const frameTimes = [];
  for (let t = 0; t <= total; t += interval) frameTimes.push(t);

  const canvas = createCanvas(OUT_SIZE, OUT_SIZE);
  const ctx = canvas.getContext('2d');
  const encoder = createEncoder(OUT_SIZE, OUT_SIZE, fps);
  for (let i = 0; i < frameTimes.length; i++) {
    drawFrame(ctx, segs, count, frameTimes[i], scaleX, scaleY, OUT_SIZE, OUT_SIZE);
    encoder.addFrame(ctx.getImageData(0, 0, OUT_SIZE, OUT_SIZE).data);
  }

  console.log('编码中...');
  const { buffer } = await encoder.finish();
  fs.writeFileSync(outPath, buffer);
  console.log('已生成 ' + outPath + '（' + frameTimes.length + ' 帧，' + (buffer.length / 1024 / 1024).toFixed(2) + ' MB）');
}

main().catch((e) => { console.error(e); process.exit(1); });
