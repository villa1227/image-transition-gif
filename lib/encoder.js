// GIF 编码封装：接收 RGBA 像素帧(Uint8ClampedArray)，输出 GIF Buffer。
// 纯 JS（@skyra/gifenc），运行在 Electron 主进程，无原生模块依赖。
const { GifEncoder } = require('@skyra/gifenc');

function createEncoder(width, height, fps) {
  const encoder = new GifEncoder(width, height);
  const chunks = [];
  const stream = encoder.createReadStream();
  stream.on('data', (c) => chunks.push(c));
  encoder.setRepeat(0); // 循环播放
  encoder.setDelay(Math.max(10, Math.round(1000 / fps)));
  encoder.start();
  let frameCount = 0;
  return {
    addFrame(pixels) {
      encoder.addFrame(new Uint8ClampedArray(pixels));
      frameCount++;
    },
    finish() {
      return new Promise((resolve) => {
        stream.on('end', () => resolve({ buffer: Buffer.concat(chunks), frameCount }));
        encoder.finish();
      });
    },
  };
}

module.exports = { createEncoder };
