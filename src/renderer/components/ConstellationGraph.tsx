import React, { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import type { ScanResult, FolderStats } from '../../shared/types';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { useDebounced } from '../hooks/useDebounced';
import { GROUP_COLORS, getPrimaryType } from '../utils/colors';
import { formatBytes, formatNumber } from '../utils/format';

type Props = {
  data?: ScanResult | null;
  selectedId?: string | null;
  setSelectedId: (id: string | null) => void;
  trashSet: Set<string>;
  toggleTrash: (id: string) => void;
  renderDepth?: number; // 1 仅一级；>=2 显示到二级
};

type TreeNode = FolderStats & { children?: TreeNode[] };

function toTree(result: ScanResult | null | undefined): TreeNode | null {
  if (!result) return null;
  const byId = new Map<string, FolderStats>();
  for (const f of result.folders) byId.set(f.id, f);
  // Find root: path equals rootPath and minimal depth
  const root = result.folders.find((f) => f.path === result.rootPath && f.depth === 0) || result.folders.reduce((a, b) => (a.depth < b.depth ? a : b));
  function build(node: FolderStats): TreeNode {
    // Build real children first
    const children = node.childrenIds.map((cid) => build(byId.get(cid)!));

    // Derive the size/count/typeBreakdown contributed by files directly under this folder
    const childrenTotalSize = children.reduce((acc, c) => acc + c.totalSize, 0);
    const childrenFileCount = children.reduce((acc, c) => acc + c.fileCount, 0);
    const directSize = Math.max(0, node.totalSize - childrenTotalSize);
    const directCount = Math.max(0, node.fileCount - childrenFileCount);

    // Compute direct-only type breakdown by subtracting children's breakdowns
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

    // Inject a synthetic child for direct files so that d3.pack leaf-sum equals parent total
    // This ensures depth 1 vs 2 visuals keep identical parent sizes.
    const syntheticChildren: TreeNode[] = [...children];
    if (directSize > 0) {
      const filesLeaf: TreeNode = {
        id: node.id + ':files',
        path: node.path + pathSep('[files]'),
        name: '(files)',
        depth: node.depth + 1,
        totalSize: directSize,
        fileCount: directCount,
        subfolderCount: 0,
        typeBreakdown: directTb,
        childrenIds: [],
      } as TreeNode;
      syntheticChildren.push(filesLeaf);
    }

    return { ...node, children: syntheticChildren } as TreeNode;
  }
  return build(root);
}

function pathSep(name: string) {
  // Keep tooltip path readable without importing Node path module into renderer
  return (navigator?.platform || '').toLowerCase().includes('win') ? '\\' + name : '/' + name;
}

const ConstellationGraph: React.FC<Props> = ({ data, selectedId, setSelectedId, trashSet, toggleTrash, renderDepth = 1 }) => {
  const { ref, size } = useResizeObserver<HTMLDivElement>();
  const debSize = useDebounced(size, 120);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const tree = useMemo(() => toTree(data), [data]);

  const nodes = useMemo(() => {
    if (!tree) return [] as d3.HierarchyCircularNode<TreeNode>[];
    const root = d3
      .hierarchy<TreeNode>(tree)
      .sum((d) => d.totalSize)
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    const pack = d3.pack<TreeNode>().size([debSize.width, debSize.height]).padding(4);
    const packed = pack(root);
    let result = packed.descendants();
    if (renderDepth <= 1) return result.filter((n) => n.depth === 1);
    result = result.filter((n) => n.depth === 1 || n.depth === 2);
    // 过滤与父节点几乎重合的二级节点，减少“重影”
    return result.filter((n) => {
      if (n.depth !== 2 || !n.parent) return n.depth === 1;
      const dx = n.x - (n.parent as any).x;
      const dy = n.y - (n.parent as any).y;
      const centerDist = Math.hypot(dx, dy);
      const rDiff = (n.parent as any).r - n.r;
      const nearSameCenter = centerDist < 1.5; // 基本同心
      const nearSameRadius = rDiff < Math.max(8, (n.parent as any).r * 0.08);
      const tooSmall = n.r < 3;
      const onlyChild = (n.parent.children?.length || 0) === 1;
      return !(nearSameCenter && nearSameRadius) && !tooSmall && !onlyChild;
    });
  }, [tree, debSize.width, debSize.height, renderDepth]);

  // 绘制场景（仅在 nodes 变化时重建，避免频繁闪烁）
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!nodes.length) return;

    const g = svg.append('g').attr('data-layer', 'graph');
    g
      .selectAll('circle')
      .data(nodes)
      .enter()
      .append('circle')
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', (d) => d.r)
      .attr('fill', (d) => GROUP_COLORS[getPrimaryType(d.data)])
      .attr('fill-opacity', (d) => (d.depth === 1 ? 0.85 : 0.55))
      .attr('stroke', '#2b3b66')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mouseenter', (_, d) => showTooltip(d))
      .on('mousemove', (event, d) => moveTooltip(event, d))
      .on('mouseleave', hideTooltip)
      .on('click', async (_, d) => {
        setSelectedId(d.data.id);
        await window.api.openFolder(d.data.path);
      })
      .on('contextmenu', (event, d) => {
        event.preventDefault();
        toggleTrash(d.data.id);
      });

    // Labels for depth 1 nodes
    g.selectAll('text')
      .data(nodes.filter((d) => d.depth === 1))
      .enter()
      .append('text')
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#dbe4ff')
      .style('font-size', (d) => Math.max(10, Math.min(18, d.r / 5)) + 'px')
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
  }, [nodes]);

  // 单独更新交互态描边，避免整图重绘导致闪烁
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg
      .selectAll('circle')
      .attr('stroke', (n: any) => (trashSet.has(n.data.id) ? 'var(--danger)' : selectedId === n.data.id ? '#ffffff' : '#2b3b66'))
      .attr('stroke-width', (n: any) => (selectedId === n.data.id || trashSet.has(n.data.id) ? 2 : 1));
  }, [selectedId, trashSet]);

  if (!data) return <div ref={ref} className="graph-container" />;

  return (
    <div ref={ref} className="graph-container">
      <svg ref={svgRef} width={debSize.width} height={debSize.height} />
      <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }} />
    </div>
  );
};

function renderTooltipHtml(d: FolderStats) {
  const primary = getPrimaryType(d);
  const breakdown = Object.entries(d.typeBreakdown)
    .sort((a, b) => (b[1].size - a[1].size))
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${formatBytes(v.size)} (${formatNumber(v.count)})`)
    .join('<br/>');
  return `
    <div><strong>${d.name}</strong></div>
    <div>大小：${formatBytes(d.totalSize)}</div>
    <div>文件：${formatNumber(d.fileCount)} | 子文件夹：${d.subfolderCount}</div>
    <div>主类型：${primary}</div>
    <div style="margin-top:6px;color:#9bb0c7">Top 类型：</div>
    <div>${breakdown || '—'}</div>
    <div style="margin-top:6px;color:#9bb0c7">路径：</div>
    <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px">${d.path}</div>
  `;
}

export default ConstellationGraph;
