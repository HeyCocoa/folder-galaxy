import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { ScanResult, FolderStats, FileStats } from '../../shared/types';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { useDebounced } from '../hooks/useDebounced';
import { GROUP_COLORS, getPrimaryType } from '../utils/colors';
import { formatBytes, formatNumber } from '../utils/format';

type Props = {
  data?: ScanResult | null;
  selectedId?: string | null;
  setSelectedId: (id: string | null) => void;
  trashSet: Set<string>; // ignored in brutalist mode
  toggleTrash: (id: string) => void; // ignored in brutalist mode
  renderDepth?: number; // brutalist mode renders full subtree
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

const ConstellationGraph: React.FC<Props> = ({ data, selectedId, setSelectedId, renderDepth = 1, includeFiles = false }) => {
  const { ref, size } = useResizeObserver<HTMLDivElement>();
  const debSize = useDebounced(size, 120);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tree = useMemo(() => toTree(data, includeFiles), [data, includeFiles]);
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => setFocusId(null), [tree?.id]);

  const focusTree = useMemo(() => findSubtree(tree, focusId), [tree, focusId]);

  const nodes = useMemo(() => {
    if (!focusTree) return [] as d3.HierarchyCircularNode<TreeNode>[];
    const root = d3
      .hierarchy<TreeNode>(focusTree)
      .sum((d) => d.totalSize)
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    const pack = d3.pack<TreeNode>().size([debSize.width, debSize.height]).padding(4);
    return pack(root).descendants();
  }, [focusTree, debSize.width, debSize.height]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!nodes.length) return;
    const g = svg.append('g').attr('data-layer', 'graph');

    // Filter draw list
    const drawNodes = nodes.filter((d) => {
      const isSyntheticFiles = String(d.data.id).endsWith(':files');
      if (isSyntheticFiles) return false;
      if (d.depth === 0) return false; // hide root circle
      const isFile = (d.data as any).isFile === true;
      if (!isFile) return d.depth <= renderDepth;
      // files: visible when their parent depth < renderDepth (i.e., within shown folder layer)
      const parentDepth = d.parent?.depth ?? 0;
      return parentDepth < renderDepth;
    });

    const nodeSel = g
      .selectAll('g.node')
      .data(drawNodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer')
      .on('mouseenter', function (_, d) {
        showTooltip(d);
        const circle = d3.select(this).select('circle.stroke-ring');
        const base = Number(circle.attr('data-base-stroke')) || 2;
        d3.select(this).transition().duration(100).attr('transform', `translate(${d.x},${d.y}) scale(1.05)`);
        circle.transition().duration(100).attr('stroke-width', base + 1);
      })
      .on('mousemove', (event, d) => moveTooltip(event, d))
      .on('mouseleave', function (_, d) {
        hideTooltip();
        const circle = d3.select(this).select('circle.stroke-ring');
        const base = Number(circle.attr('data-base-stroke')) || 2;
        d3.select(this).transition().duration(100).attr('transform', `translate(${d.x},${d.y}) scale(1)`);
        circle.transition().duration(100).attr('stroke-width', base);
      })
      .on('click', (_, d) => {
        setSelectedId(d.data.id);
        const isFile = (d.data as any).isFile === true;
        if (isFile) {
          // 打开文件而不进入“子树”
          window.api.openFolder(d.data.path);
        } else {
          setFocusId(d.data.id);
        }
      });

    // Fill disk: shrink by stroke width so ring不会侵入内侧
    nodeSel
      .append('circle')
      .attr('class', 'fill-disk')
      .attr('r', (d) => {
        const isFile = (d.data as any).isFile === true;
        const sw = isFile ? 1 : d.depth === 0 ? 3 : 2;
        return Math.max(0, d.r - sw);
      })
      .attr('fill', (d) => {
        const dd: any = d.data as any;
        if (dd.isFile) return GROUP_COLORS[dd.fileType || 'other'];
        return GROUP_COLORS[getPrimaryType(dd)];
      })
      .attr('stroke', 'none')
      .style('shape-rendering', 'geometricPrecision');

    // Outer stroke ring: only stroke，避免出现内侧黑边
    nodeSel
      .append('circle')
      .attr('class', 'stroke-ring')
      .attr('r', (d) => {
        const isFile = (d.data as any).isFile === true;
        const inset = isFile ? 0.5 : d.depth === 0 ? 1.5 : 1;
        return Math.max(0, d.r - inset);
      })
      .attr('fill', 'none')
      .attr('stroke', '#000')
      .attr('vector-effect', 'non-scaling-stroke')
      .style('shape-rendering', 'geometricPrecision')
      .attr('stroke-width', (d) => ((d.data as any).isFile === true ? 1 : d.depth === 0 ? 3 : 2))
      .attr('data-base-stroke', (d) => ((d.data as any).isFile === true ? 1 : d.depth === 0 ? 3 : 2));

    // Overlay labels: draw after all nodes so父级文字不会被子圆覆盖
    const labels = svg.append('g').attr('data-layer', 'labels');
    labels
      .selectAll('text')
      .data(drawNodes.filter((d) => d.depth === 1 && d.r > 18 && (d.data as any).isFile !== true))
      .enter()
      .append('text')
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#000')
      .style('font-weight', 700)
      .style('font-size', (d) => Math.max(10, Math.min(18, d.r / 4.2)) + 'px')
      .style('pointer-events', 'none')
      .text((d) => d.data.name);

    function showTooltip(d: d3.HierarchyCircularNode<TreeNode>) {
      const tip = tooltipRef.current!;
      tip.style.display = 'block';
      tip.innerHTML = renderTooltipHtml(d.data);
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
  }, [nodes, renderDepth]);

  if (!data) return <div ref={ref} className="graph-container" />;

  return (
    <div ref={ref} className="graph-container">
      <svg ref={svgRef} width={debSize.width} height={debSize.height} />
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
    </div>
  );
};

function renderTooltipHtml(d: any) {
  const isFile = d?.isFile === true || (!d.childrenIds && d.fileCount === 1 && d.subfolderCount === 0 && d.name && !d.name.includes('(files)'));
  if (isFile) {
    return `
      <div style="font-weight:700;letter-spacing:.2px;color:#000">${d.name}</div>
      <div>大小：${formatBytes(d.totalSize)}</div>
      <div style=\"margin-top:6px;color:#333\">路径：</div>
      <div style=\"white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px\">${d.path}</div>
    `;
  }
  const primary = getPrimaryType(d);
  const breakdown = Object.entries(d.typeBreakdown)
    .sort((a: any, b: any) => b[1].size - a[1].size)
    .slice(0, 3)
    .map(([k, v]: any) => `${k}: ${formatBytes(v.size)} (${formatNumber(v.count)})`)
    .join('<br/>');
  return `
    <div style="font-weight:700;letter-spacing:.2px;color:#000">${d.name}</div>
    <div>大小：${formatBytes(d.totalSize)}</div>
    <div>文件：${formatNumber(d.fileCount)} | 子文件夹：${d.subfolderCount}</div>
    <div>主类型：${primary}</div>
    <div style=\"margin-top:6px;color:#333\">Top 类型：</div>
    <div>${breakdown || '—'}</div>
    <div style=\"margin-top:6px;color:#333\">路径：</div>
    <div style=\"white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px\">${d.path}</div>
  `;
}

export default ConstellationGraph;
