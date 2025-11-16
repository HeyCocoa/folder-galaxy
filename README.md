# folder galaxy（文件夹星座图）

一个用于可视化磁盘空间占用的 Windows 桌面应用：选择根目录，一键扫描并用「星座图」形式展示各子目录/文件的大小分布。应用基于 Electron + Node.js + TypeScript + React + D3 构建。

> 设计目标：快速看清哪个目录/文件占了多少空间、哪些是垃圾候选，方便定位和清理。

---

## 功能概览

- 目录扫描
  - 支持选择任意根目录（例如整块盘符、用户目录、视频盘等）。
  - 默认「不限制深度」，会递归扫描整个子树；如需限制可在内部调用 `scanDirectory` 时传入 `maxDepth`。
  - 支持控制：
    - 是否包含隐藏文件/目录（例如 `.git`、`Thumbs.db` 等）。
    - 是否包含系统目录（如 `Windows`、`Program Files`、`$Recycle.Bin` 等，会自动根据根路径进行排除）。
    - 是否展开到单个文件（`includeFiles: true` 时，会在图中为文件单独画点）。
  - 避免死循环：
    - 使用 `fs.realpath` + `visitedRealPaths` 对真实路径去重，防止 symlink/硬链接形成的环。
    - `followSymlinks` 默认关闭，只有在明确启用时才递归跟随。

- 空间统计与类型分组
  - 对每个目录记录：
    - `totalSize`：该目录下所有子目录/文件的总大小。
    - `fileCount`：文件数量。
    - `subfolderCount`：子目录数量。
    - `typeBreakdown`：按文件类型分组的大小与数量。
  - 文件类型分组（见 `src/main/scan/fileTypes.ts`）：
    - `video`：`mp4 / mkv / avi / mov / ...`
    - `image`：`jpg / png / svg / webp / ...`
    - `audio`：`mp3 / flac / wav / ...`
    - `document`：`pdf / docx / pptx / xlsx / csv / md / txt / ...`
    - `code`：`js / ts / py / java / cpp / json / yml / ...`
    - `archive`：`zip / rar / 7z / tar / gz / iso / ...`
    - `other`：未归类到以上任一分组的扩展名。

- 可视化（星座图 / Circle Packing）
  - 使用 D3 的 `pack` 布局生成层级圆形打包布局，整体视觉为暖色深色主题。
  - 每个圆（节点）代表一个目录或文件：
    - 半径：与该节点对应的 `totalSize` 成比例。
    - 填充颜色：
      - 对目录：根据主导文件类型和预设调色板生成偏暖的灰蓝色。
      - 对文件：直接使用其 `fileType` 对应的颜色（提高可区分度）。
    - 外环描边：根据层级/是否文件微调半径与线宽，避免出现黑边。
  - 交互行为：
    - hover：
      - 显示悬浮 tooltip（名称 / 大小 / 占比 / 文件数 / 子目录数 / 完整路径）。
      - 节点被稍微放大并提亮填充颜色。
    - 左键单击目录节点：
      - 将当前视图「钻取」到该目录（focus 模式），只展示该目录下面的内容。
      - 同时刷新底部 breadcrumbs（路径导航）和右下角 info panel（详情面板）。
    - 左键单击文件节点：
      - 当前不会触发打开操作，避免误触（右键菜单负责打开）。
    - 右键单击节点（文件 / 目录）：
      - 弹出自定义右键菜单（不会展示浏览器默认菜单）：
        - 「在文件管理器中打开」
          - 目录：用系统文件管理器打开该目录。
          - 文件：用系统文件管理器打开其父目录（并由系统决定是否高亮选中该文件）。
        - 「用系统默认方式打开」
          - 直接调用 `shell.openPath`，用当前系统默认程序打开该路径（例如 txt 用默认编辑器、视频用默认播放器）。
        - 虚拟节点（如 `(files)` 汇总节点）会被自动忽略，不提供菜单。
    - 拖拽 / 缩放：
      - 支持鼠标拖拽平移画布。
      - 鼠标滚轮缩放。
      - 底部有缩放条和提示文字：「滚轮缩放 · 双击放大 · 拖拽平移」。
    - 面包屑导航（breadcrumbs）：
      - 展示当前 focus 节点的路径，点击任意一段可快速跳回该层级。
    - Info Panel 右下角信息面板：
      - 展示当前选中节点的名称、大小、子目录/文件数量以及完整路径。

- 性能与安全限制
  - `MAX_FILE_THRESHOLD = 10_000`：
    - 在 `includeFiles` 模式下，当单个扫描任务下的文件数量超过此阈值时，会以报错的方式提醒用户，避免渲染过多节点导致 UI 卡顿。
  - 软文件上限 `softFileLimit`（默认 1,000,000）：
    - 扫描时做软限制，可以在未来扩展为指标/警告而不是硬中断。
  - 扫描过程会定期通过 `scan-progress` 通道发送进度（扫描文件数 / 目录数 / 已耗时），界面会实时显示。

---

## 技术栈与架构

- Electron 主进程（`src/main`）
  - 负责创建浏览器窗口、绑定 preload 脚本、处理 IPC 调用、调用 Node 文件系统 API。
  - 使用 `tsup` 构建为 CommonJS 格式，并在打包时输出到 `dist/main`。
  - 核心依赖：
    - `electron`（窗口与 IPC）
    - Node.js 内置模块：`fs`、`path`、`crypto` 等。

- 扫描引擎（`src/main/scan`）
  - `scanDirectory.ts`：
    - 深度优先扫描目录结构：
      - 使用 `fs.readdir({ withFileTypes: true })` 加速目录遍历。
      - 使用并发控制（`pMap` + `concurrency`）提高性能，默认并发 64。
      - 通过 `includeHidden`、`includeSystem`、`followSymlinks` 等选项控制行为。
    - 计算：
      - 单个目录的直接大小与文件数量。
      - 递归汇总子目录的大小与类型分布。
      - 可选地收集文件级别统计（生成 `files: FileStats[]`），用于在前端画出文件节点。
    - 针对 Windows 的系统目录过滤：
      - 在盘符根路径下排除 `Windows`、`Program Files`、`Program Files (x86)`、`ProgramData` 等常见路径。
      - 排除 `$Recycle.Bin`、`System Volume Information`、`Recovery`、`PerfLogs` 等。
      - 针对 `Users/*/AppData` 做单独排除，避免扫描用户缓存目录。
  - `fileTypes.ts`：
    - 维护扩展名 → `FileTypeGroup` 的映射，用于后续可视化配色与统计。

- 渲染层（`src/renderer`）
  - 基于 React + TypeScript + Vite。
  - 入口：
    - `main.tsx` / `App.tsx`：挂载应用、组织整体布局。
  - 主要组件：
    - `Components/ConstellationGraph.tsx`：星座图主视图（D3 pack 布局 + 交互）。
    - `Components/Controls.tsx`：右上角工具栏（选择目录、开关选项、开始/取消扫描等）。
  - 样式：
    - `styles.css`：整套 UI 的主题、布局、tooltip、info panel、zoom bar、右键菜单等。
  - 实时交互：
    - 通过 `window.api.scanDirectory` 发起扫描。
    - 通过 `window.api.onScanProgress` 订阅进度事件，更新扫描状态文本。

- 预加载脚本与类型（`src/main/preload.ts` + `src/preload/global.d.ts`）
  - 使用 `contextBridge.exposeInMainWorld('api', api)` 暴露受限的 `window.api`：
    - `scanDirectory(options: ScanOptions)`：发起扫描，返回 `IpcResult<ScanResult>`。
    - `onScanProgress(listener)`：监听 `scan-progress` 事件，返回取消订阅函数。
    - `cancelScan(scanId)`：请求取消指定扫描任务。
    - `openFolder(path)`：在文件管理器中打开目录或文件所在目录。
    - `openPath(path)`：用系统默认程序打开文件或目录。
    - `chooseDirectory()`：调起系统目录选择对话框。
  - `src/preload/global.d.ts`：
    - 声明全局 `window.api` 类型（`PreloadApi`），确保 renderer 侧 TypeScript 有完整提示。

- 共享类型定义（`src/shared/types.ts`）
  - `ScanOptions`、`ScanResult`、`FolderStats`、`FileStats`、`ScanProgress` 等。
  - IPC 返回包装类型：`IpcResult<T> = { ok: true; result: T } | { ok: false; error: string }`。
  - `FileTypeGroup` 枚举所有支持的文件类型分组。

---

## 运行与构建

### 安装依赖

```bash
npm install
```

### 开发调试

```bash
npm run dev
```

开发模式下：

- 渲染进程：通过 Vite dev server 提供（当前配置端口为 5176）。
- 主进程 & preload：由 tsup 以 watch 模式构建到 `dist/main`。
- Electron：使用 `wait-on` 等待端口和 `dist/main/main.js` 就绪后启动。

### 生产构建

```bash
npm run build
```

- 清理 `dist/`。
- 用 tsup 构建主进程 + preload 至 `dist/main`。
- 用 Vite 构建前端至 `dist/renderer`。

### 启动已构建产物

```bash
npm start
```

- 从 `dist/main/main.js` 与 `dist/renderer/index.html` 启动 Electron 应用。

### 打包安装包（Windows）

```bash
npm run package
```

- 基于 `electron-builder` 生成 Windows 安装包（NSIS）。
- 配置见 `package.json` 中的 `"build"` 字段：
  - `appId`、`productName`、`files`、`win.target = nsis`、`icon = build/icon.ico` 等。

---

## 交互说明（使用指南）

1. 打开应用后，点击右上角齿轮图标打开设置面板。
2. 点击「选择目录」，在系统对话框中选中你想分析的根目录。
3. 勾选/取消：
   - 「包含隐藏」：是否包含隐藏文件/目录。
   - 「包含系统目录」：是否包含系统级目录（不建议在系统盘勾选，会很慢）。
4. 点击「开始扫描」：
   - 下方会显示扫描进度（已扫描文件数 / 目录数 / 耗时秒数）。
   - 可以随时点击「取消」终止扫描。
5. 扫描完成后：
   - 画布中会出现一堆圆圈（目录/文件）。
   - 鼠标移动到圆圈上可以查看详情 tooltip。
   - 点击某个目录圆圈可以钻取到该目录（画面会重新布局）。
   - 右下角 info panel 会显示当前选中目录/文件的摘要信息。
6. 右键某个圆圈：
   - 「在文件管理器中打开」：用系统文件管理器打开该目录或该文件所在目录。
   - 「用系统默认方式打开」：用操作系统为该扩展名配置的默认程序打开文件 / 目录。
7. 使用底部缩放条或鼠标滚轮：
   - 缩小/放大视图，配合拖拽以便查看细节区域或全局布局。
8. 使用左下角 breadcrumbs：
   - 点击任意一级路径（例如根路径），快速回到该层级的视图。

---

## IPC 规范（协议层）

- `scan-directory`
  - 渲染 → 主进程（`ipcRenderer.invoke`）
  - 请求：`ScanOptions`
  - 响应：`IpcResult<ScanResult>`
  - 进度事件：主进程通过 `scan-progress` 频道多次 `sender.send`，负载为 `ScanProgress`。

- `cancel-scan`
  - 渲染 → 主进程
  - 请求：`scanId: string`
  - 响应：`{ ok: boolean }`
  - 主进程内部通过 `scanAbortMap` 及 `isCancelled` 回调实现取消。

- `open-folder`
  - 渲染 → 主进程
  - 请求：`targetPath: string`
  - 行为：
    - 如果是文件路径：取 `path.dirname(targetPath)` 后 `shell.openPath`。
    - 如果是目录路径：直接 `shell.openPath(targetPath)`。
  - 响应：`{ ok: boolean; error?: string }`

- `open-path`
  - 渲染 → 主进程
  - 请求：`targetPath: string`
  - 行为：`shell.openPath(targetPath)`，由操作系统决定打开方式。
  - 响应：`{ ok: boolean; error?: string }`

- `choose-directory`
  - 渲染 → 主进程
  - 行为：`dialog.showOpenDialog({ properties: ['openDirectory'] })`。
  - 响应：Electron 原始返回值 `{ canceled: boolean; filePaths: string[] }`。

所有 IPC 都通过 `preload.ts` 暴露的 `window.api` 访问，在渲染进程内无法直接访问 Node API，保证 `contextIsolation: true` 与 `nodeIntegration: false` 的安全配置。

---

## 目录结构（详细）

```text
├─ src
│  ├─ main                    # Electron 主进程 + preload
│  │  ├─ scan                 # 文件系统扫描引擎
│  │  │  ├─ scanDirectory.ts  # 核心扫描逻辑
│  │  │  └─ fileTypes.ts      # 扩展名 → FileTypeGroup 映射
│  │  ├─ main.ts              # 创建窗口、注册 IPC 处理器
│  │  └─ preload.ts           # 暴露 window.api（安全桥接层）
│  ├─ renderer                # React + D3 前端
│  │  ├─ components
│  │  │  ├─ App.tsx           # 应用根组件
│  │  │  ├─ ConstellationGraph.tsx  # 星座图主视图（D3 Circle Packing）
│  │  │  └─ Controls.tsx      # 右上角控制面板
│  │  ├─ hooks                # 自定义 hooks（如 useResizeObserver / useDebounced）
│  │  ├─ utils                # 工具函数（格式化字节数、数值等）
│  │  ├─ index.html           # 渲染入口 HTML
│  │  └─ main.tsx             # React/Vite 入口
│  ├─ preload
│  │  └─ global.d.ts          # 声明 window.api 类型（PreloadApi）
│  ├─ shared
│  │  └─ types.ts             # ScanOptions / ScanResult / FileStats 等共享类型
│  └─ types                   # 预留的额外类型声明（如有）
├─ build                      # electron-builder 打包资源（图标等）
├─ dist                       # 构建输出目录（main + renderer）
├─ scripts                    # 额外脚本（如有）
├─ tsconfig*.json             # TypeScript 配置（main/preload/renderer）
├─ tsup.config.ts             # tsup 构建配置
├─ vite.config.ts             # Vite 构建配置（端口、别名等）
└─ package.json               # npm 脚本与依赖
```

---

## 安全与约束

- Electron 配置：
  - `contextIsolation: true`：渲染与主进程隔离。
  - `nodeIntegration: false`：渲染进程中无法直接使用 Node API。
  - 所有需要访问文件系统与系统功能的操作，都必须通过 `window.api` → IPC → 主进程来完成。
- 扫描选项：
  - 默认 `followSymlinks = false`，避免意外遍历网络盘或挂载点。
  - 建议谨慎对系统盘启用「包含系统目录」，避免扫描大体量系统文件夹导致长时间 IO。

---

## Roadmap / 可拓展方向

- 自定义规则：
  - 支持排除/包含特定路径或扩展名（例如忽略 `node_modules` / `.git`）。
- 多视图：
  - 除 Circle Packing 外，增加矩形 treemap、条形图等展示方式。
- 更丰富的右键菜单：
  - 「复制完整路径」「在终端中打开」「发送到某个清理脚本」等。
- 历史快照：
  - 支持保存扫描结果，对比不同时间点的空间占用变化。

---

## 许可证

MIT
