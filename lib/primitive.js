// 生成形状：调用 primitive (Go 二进制) 把图片转成 SVG，再解析成点集。
// 纯 Node、无原生模块依赖，运行在 Electron 主进程。
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 已定基线参数（以后都用 n=3000）
const N_PRIMITIVES = 3000; // 形状数量
const SIZE = 700;          // 源渲染尺寸
const ALPHA = 255;         // 不透明（好压缩）
const MODE = 4;            // 4 = circle

function resolvePrimitivePath() {
  if (process.env.PRIMITIVE_PATH && fs.existsSync(process.env.PRIMITIVE_PATH)) {
    return process.env.PRIMITIVE_PATH;
  }
  const exe = process.platform === 'win32' ? 'primitive.exe' : 'primitive';
  // 打包后：resources/primitive/primitive.exe
  const bundled = path.join(process.resourcesPath || '', 'primitive', exe);
  if (fs.existsSync(bundled)) return bundled;
  // 开发期：go/bin 下的 primitive
  const goBin = path.join(os.homedir(), 'go', 'bin', exe);
  if (fs.existsSync(goBin)) return goBin;
  // 兜底：依赖 PATH
  return 'primitive';
}

function runPrimitive(imagePath, outSvgPath, onProgress) {
  const bin = resolvePrimitivePath();
  const args = [
    '-i', imagePath,
    '-o', outSvgPath,
    '-r', String(SIZE),
    '-s', String(SIZE),
    '-n', String(N_PRIMITIVES),
    '-a', String(ALPHA),
    '-m', String(MODE),
    '-v', // 逐形状打印进度
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stderr = '';
    const onData = (d) => {
      const text = d.toString();
      stderr += text;
      if (!onProgress) return;
      // 进度行形如 "123: t=..., score=..., n=..., n/s=..."
      for (const line of text.split('\n')) {
        const m = /^(\d+):/.exec(line.trim());
        if (m) onProgress(Math.min(1, parseInt(m[1], 10) / N_PRIMITIVES));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => reject(new Error('无法启动 primitive：' + err.message)));
    child.on('close', (code) => {
      if (code === 0) resolve(outSvgPath);
      else reject(new Error('primitive 退出码 ' + code + '：' + stderr));
    });
  });
}

function getAttr(tag, name) {
  const m = new RegExp(name + '="([^"]*)"').exec(tag);
  return m ? m[1] : null;
}

function svgToData(svgText) {
  const svgTag = /<svg\b[^>]*>/.exec(svgText);
  const rectTag = /<rect\b[^>]*>/.exec(svgText);
  const rect = rectTag
    ? {
        x: getAttr(rectTag[0], 'x'),
        y: getAttr(rectTag[0], 'y'),
        width: getAttr(rectTag[0], 'width'),
        height: getAttr(rectTag[0], 'height'),
        fill: getAttr(rectTag[0], 'fill'),
      }
    : null;

  const points = [];
  const ellipseRe = /<ellipse\b[^>]*>/g;
  let m;
  while ((m = ellipseRe.exec(svgText)) !== null) {
    points.push({
      fill: getAttr(m[0], 'fill'),
      'fill-opacity': getAttr(m[0], 'fill-opacity'),
      cx: parseFloat(getAttr(m[0], 'cx')),
      cy: parseFloat(getAttr(m[0], 'cy')),
      rx: parseFloat(getAttr(m[0], 'rx')),
      ry: parseFloat(getAttr(m[0], 'ry')),
    });
  }

  return {
    width: svgTag ? parseFloat(getAttr(svgTag[0], 'width')) : SIZE,
    height: svgTag ? parseFloat(getAttr(svgTag[0], 'height')) : SIZE,
    rect,
    points,
  };
}

// 一次调用：图片 -> SVG -> 点集数据
async function imageToData(imagePath, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prim-'));
  const svgPath = path.join(tmpDir, 'out.svg');
  try {
    await runPrimitive(imagePath, svgPath, onProgress);
    const svgText = fs.readFileSync(svgPath, 'utf8');
    return svgToData(svgText);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { imageToData, svgToData, N_PRIMITIVES, SIZE, ALPHA };
