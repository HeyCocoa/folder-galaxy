import React, { useMemo, useState } from 'react';
import Controls from './components/Controls';
import ConstellationGraph from './components/ConstellationGraph';
import type { ScanResult, ScanProgress } from '../shared/types';
import { formatBytes, formatNumber } from './utils/format';

const App: React.FC = () => {
  const [rootPath, setRootPath] = useState('');
  const [depth, setDepth] = useState(2);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [includeSystem, setIncludeSystem] = useState(false);
  const [includeFiles, setIncludeFiles] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trashSet, setTrashSet] = useState<Set<string>>(new Set());
  const [scanId, setScanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ text: string } | null>(null);

  const onScan = async () => {
    if (!rootPath) return;
    setScanning(true);
    setError(null);
    setResult(null);
    setProgress({ text: '准备扫描…' });
    try {
      const sid = (globalThis.crypto && 'randomUUID' in globalThis.crypto ? (globalThis.crypto as any).randomUUID() : Math.random().toString(36).slice(2)) as string;
      setScanId(sid);
      const unsub = window.api.onScanProgress((p: ScanProgress) => {
        if (p.scanId !== sid) return;
        if (p.phase === 'done' || p.phase === 'cancelled') {
          setProgress(p.phase === 'done' ? { text: '扫描完成' } : { text: '已取消' });
          unsub();
        } else {
          const secs = Math.max(1, Math.floor(p.elapsedMs / 1000));
          setProgress({ text: `扫描中… 文件 ${p.scannedFiles}｜目录 ${p.scannedDirs}｜${secs}s` });
        }
      });
      const res = await window.api.scanDirectory({ rootPath, maxDepth: depth, includeHidden, includeSystem, includeFiles, followSymlinks: false, scanId: sid });
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
        depth={depth}
        setDepth={setDepth}
        includeHidden={includeHidden}
        setIncludeHidden={setIncludeHidden}
        includeSystem={includeSystem}
        setIncludeSystem={setIncludeSystem}
        includeFiles={includeFiles}
        setIncludeFiles={setIncludeFiles}
        onScan={onScan}
        onCancel={onCancel}
        scanning={scanning}
        lastError={error}
        progress={progress}
      />
      <div className="content">
        {summary && <div style={{ padding: '6px 14px', color: 'var(--muted)', fontSize: 13 }}>{summary}</div>}
        <ConstellationGraph
          data={result}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          trashSet={trashSet}
          toggleTrash={(id) =>
            setTrashSet((prev) => new Set(prev.has(id) ? [...prev].filter((x) => x !== id) : [...prev, id]))
          }
          renderDepth={depth >= 2 ? 2 : 1}
          includeFiles={includeFiles}
        />
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
