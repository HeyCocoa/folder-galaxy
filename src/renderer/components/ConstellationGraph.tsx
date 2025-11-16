import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { ScanResult, FolderStats, FileStats } from '../../shared/types';
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

// warm-toned circle packing layout for disk usage
const ConstellationGraph: React.FC<Props> = ({ data, selectedId, setSelectedId, renderDepth = 1, includeFiles = false }) => {
  const { ref, size } = useResizeObserver<HTMLDivElement>();
  const debSize = useDebounced(size, 120);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
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

  // Build a shallow (root + first-level only) hierarchy with Top N + Others aggregation
  type ShallowNode = TreeNode & { __isOthers?: boolean; __hasChildren?: boolean };

  function makeShallowWithTopN(rootIn: TreeNode): TreeNode {
    const N = level === 0 ? 6 : level === 1 ? 6 : 12;
    const minR = level === 0 ? 10 : level === 1 ? 8 : 5; // px

    const children = (rootIn.children || []) as ShallowNode[];

    // Sort by size and keep top N
    const sorted = [...children].sort((a, b) => b.totalSize - a.totalSize);
    const top = sorted.slice(0, N).map((n) => ({ ...n, __hasChildren: (n.children?.length || 0) > 0 }));
    const rest = sorted.slice(N);

    // Aggregate small children into "Others" node (size-only placeholder)
    const othersSize = rest.reduce((acc, n) => acc + n.totalSize, 0);
    const othersCount = rest.reduce((acc, n) => acc + n.fileCount, 0);
    const othersSub = rest.reduce((acc, n) => acc + n.subfolderCount, 0);
    const others: ShallowNode | null = othersSize > 0
      ? ({
          ...(rootIn as any),
          id: rootIn.id + ':others',
          path: rootIn.path + pathSep('(others)'),
          name: 'Others',
          depth: rootIn.depth + 1,
          totalSize: othersSize,
          fileCount: othersCount,
          subfolderCount: othersSub,
          typeBreakdown: {},
          childrenIds: [],
          children: [],
          __isOthers: true,
          __hasChildren: false,
        } as ShallowNode)
      : null;

    // First pass pack to evaluate radius threshold
    const shallowRoot: ShallowNode = { ...(rootIn as any), children: others ? [...top, others] : [...top] } as ShallowNode;
    const firstPacked = d3
      .pack<ShallowNode>()
      .size([debSize.width, debSize.height])
      .padding(6)(
        d3
          .hierarchy<ShallowNode>(shallowRoot)
          .sum((d) => d.totalSize)
          .sort((a, b) => (b.value || 0) - (a.value || 0))
      )
      .descendants();

    // Collect nodes under minR (depth=1 only, not Others) and fold into Others
    const smallIds = new Set<string>();
    let othersRef = othersSize > 0 ? others : null;
    for (const n of firstPacked) {
      if (n.depth === 1) {
        const dd = n.data as ShallowNode;
        if (!dd.__isOthers && n.r < minR) smallIds.add(dd.id);
      }
    }
    if (smallIds.size > 0) {
      const keep = top.filter((n) => !smallIds.has(n.id));
      const moved = top.filter((n) => smallIds.has(n.id));
      const movedSize = moved.reduce((a, b) => a + b.totalSize, 0);
      const movedFiles = moved.reduce((a, b) => a + b.fileCount, 0);
      const movedSubs = moved.reduce((a, b) => a + b.subfolderCount, 0);
      const finalOthers: ShallowNode | null = (othersRef || moved.length > 0)
        ? ({
            ...(rootIn as any),
            id: rootIn.id + ':others',
            path: rootIn.path + pathSep('(others)'),
            name: 'Others',
            depth: rootIn.depth + 1,
            totalSize: (othersRef?.totalSize || 0) + movedSize,
            fileCount: (othersRef?.fileCount || 0) + movedFiles,
            subfolderCount: (othersRef?.subfolderCount || 0) + movedSubs,
            typeBreakdown: {},
            childrenIds: [],
            children: [],
            __isOthers: true,
            __hasChildren: false,
          } as ShallowNode)
        : null;
      return { ...(rootIn as any), children: finalOthers ? [...keep, finalOthers] : [...keep] } as TreeNode;
    }
    return shallowRoot as TreeNode;
  }

  const nodes = useMemo(() => {
    if (!focusTree) return [] as d3.HierarchyCircularNode<TreeNode>[];
    // Only keep root + first-level children via Top N + Others
    const shallow = makeShallowWithTopN(focusTree);
    const root = d3
      .hierarchy<TreeNode>(shallow)
      .sum((d) => d.totalSize)
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    const pack = d3.pack<TreeNode>().size([debSize.width, debSize.height]).padding(6);
    return pack(root).descendants();
  }, [focusTree, debSize.width, debSize.height, level]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!nodes.length) return;
    const g = svg.append('g').attr('data-layer', 'graph');

    // Filter draw list
    // We only draw first-level circles (depth=1). If none exist (e.g., empty folder),
    // fall back to drawing the root so the user still sees something.
    const levelNodes = nodes.filter((d) => d.depth === 1);
    const drawNodes = levelNodes.length > 0 ? levelNodes : nodes.filter((d) => d.depth === 0);

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
        const circle = d3.select(this).select('circle.fill-disk');
        const baseFill = circle.attr('data-fill');
        const c = d3.color(baseFill || '#4D5664');
        const lighter = d3.hsl(c as any).brighter(0.8).formatHex();
        d3.select(this).transition().duration(120).attr('transform', `translate(${d.x},${d.y}) scale(1.04)`);
        circle.transition().duration(120).attr('fill', lighter);
      })
      .on('mousemove', (event, d) => moveTooltip(event, d))
      .on('mouseleave', function (_, d) {
        hideTooltip();
        const circle = d3.select(this).select('circle.fill-disk');
        const baseFill = circle.attr('data-fill');
        d3.select(this).transition().duration(120).attr('transform', `translate(${d.x},${d.y}) scale(1)`);
        circle.transition().duration(120).attr('fill', baseFill || '#4D5664');
      })
      .on('click', (_, d) => {
        const dd: any = d.data as any;
        if (!dd.__isOthers) setSelectedId(dd.id);
        const isFile = dd.isFile === true;
        if (isFile) {
          window.api.openFolder(dd.path);
        } else if (dd.__hasChildren && d.depth === 1) {
          setFocusId(dd.id);
        }
      });

    // Fill disk: shrink by stroke width so ring不会侵入内侧
    nodeSel
      .append('circle')
      .attr('class', 'fill-disk')
      .attr('r', (d) => Math.max(0, d.r - 1))
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
        return Math.max(0, d.r - inset);
      })
      .attr('fill', 'none')
      .attr('stroke', 'rgba(0,0,0,0.35)')
      .attr('vector-effect', 'non-scaling-stroke')
      .style('shape-rendering', 'geometricPrecision')
      .attr('stroke-width', (d) => 1.25)
      .attr('data-base-stroke', () => 1.25);

    // Overlay labels: draw after all nodes so父级文字不会被子圆覆盖
    const labels = svg.append('g').attr('data-layer', 'labels');
    labels
      .selectAll('text')
      .data(drawNodes.filter((d) => d.r > 18 && (d.data as any).isFile !== true))
      .enter()
      .append('text')
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#EAEFF5')
      .style('font-weight', 600)
      .style('font-size', (d) => Math.max(10, Math.min(18, d.r / 4.2)) + 'px')
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
  }, [nodes, renderDepth, level, focusTree?.totalSize]);

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
  if (d.isFile && d.fileType) return GROUP_COLORS[d.fileType] || BG_BLUES[2];
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
