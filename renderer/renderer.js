// 渲染进程：UI 逻辑 + 逐帧渲染（浏览器 canvas）+ 与主进程交互。
window.addEventListener('error', (e) => console.log('[renderer] onerror:', e.message));
window.addEventListener('unhandledrejection', (e) => console.log('[renderer] unhandledrejection:', e.reason));
// 注意：window.api 已由 preload 的 contextBridge 暴露为全局 api，
// 这里不能再 const api = window.api（会与全局 api 冲突报 SyntaxError），直接用全局 api。

const TRANSITION_DURATION = 1200; // 单段过渡时长 ms
const STAGGER = 1;                // 逐点延迟 ms
const HOLD = 600;                 // 每段过渡后停留 ms（仅 aba）
const OUT_SIZE = 320;             // 输出尺寸（沿用基线）
const PP_SIZE = 700;              // 预处理尺寸，需与 lib/primitive.js 的 SIZE 一致

const state = { imgA: null, imgB: null };

const el = {
  thumbA: document.getElementById('thumb-a'),
  thumbB: document.getElementById('thumb-b'),
  nameA: document.getElementById('name-a'),
  nameB: document.getElementById('name-b'),
  generate: document.getElementById('generate'),
  save: document.getElementById('save'),
  status: document.getElementById('status'),
  previewWrap: document.getElementById('preview-wrap'),
  preview: document.getElementById('preview'),
  meta: document.getElementById('meta'),
  fps: document.getElementById('fps'),
  progressWrap: document.getElementById('progress-wrap'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
};

function setStatus(text) { el.status.textContent = text; }

const STAGE_LABELS = {
  'primitive-a': '生成图 1 形状',
  'primitive-b': '生成图 2 形状',
  'render': '渲染动画帧',
  'encode': '编码 GIF',
};
const progressState = { stage: null, start: 0 };
function updateProgress(stage, pct) {
  el.progressWrap.hidden = false;
  if (progressState.stage !== stage) {
    progressState.stage = stage;
    progressState.start = Date.now();
  }
  const label = STAGE_LABELS[stage] || stage;
  el.progressFill.style.width = Math.round(pct * 100) + '%';
  let eta = '';
  if (pct > 0.01 && pct < 1) {
    const elapsed = (Date.now() - progressState.start) / 1000;
    const remaining = Math.max(0, Math.round((elapsed / pct) * (1 - pct)));
    eta = ' · 剩余约 ' + remaining + 's';
  }
  el.progressText.textContent = label + ' · ' + Math.round(pct * 100) + '%' + eta;
}

async function pickImage(slot) {
  const res = await api.pickImage();
  if (!res) return;
  if (slot === 'a') state.imgA = res; else state.imgB = res;
  const thumb = slot === 'a' ? el.thumbA : el.thumbB;
  const name = slot === 'a' ? el.nameA : el.nameB;
  thumb.innerHTML = '';
  const img = document.createElement('img');
  img.src = res.dataUrl;
  thumb.appendChild(img);
  name.textContent = res.path.split(/[\\/]/).pop();
  el.generate.disabled = !(state.imgA && state.imgB);
}

// ---- 渲染相关 ----
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const r = Math.round(lerp(a[0], b[0], t));
  const g = Math.round(lerp(a[1], b[1], t));
  const bl = Math.round(lerp(a[2], b[2], t));
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}

function buildSegments(dataA, dataB, direction, count) {
  const raw = direction === 'ab'
    ? [{ from: dataA, to: dataB, holdAfter: 0 }]
    : [
        { from: dataA, to: dataB, holdAfter: HOLD },
        { from: dataB, to: dataA, holdAfter: HOLD },
      ];
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
  // 背景色过渡（与 draw.js 的 rect 一致：1200ms 无 stagger）
  const rectP = inHold ? 1 : clamp01(localT / TRANSITION_DURATION);
  ctx.fillStyle = lerpColor(A.rect.fill, B.rect.fill, rectP);
  ctx.fillRect(0, 0, outW, outH);

  for (let i = 0; i < count; i++) {
    const p = inHold ? 1 : clamp01((localT - i * STAGGER) / TRANSITION_DURATION);
    const pa = A.points[i], pb = B.points[i];
    const cx = lerp(pa.cx, pb.cx, p) * scaleX;
    const cy = lerp(pa.cy, pb.cy, p) * scaleY;
    const rx = lerp(pa.rx, pb.rx, p) * scaleX;
    const ry = lerp(pa.ry, pb.ry, p) * scaleY;
    ctx.fillStyle = lerpColor(pa.fill, pb.fill, p);
    ctx.globalAlpha = lerp(parseFloat(pa['fill-opacity']), parseFloat(pb['fill-opacity']), p);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// 把图片居中裁成 size×size（cover）并导出 PNG dataUrl，保证两张图尺寸一致、过渡对齐
function preprocessImage(dataUrl, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = dataUrl;
  });
}

async function generate() {
  const width = OUT_SIZE, height = OUT_SIZE;
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const fps = parseInt(el.fps.value, 10);

  el.generate.disabled = true;
  el.save.disabled = true;
  el.previewWrap.hidden = true;
  updateProgress('primitive-a', 0);

  // 预处理：统一缩放/居中到 PP_SIZE×PP_SIZE，避免不同尺寸图对不齐
  let imgA_pp, imgB_pp;
  try {
    imgA_pp = await preprocessImage(state.imgA.dataUrl, PP_SIZE);
    imgB_pp = await preprocessImage(state.imgB.dataUrl, PP_SIZE);
  } catch (err) {
    setStatus('图片处理失败：' + err.message);
    el.progressWrap.hidden = true;
    el.generate.disabled = false;
    return;
  }

  const prep = await api.prepare({ imgA: imgA_pp, imgB: imgB_pp, width, height, fps });
  if (prep.error) {
    setStatus('生成失败：' + prep.error);
    el.progressWrap.hidden = true;
    el.generate.disabled = false;
    return;
  }
  const dataA = prep.dataA, dataB = prep.dataB;

  const count = Math.min(dataA.points.length, dataB.points.length);
  const scaleX = width / dataA.width;
  const scaleY = height / dataA.height;

  const { segs, total } = buildSegments(dataA, dataB, direction, count);
  const interval = 1000 / fps;
  const frameTimes = [];
  for (let t = 0; t <= total; t += interval) frameTimes.push(t);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  for (let i = 0; i < frameTimes.length; i++) {
    drawFrame(ctx, segs, count, frameTimes[i], scaleX, scaleY, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    await api.addFrame(pixels);
    updateProgress('render', (i + 1) / frameTimes.length);
  }

  updateProgress('encode', 1);
  const result = await api.finish();
  if (!result.gifBase64) {
    setStatus('编码失败');
    el.progressWrap.hidden = true;
    el.generate.disabled = false;
    return;
  }

  el.preview.src = 'data:image/gif;base64,' + result.gifBase64;
  el.previewWrap.hidden = false;
  el.meta.textContent =
    width + '×' + height + ' · ' + result.frameCount + ' 帧 · ' +
    (result.size / 1024 / 1024).toFixed(2) + ' MB';
  setStatus('完成');
  el.progressWrap.hidden = true;
  el.save.disabled = false;
  el.generate.disabled = false;
}

async function saveGif() {
  const res = await api.saveGif();
  if (res.saved) setStatus('已保存到 ' + res.path);
  else setStatus('已取消保存');
}

// ---- 事件 ----
document.getElementById('pick-a').addEventListener('click', () => pickImage('a'));
document.getElementById('pick-b').addEventListener('click', () => pickImage('b'));
el.generate.addEventListener('click', generate);
el.save.addEventListener('click', saveGif);

document.querySelectorAll('input[name="direction"]').forEach((r) => {
  r.addEventListener('change', () => {
    el.fps.value = r.value === 'aba' ? '8' : '15';
  });
});

api.onProgress((p) => {
  if (p.stage === 'ready') { setStatus('形状生成完毕'); return; }
  updateProgress(p.stage, p.pct == null ? 0 : p.pct);
});
