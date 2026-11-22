#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -d "${NVM_DIR}/versions/node" ]; then
  LATEST_NVM_NODE="$(ls -1 "${NVM_DIR}/versions/node" 2>/dev/null | sort | tail -n 1 || true)"
  if [ -n "${LATEST_NVM_NODE}" ] && [ -d "${NVM_DIR}/versions/node/${LATEST_NVM_NODE}/bin" ]; then
    export PATH="${NVM_DIR}/versions/node/${LATEST_NVM_NODE}/bin:${PATH}"
  fi
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js，请先安装 Node.js 22.4 或更高版本: https://nodejs.org/"
  read -r -p "按回车键退出..."
  exit 1
fi

node cli.js auto-watch on
echo ""
read -r -p "操作完成，按回车键关闭窗口..."
