import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { ScanResult, FolderStats, FileStats, FileTypeGroup } from '../../shared/types';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { useDebounced } from '../hooks/useDebounced';
import { GROUP_COLORS } from '../utils/colors';
import { formatBytes, formatNumber } from '../utils/format';

type Props = {
  data?: ScanResult | null;
  selectedId?: string | null;
  setSelectedId: (id: string | null) => void;
  trashSet: Set<string>; // ignored in brutalist mode
  toggleTrash: (id: string) => void; // ignored in brutalist mode
  includeFiles?: boolean;
};

type TreeNode = FolderStats & { children?: TreeNode[] };

function toTree(result: ScanResult | null | undefined, includeFiles: boolean): TreeNode | null {
  if (!result) return null;
  const byId = new Map<string, FolderStats>();
  for (const f of result.folders) byId.set(f.id, f);
  const root =
    result.folders.find((f) => f.path === result.rootPath && f.depth === 0) ||
    result.folders.reduce((a, b) => (a.depth < b.depth ? a : b));
  const filesByParent = new Map<string, FileStats[]>();
  if (includeFiles && Array.isArray(result.files)) {
    for (const fi of result.files) {
      const arr = filesByParent.get(fi.parentId) || [];
      arr.push(fi);
      filesByParent.set(fi.parentId, arr);
    }
  }
  function build(node: FolderStats): TreeNode {
    const children = node.childrenIds.map((cid) => build(byId.get(cid)!));
    const childrenTotalSize = children.reduce((acc, c) => acc + c.totalSize, 0);
    const childrenFileCount = children.reduce((acc, c) => acc + c.fileCount, 0);
    const directSize = Math.max(0, node.totalSize - childrenTotalSize);
    const directCount = Math.max(0, node.fileCount - childrenFileCount);
    const childTb: Partial<Record<string, { size: number; count: number }>> = {};
    for (const c of children) {
      for (const [k, v] of Object.entries(c.typeBreakdown)) {
        const cur = childTb[k] || { size: 0, count: 0 };
        cur.size += v.size || 0;
        cur.count += v.count || 0;
        childTb[k] = cur;
      }
    }
    const directTb: any = {};
    for (const [k, v] of Object.entries(node.typeBreakdown)) {
      const used = childTb[k] || { size: 0, count: 0 };
      const size = Math.max(0, (v?.size || 0) - (used.size || 0));
      const count = Math.max(0, (v?.count || 0) - (used.count || 0));
      if (size > 0 || count > 0) directTb[k] = { size, count };
    }
    const syntheticChildren: TreeNode[] = [...children];
    if (includeFiles) {
      const fileList = filesByParent.get(node.id) || [];
      for (const fi of fileList) {
        const leaf = {
          id: fi.id,
          path: fi.path,
          name: fi.name,
          depth: fi.depth,
          totalSize: (fi as any).size ?? 0,
          fileCount: 1,
          subfolderCount: 0,
          typeBreakdown: {},
          childrenIds: [],
          // marker for styling
          isFile: true,
          fileType: (fi as any).type,
        } as any as TreeNode;
        syntheticChildren.push(leaf);
      }
    } else if (directSize > 0) {
      syntheticChildren.push({
        id: node.id + ':files',
        path: node.path + pathSep('[files]'),
        name: '(files)',
        depth: node.depth + 1,
        totalSize: directSize,
        fileCount: directCount,
        subfolderCount: 0,
        typeBreakdown: directTb,
        childrenIds: [],
      } as TreeNode);
    }
    return { ...(node as any), children: syntheticChildren } as TreeNode;
  }
  return build(root);
}

function pathSep(name: string) {
  return (navigator?.platform || '').toLowerCase().includes('win') ? '\\' + name : '/' + name;
}

function findSubtree(root: TreeNode | null, id: string | null): TreeNode | null {
  if (!root || !id) return root;
  let found: TreeNode | null = null;
  const dfs = (n: TreeNode) => {
    if (n.id === id) {
      found = n;
      return;
    }
    for (const c of n.children || []) if (!found) dfs(c);
  };
  dfs(root);
  return found || root;
}

function getPath(root: TreeNode, targetId: string): TreeNode[] {
  const path: TreeNode[] = [];
  let ok = false;
  function dfs(n: TreeNode): boolean {
    path.push(n);
    if (n.id === targetId) return (ok = true);
    for (const c of n.children || []) if (dfs(c)) return true;
    path.pop();
    return false;
  }
  dfs(root);
  return ok ? path : [root];
}

// warm-toned circle packing layout for disk usage
const ConstellationGraph: React.FC<Props> = ({ data, selectedId, setSelectedId, includeFiles = false }) => {
  const { ref, size } = useResizeObserver<HTMLDivElement>();
  const debSize = useDebounced(size, 120);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [showZoomHint, setShowZoomHint] = useState(false);
  const zoomHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    isFile: boolean;
    name: string;
  } | null>(null);
  const tree = useMemo(() => toTree(data, includeFiles), [data, includeFiles]);
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => setFocusId(null), [tree?.id]);

  const focusTree = useMemo(() => findSubtree(tree, focusId), [tree, focusId]);

  // Determine drill level: 0 = initial, 1 = first drill, 2+ = deeper
  const level = useMemo(() => {
    if (!tree) return 0;
    if (!focusId) return 0;
    return Math.max(0, getPath(tree, focusId).length - 1);
  }, [tree, focusId]);

  const nodes = useMemo(() => {
    if (!focusTree) return [] as d3.HierarchyCircularNode<TreeNode>[];
    const root = d3
      .hierarchy<TreeNode>(focusTree)
      .sum((d) => d.totalSize)
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    const pack = d3.pack<TreeNode>().size([debSize.width, debSize.height]).padding(18);
    return pack(root).descendants();
  }, [focusTree, debSize.width, debSize.height]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!nodes.length) return;
    const container = svg.append('g').attr('data-layer', 'graph-root');
    const g = container.append('g').attr('data-layer', 'graph');

    const levelNodes = nodes.filter((d) => d.depth === 1);
    const drawNodes = levelNodes.length > 0 ? levelNodes : nodes.filter((d) => d.depth === 0);

    const rootTotalSize = tree?.totalSize || focusTree?.totalSize || 0;
    const focusTotalSize = focusTree?.totalSize || rootTotalSize;
    const ratio = rootTotalSize > 0 ? focusTotalSize / rootTotalSize : 1;
    const clamped = Math.max(0, Math.min(1, ratio));
    const weight = Math.sqrt(clamped);
    const minScale = 0.25;
    const radiusScale = minScale + (1 - minScale) * weight;

    const minZoom = 0.2;
    const maxZoom = 8;
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([minZoom, maxZoom])
      .on('zoom', (event: any) => {
        container.attr('transform', event.transform);
        const k = event.transform?.k ?? 1;
        const clampedK = Math.max(minZoom, Math.min(maxZoom, k));
        setZoomScale(clampedK);
      });
    zoomBehaviorRef.current = zoom;
    svg.call(zoom as any);
    svg.call(zoom.transform as any, d3.zoomIdentity);

    const nodeSel = g
      .selectAll('g.node')
      .data(drawNodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .style('cursor', (d) => ((d.data as any).isFile === true ? 'default' : 'pointer'))
      .on('mouseenter', function (_, d) {
        showTooltip(d);
        const circle = d3.select(this).select('circle.fill-disk');
        const baseFill = circle.attr('data-fill');
        const c = d3.color(baseFill || '#4D5664');
        const lighter = d3.hsl(c as any).brighter(0.8).formatHex();
        d3.select(this).transition().duration(120).attr('transform', `translate(${d.x},${d.y}) scale(1.04)`);
        circle.transition().duration(120).attr('fill', lighter);
      })
      .on('mousemove', (event) => moveTooltip(event))
      .on('mouseleave', function (_, d) {
        hideTooltip();
        const circle = d3.select(this).select('circle.fill-disk');
        const baseFill = circle.attr('data-fill');
        d3.select(this).transition().duration(120).attr('transform', `translate(${d.x},${d.y}) scale(1)`);
        circle.transition().duration(120).attr('fill', baseFill || '#4D5664');
      })
      .on('click', (event: any, d) => {
        if (event?.detail && event.detail > 1) {
          return;
        }
        const dd: any = d.data as any;
        const isFile = dd.isFile === true;
        if (isFile) return;
        setSelectedId(dd.id);
        setFocusId(dd.id);
      })
      .on('contextmenu', (event: any, d) => {
        event.preventDefault();
        const dd: any = d.data as any;
        const path = dd.path as string | undefined;
        if (!path) return;
        const isFile = dd.isFile === true;
        const isSynthetic = typeof dd.id === 'string' && dd.id.endsWith(':files');
        if (isSynthetic) return;
        const name = String(dd.name || '');
        const margin = 8;
        const menuWidth = 240;
        const menuHeight = 90;
        let x = event.clientX as number;
        let y = event.clientY as number;
        if (typeof window !== 'undefined') {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          if (x + menuWidth > vw - margin) x = Math.max(margin, vw - margin - menuWidth);
          if (y + menuHeight > vh - margin) y = Math.max(margin, vh - margin - menuHeight);
        }
        setContextMenu({ x, y, path, isFile, name });
      });

    // Fill disk: shrink by stroke width so ring不会侵入内侧
    nodeSel
      .append('circle')
      .attr('class', 'fill-disk')
      .attr('r', (d) => Math.max(0, d.r * radiusScale - 1))
      .attr('fill', (d) => {
        const dd: any = d.data as any;
        const color = getWarmFill(dd, level);
        return color;
      })
      .attr('data-fill', (d) => getWarmFill(d.data as any, level))
      .attr('stroke', 'none')
      .style('shape-rendering', 'geometricPrecision');

    // Outer stroke ring: only stroke，避免出现内侧黑边
    nodeSel
      .append('circle')
      .attr('class', 'stroke-ring')
      .attr('r', (d) => {
        const isFile = (d.data as any).isFile === true;
        const inset = isFile ? 0.5 : d.depth === 0 ? 1.5 : 1;
        return Math.max(0, d.r * radiusScale - inset);
      })
      .attr('fill', 'none')
      .attr('stroke', 'rgba(0,0,0,0.35)')
      .attr('vector-effect', 'non-scaling-stroke')
      .style('shape-rendering', 'geometricPrecision')
      .attr('stroke-width', (d) => 1.25)
      .attr('data-base-stroke', () => 1.25);

    // Overlay labels: draw after all nodes so父级文字不会被子圆覆盖
    const labels = container.append('g').attr('data-layer', 'labels');
    labels
      .selectAll('text')
      .data(drawNodes.filter((d) => d.r * radiusScale > 18))
      .enter()
      .append('text')
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#EAEFF5')
      .style('font-weight', 600)
      .style('font-size', (d) => Math.max(10, Math.min(18, (d.r * radiusScale) / 4.2)) + 'px')
      .style('pointer-events', 'none')
      .text((d) => d.data.name);

    function showTooltip(d: d3.HierarchyCircularNode<TreeNode>) {
      const tip = tooltipRef.current!;
      tip.style.display = 'block';
      tip.innerHTML = renderTooltipHtml(d.data, focusTree?.totalSize || 0);
    }
    function moveTooltip(event: any) {
      const tip = tooltipRef.current!;
      tip.style.left = event.clientX + 12 + 'px';
      tip.style.top = event.clientY + 12 + 'px';
    }
    function hideTooltip() {
      const tip = tooltipRef.current!;
      tip.style.display = 'none';
    }
  }, [nodes, level, focusTree?.totalSize]);

  if (!data) return <div ref={ref} className="graph-container" />;

  const handleOpenInDefaultApp = async () => {
    if (!contextMenu) return;
    try {
      await window.api.openPath(contextMenu.path);
    } finally {
      setContextMenu(null);
    }
  };

  const handleRevealInFileManager = async () => {
    if (!contextMenu) return;
    try {
      await window.api.openFolder(contextMenu.path);
    } finally {
      setContextMenu(null);
    }
  };

  const handleZoomSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) return;
    const minZoom = 0.2;
    const maxZoom = 8;
    const targetScale = Math.max(minZoom, Math.min(maxZoom, value / 100));
    const svgSel = d3.select(svgRef.current);
    svgSel
      .transition()
      .duration(120)
      .call(zoomBehaviorRef.current.scaleTo as any, targetScale);
  };

  const handleZoomSliderPointerDown = () => {
    if (zoomHintTimeoutRef.current) {
      clearTimeout(zoomHintTimeoutRef.current);
    }
    setShowZoomHint(true);
    zoomHintTimeoutRef.current = setTimeout(() => {
      setShowZoomHint(false);
    }, 2600);
  };

  return (
    <div
      ref={ref}
      className="graph-container"
      onClick={() => {
        if (contextMenu) setContextMenu(null);
      }}
    >
      <svg ref={svgRef} width={debSize.width} height={debSize.height} />
      <div className="zoom-bar">
        {showZoomHint && (
          <span className="zoom-hint-line">滚轮缩放 · 双击放大 · 拖拽平移</span>
        )}
        <div className="zoom-bar-inner">
          <span className="zoom-bar-label">{Math.round(zoomScale * 100)}%</span>
          <input
            className="zoom-bar-range"
            type="range"
            min={20}
            max={800}
            value={Math.round(zoomScale * 100)}
            onChange={handleZoomSliderChange}
            onMouseDown={handleZoomSliderPointerDown}
            onTouchStart={handleZoomSliderPointerDown}
          />
        </div>
      </div>
      <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }} />
      {tree && (
        <div className="breadcrumbs">
          {getPath(tree, focusId || tree.id).map((n, i, arr) => (
            <React.Fragment key={n.id}>
              <span className="crumb" onClick={() => setFocusId(i === 0 ? null : n.id)}>
                {i === 0 ? n.path : n.name}
              </span>
              {i < arr.length - 1 && <span className="sep">›</span>}
            </React.Fragment>
          ))}
        </div>
      )}
      {contextMenu && (
        <div
          className="node-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="node-context-menu-title">{contextMenu.name}</div>
          <button
            type="button"
            className="node-context-menu-item"
            onClick={handleRevealInFileManager}
          >
            在文件管理器中打开
          </button>
          <button
            type="button"
            className="node-context-menu-item"
            onClick={handleOpenInDefaultApp}
          >
            用系统默认方式打开
          </button>
        </div>
      )}
    </div>
  );
};

function renderTooltipHtml(d: any, rootTotal: number) {
  const pct = rootTotal > 0 ? ((d.totalSize / rootTotal) * 100).toFixed(1) + '%' : '—';
  const isFile = d?.isFile === true || (!d.childrenIds && d.fileCount === 1 && d.subfolderCount === 0 && d.name && !d.name.includes('(files)'));
  if (isFile) {
    return `
      <div style="font-weight:700;letter-spacing:.2px;color:#EAEFF5">${d.name}</div>
      <div>大小：${formatBytes(d.totalSize)}（${pct}）</div>
      <div class=\"muted\" style=\"margin-top:6px;color:#4D5664\">路径：</div>
      <div style=\"white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px;color:#EAEFF5\">${d.path}</div>
    `;
  }
  return `
    <div style="font-weight:700;letter-spacing:.2px;color:#EAEFF5">${d.name}</div>
    <div>大小：${formatBytes(d.totalSize)}（${pct}）</div>
    <div>文件：${formatNumber(d.fileCount)} | 子文件夹：${d.subfolderCount}</div>
    <div class=\"muted\" style=\"margin-top:6px;color:#4D5664\">路径：</div>
    <div style=\"white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px;color:#EAEFF5\">${d.path}</div>
  `;
}

// Palette helpers
const BG_BLUES = ['#4D5664', '#4D5664', '#4D5664'];
const OTHERS_FILL = '#4D5664';
const ACCENT_USERS = '#F78A4A';
const ACCENT_WINDOWS = '#EFC657';
const ACCENT_PROGRAMS = '#20909C';

function getWarmFill(d: any, level: number): string {
  if (d.__isOthers) return OTHERS_FILL;
  // top-level highlights for common Windows roots
  const name = String(d.name || '').toLowerCase();
  if (level === 0) {
    if (name === 'users') return ACCENT_USERS;
    if (name === 'windows') return ACCENT_WINDOWS;
    if (name.startsWith('program files')) return ACCENT_PROGRAMS;
  }
  // files keep their type color for legibility if shown
  if (d.isFile && d.fileType) {
    const key = d.fileType as FileTypeGroup;
    return GROUP_COLORS[key] || BG_BLUES[2];
  }
  // default bluish-gray fill, pick by hash for slight variation
  const idx = Math.abs(hashCode(d.id || d.name || 'x')) % BG_BLUES.length;
  return BG_BLUES[idx];
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h | 0;
}

export default ConstellationGraph;
