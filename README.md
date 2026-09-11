# 图片过渡 GIF 生成器（Image Transition GIF Generator）

一个傻瓜式的桌面应用：导入两张图片，一键生成它们之间「点阵风格」的过渡动画 GIF，并可预览、保存。

- 双击即可运行，无需安装任何环境（打包好的便携版 .exe）
- 内置 [Primitive](https://github.com/fogleman/primitive) 形状生成 + 逐帧渲染
- 可选 A→B→A 往返 / A→B 单向过渡

## 快速开始

### 方式一：直接运行打包好的 exe

用 `npm run dist` 打包后，产物在 `dist/` 目录（如 `ImageTransition 1.0.0.exe`），拷到任意 Windows 机器双击即可运行（首次打开会自解压，稍慢几秒）。

### 方式二：源码运行（开发）

```bash
npm install
npm start
```

## 使用说明

1. **准备两张图**：先手动裁成**方形**，并尽量让主体位置、大小对齐（见下方「重要：需要手动裁切」）。
2. 双击启动应用 → 点「选择图 1」「选择图 2」导入两张图。
3. 选择过渡方向（A→B→A 往返 / A→B 单向）。
4. 点「生成」，等待进度条走完。
5. 预览动画，点「保存 GIF」存到本地。

> 示例图片放在 `samples/` 目录。

## 重要：需要手动裁切

导入前请**先把图片裁成方形**，并尽量让两张图的主体位置、大小、朝向保持一致：

- 应用会自动把图片居中缩放到 700×700 填满画布，但**不会替你判断「主体在哪」**；
- 如果两张图主体位置差别很大，过渡动画里物体会「飘」、对不齐；
- 所以裁切时，让主体居中、占比相近，过渡效果最好。非方形图会被自动居中裁切，可能裁掉主体，因此建议自己裁好再导入。

## 默认参数

| 项 | 值 |
|---|---|
| 形状数量 n | 3000 |
| 输出尺寸 | 320×320 |
| 透明度 | 不透明（alpha=255） |
| 过渡方向 | A→B→A / A→B 可选 |

## 打包 exe

```bash
npm run dist
```

国内网络若连不上 GitHub，加镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist
```

## 技术栈

Electron、Node.js、[@skyra/gifenc](https://github.com/skyra-project/gifenc)、[fogleman/primitive](https://github.com/fogleman/primitive)（Go 二进制，内置在 `bin/` 与打包产物中）。

## 致谢 / 来源

本项目是 [duhaime/d3-image-transitions](https://github.com/duhaime/d3-image-transitions) 的 GUI 重实现。

- **原始项目**：[duhaime/d3-image-transitions](https://github.com/duhaime/d3-image-transitions) —— "Transition between scatterplot representations of images with D3.js"。把图片转成形状点集、在点集之间做过渡动画的思路来源于此。
- **形状生成**：[fogleman/primitive](https://github.com/fogleman/primitive)（MIT 许可）。

> 注意：原始项目 duhaime/d3-image-transitions **未声明许可证**；本仓库是独立重实现（Electron + Node + Primitive），核心代码已重写，仅沿用其思路。
