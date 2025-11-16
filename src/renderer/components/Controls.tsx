import React from 'react';
import type { ScanOptions } from '../../shared/types';

interface Props {
  rootPath: string;
  setRootPath: (p: string) => void;
  includeHidden: boolean;
  setIncludeHidden: (b: boolean) => void;
  includeSystem: boolean;
  setIncludeSystem: (b: boolean) => void;
  onScan: () => void;
  onCancel: () => void;
  scanning: boolean;
  lastError?: string | null;
  progressText?: string | null;
}

const Controls: React.FC<Props> = ({
  rootPath,
  setRootPath,
  includeHidden,
  setIncludeHidden,
  includeSystem,
  setIncludeSystem,
  onScan,
  onCancel,
  scanning,
  lastError,
  progressText,
}) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="toolbar">
      <button
        className="toolbar-toggle-button"
        onClick={() => setOpen((v) => !v)}
        aria-label="图谱设置"
      >
        ⚙
      </button>
      {open && (
        <div className="toolbar-panel">
          <div className="toolbar-panel-section">
            <button
              className="primary-button"
              onClick={async () => {
                const res = await window.api.chooseDirectory();
                if (!res.canceled && res.filePaths[0]) setRootPath(res.filePaths[0]);
              }}
            >
              选择目录
            </button>
            <input
              type="text"
              placeholder="根目录路径"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
            />
          </div>
          <div className="toolbar-panel-section">
            <button
              type="button"
              className={`toggle-chip${includeHidden ? ' toggle-chip--active' : ''}`}
              onClick={() => {
                setIncludeHidden(!includeHidden);
              }}
            >
              包含隐藏
            </button>

            <button
              type="button"
              className={`toggle-chip${includeSystem ? ' toggle-chip--active' : ''}`}
              onClick={() => {
                setIncludeSystem(!includeSystem);
              }}
            >
              包含系统目录
            </button>
          </div>
          <div className="toolbar-panel-section">
            <button
              className="primary-button"
              disabled={!rootPath || scanning}
              onClick={() => {
                onScan();
                setOpen(false);
              }}
            >
              {scanning ? '扫描中…' : '开始扫描'}
            </button>
            {scanning && (
              <button className="ghost-button" onClick={onCancel}>
                取消
              </button>
            )}
            <div className="toolbar-panel-meta">
              {lastError ? (
                <span style={{ color: 'var(--danger)' }}>{lastError}</span>
              ) : progressText ? (
                <span>{progressText}</span>
              ) : (
                <span>就绪</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Controls;
