import React, { useMemo, useState } from 'react';
import Controls from './components/Controls';
import ConstellationGraph from './components/ConstellationGraph';
import type { ScanResult, ScanProgress } from '../shared/types';
import { formatBytes, formatNumber } from './utils/format';

const MAX_SCAN_DEPTH = 128;

const App: React.FC = () => {
  const [rootPath, setRootPath] = useState('');
  const [includeHidden, setIncludeHidden] = useState(true);
  const [includeSystem, setIncludeSystem] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trashSet, setTrashSet] = useState<Set<string>>(new Set());
  const [scanId, setScanId] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [progressState, setProgressState] = useState<ScanProgress | null>(null);

  const onScan = async () => {
    if (!rootPath) return;
    setScanning(true);
    setError(null);
    setResult(null);
    setProgressText('准备扫描…');
    setProgressState(null);
    try {
      const sid = (globalThis.crypto && 'randomUUID' in globalThis.crypto ? (globalThis.crypto as any).randomUUID() : Math.random().toString(36).slice(2)) as string;
      setScanId(sid);
      const unsub = window.api.onScanProgress((p: ScanProgress) => {
        if (p.scanId !== sid) return;
        setProgressState(p);
        if (p.phase === 'done' || p.phase === 'cancelled') {
          setProgressText(p.phase === 'done' ? '扫描完成' : '已取消');
          unsub();
        } else {
          const secs = Math.max(1, Math.floor(p.elapsedMs / 1000));
          setProgressText(`扫描中… 文件 ${p.scannedFiles}｜目录 ${p.scannedDirs}｜${secs}s`);
        }
      });
      const res = await window.api.scanDirectory({
        rootPath,
        maxDepth: MAX_SCAN_DEPTH,
        includeHidden,
        includeSystem,
        includeFiles: true,
        followSymlinks: false,
        scanId: sid,
      });
      if (res.ok) {
        setResult(res.result);
        setSelectedId(null);
      } else {
        setError(res.error);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setScanning(false);
      setScanId(null);
    }
  };

  const onCancel = async () => {
    if (scanId) await window.api.cancelScan(scanId);
  };

  const summary = useMemo(() => {
    if (!result) return null;
    return `${result.rootPath} ｜ 大小 ${formatBytes(result.totalSize)} ｜ 文件 ${formatNumber(result.totalFileCount)} ｜ 生成于 ${new Date(result.generatedAt).toLocaleString()}`;
  }, [result]);

  return (
    <div className="app">
      <Controls
        rootPath={rootPath}
        setRootPath={setRootPath}
        includeHidden={includeHidden}
        setIncludeHidden={setIncludeHidden}
        includeSystem={includeSystem}
        setIncludeSystem={setIncludeSystem}
        onScan={onScan}
        onCancel={onCancel}
        scanning={scanning}
        lastError={error}
        progressText={progressText}
      />
      <div className="content">
        {summary && <div className="summary-bar">{summary}</div>}
        <ConstellationGraph
          data={result}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          trashSet={trashSet}
          toggleTrash={(id) =>
            setTrashSet((prev) => new Set(prev.has(id) ? [...prev].filter((x) => x !== id) : [...prev, id]))
          }
          includeFiles
        />
        {scanning && (
          <ScanOverlay progress={progressState} text={progressText} />
        )}
        {/* compact info panel */}
        {result && selectedId && (
          <InfoPanel root={result} selectedId={selectedId} />
        )}
      </div>
    </div>
  );
};

export default App;

// ——————————————————————————————————————
// Info panel (bottom-right) showing path/size/counts
const InfoPanel: React.FC<{ root: ScanResult; selectedId: string }> = ({ root, selectedId }) => {
  const folder = root.folders.find((f) => f.id === selectedId);
  const file = root.files?.find((fi) => fi.id === selectedId);
  const title = folder?.name || file?.name || 'Selected';
  const fullPath = folder?.path || file?.path || '';
  const size = folder ? folder.totalSize : file ? (file as any).size ?? 0 : 0;
  const folders = folder ? folder.subfolderCount : 0;
  const files = folder ? folder.fileCount : (file ? 1 : 0);
  return (
    <div className="info-panel">
      <div className="title">{title}</div>
      <div>大小：{formatBytes(size)}</div>
      <div>子项：{folders} folders, {files} files</div>
      <div className="muted" style={{ marginTop: 6 }}>路径：</div>
      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>{fullPath}</div>
    </div>
  );
};

const ScanOverlay: React.FC<{ progress: ScanProgress | null; text: string | null }> = ({ progress, text }) => {
  const baseText = text || '正在扫描…';
  const detail = progress && progress.phase !== 'done' && progress.phase !== 'cancelled'
    ? `文件 ${progress.scannedFiles}｜目录 ${progress.scannedDirs}｜${Math.max(1, Math.floor(progress.elapsedMs / 1000))}s`
    : null;
  return (
    <div className="scan-overlay">
      <div className="scan-overlay-card">
        <div className="scan-overlay-title">{baseText}</div>
        {detail && <div className="scan-overlay-sub">{detail}</div>}
        <div className="progress-track">
          <div className="progress-bar progress-bar--indeterminate" />
        </div>
      </div>
    </div>
  );
};
