#!/usr/bin/env bash
set -euo pipefail

msg=$(cat)

if printf %s "$msg" | grep -q "^feat(scanner,ipc): add concurrent scanning"; then
  printf %s "feat(scanner,ipc): 并发扫描、进度事件、取消支持；默认排除 Windows 系统目录；用软限制替代硬文件上限"
elif printf %s "$msg" | grep -q "^chore(main): hide native menu bar"; then
  printf %s "chore(main): 隐藏原生菜单栏并移除默认菜单（保留 macOS 常用快捷）"
elif printf %s "$msg" | grep -q "^fix(renderer): keep folder sizes consistent across depths"; then
  printf %s "fix(renderer): 通过注入合成 '(files)' 叶子保持不同深度下的文件夹大小一致（d3.pack）"
elif printf %s "$msg" | grep -qx "feat: initial project import"; then
  printf %s "feat: 导入项目初始代码"
elif printf %s "$msg" | grep -qx "Initial commit"; then
  printf %s "初始提交"
else
  printf %s "$msg"
fi

