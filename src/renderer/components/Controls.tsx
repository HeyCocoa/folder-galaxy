import React from 'react';
import type { ScanOptions } from '../../shared/types';

interface Props {
  rootPath: string;
  setRootPath: (p: string) => void;
  depth: number;
  setDepth: (d: number) => void;
  includeHidden: boolean;
  setIncludeHidden: (b: boolean) => void;
  onScan: () => void;
  scanning: boolean;
  lastError?: string | null;
}

const Controls: React.FC<Props> = ({
  rootPath,
  setRootPath,
  depth,
  setDepth,
  includeHidden,
  setIncludeHidden,
  onScan,
  scanning,
  lastError,
}) => {
  return (
    <div className="toolbar">
      <button onClick={async () => {
        const res = await window.api.chooseDirectory();
        if (!res.canceled && res.filePaths[0]) setRootPath(res.filePaths[0]);
      }}>选择目录</button>
      <input type="text" placeholder="根目录路径" value={rootPath} onChange={(e) => setRootPath(e.target.value)} />

      <label>深度</label>
      <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
        <option value={1}>1</option>
        <option value={2}>2</option>
        <option value={3}>3</option>
      </select>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} />
        包含隐藏
      </label>

      <button disabled={!rootPath || scanning} onClick={onScan}>{scanning ? '扫描中…' : '开始扫描'}</button>

      <div className="meta">
        {lastError ? <span style={{ color: 'var(--danger)' }}>{lastError}</span> : <span>就绪</span>}
      </div>
    </div>
  );
};

export default Controls;
