# Folder Constellation (文件夹星座图)

Windows 桌面应用：选择根目录，扫描 1–2 级子目录并用 D3 气泡图/星团可视化展示。Electron 主进程扫描文件系统，前端使用 React + D3 渲染。

## 技术栈
- Electron（主进程）
- Node.js + TypeScript（扫描）
- React + TypeScript（渲染）
- D3.js（可视化）

## 开发调试

安装依赖并启动开发：

    npm install
    npm run dev

生产构建：

    npm run build

启动构建产物（非打包安装包）：

    npm start

打包安装包（Windows: NSIS）：

    npm run package

开发模式下：
- 渲染进程走 Vite dev server（http://localhost:5173）
- 主进程与 preload 由 tsup watch 编译到 dist/main/
- Electron 由 wait-on 等待端口与主进程构建后启动

## 功能
- 扫描深度默认 2，可在 UI 中选择 1/2/3
- 避免 symlink 死循环（realpath 去重，默认不跟随，支持 followSymlinks=false）
- 使用 readdir({ withFileTypes: true }) 提升效率
- 文件类型分组：video / image / audio / document / code / archive / other
- 星团节点大小 = 文件夹大小（聚合，D3 pack 自动半径）
- 颜色 = 主文件类型（文件大小占比最大）
- Hover 显示详情，点击打开文件夹，右键标记垃圾候选（仅前端标记）
- 当扫描文件数超过 10,000 时直接报错提醒（MVP）

## IPC 规范
- scan-directory 渲染 → 主进程
  - 请求: ScanOptions
  - 响应: { ok: true, result: ScanResult } | { ok: false, error: string }
- open-folder 渲染 → 主进程
  - 请求: path: string
  - 响应: { ok: boolean, error?: string }
- choose-directory（辅助选择根目录）

所有接口通过 preload.ts 暴露至 window.api，启用 contextIsolation，禁用 nodeIntegration。

## 目录结构

    ├─ src
    │  ├─ main           # Electron 主进程 + 预加载脚本
    │  │  ├─ scan        # 扫描模块（核心逻辑）
    │  │  ├─ main.ts
    │  │  └─ preload.ts
    │  ├─ renderer       # React + D3 前端
    │  │  ├─ components
    │  │  ├─ hooks
    │  │  ├─ utils
    │  │  ├─ App.tsx
    │  │  ├─ index.html
    │  │  └─ main.tsx
    │  ├─ preload        # 全局类型定义
    │  │  └─ global.d.ts
    │  └─ shared         # 共享类型
    │     └─ types.ts
    ├─ dist              # 构建输出

## 备注
- 第二级目录可视化：当前采用 D3 pack 的嵌套（depth=1/2 两层渲染）。需要仅统计不渲染时，可在图层中过滤 n.depth === 1。
- 如需全量深度扫描，可在 UI 里将深度提升（扫描模块已支持任意深度）。

## 许可证
MIT

