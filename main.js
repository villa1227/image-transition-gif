const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { imageToData } = require('./lib/primitive');
const { createEncoder } = require('./lib/encoder');

let mainWindow;
let encoder = null;
let lastGif = null; // { buffer, size }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 把渲染进程的 console 转发到主进程 stdout，便于排查
  mainWindow.webContents.on('console-message', (_e, _level, message) => {
    console.log('[renderer]', message);
  });
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

function dataUrlToTempFile(dataUrl) {
  const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('无效的图片数据');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-'));
  const f = path.join(dir, 'img.' + ext);
  fs.writeFileSync(f, Buffer.from(m[2], 'base64'));
  return f;
}

app.whenReady().then(() => {
  ipcMain.handle('pick-image', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: IMAGE_EXT }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const dataUrl = 'data:image/' + mime + ';base64,' + fs.readFileSync(filePath).toString('base64');
    return { path: filePath, dataUrl };
  });

  ipcMain.handle('prepare', async (event, payload) => {
    const { imgA, imgB, width, height, fps } = payload;
    let tmpA, tmpB;
    try {
      tmpA = dataUrlToTempFile(imgA);
      tmpB = dataUrlToTempFile(imgB);
      event.sender.send('progress', { stage: 'primitive-a', pct: 0 });
      const dataA = await imageToData(tmpA, (pct) => {
        event.sender.send('progress', { stage: 'primitive-a', pct });
      });
      event.sender.send('progress', { stage: 'primitive-b', pct: 0 });
      const dataB = await imageToData(tmpB, (pct) => {
        event.sender.send('progress', { stage: 'primitive-b', pct });
      });
      event.sender.send('progress', { stage: 'ready' });
      encoder = createEncoder(width, height, fps);
      return { dataA, dataB };
    } catch (err) {
      return { error: err.message };
    } finally {
      if (tmpA) fs.rmSync(path.dirname(tmpA), { recursive: true, force: true });
      if (tmpB) fs.rmSync(path.dirname(tmpB), { recursive: true, force: true });
    }
  });

  ipcMain.handle('add-frame', async (_event, pixels) => {
    encoder.addFrame(pixels);
    return { ok: true };
  });

  ipcMain.handle('finish', async () => {
    const { buffer, frameCount } = await encoder.finish();
    lastGif = { buffer, size: buffer.length };
    return { gifBase64: buffer.toString('base64'), size: buffer.length, frameCount };
  });

  ipcMain.handle('save-gif', async () => {
    if (!lastGif) return { saved: false };
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '保存 GIF',
      defaultPath: 'transition.gif',
      filters: [{ name: 'GIF', extensions: ['gif'] }],
    });
    if (res.canceled || !res.filePath) return { saved: false };
    fs.writeFileSync(res.filePath, lastGif.buffer);
    return { saved: true, path: res.filePath };
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
