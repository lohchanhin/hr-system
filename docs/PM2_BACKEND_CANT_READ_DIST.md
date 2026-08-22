# 後端無法讀取前端檔案診斷指南

## 問題描述

您的情況：
- ✅ 前端已經建置（`npm run build` 完成）
- ✅ `client/dist/` 目錄存在
- ✅ 後端正常運行（MongoDB 連接，PM2 online）
- ❌ 瀏覽器仍然看不到前端

**診斷：後端無法正確讀取前端檔案**

## 可能原因

### 1. PM2 工作目錄問題（最常見）

PM2 可能從錯誤的目錄啟動，導致相對路徑計算錯誤。

### 2. 路徑解析問題

ES Module 的 `__dirname` 計算可能在某些環境下有問題。

### 3. 檔案權限問題

`client/dist/` 檔案可能存在但無法被讀取。

### 4. 符號連結問題

如果專案路徑中有符號連結，可能導致路徑解析錯誤。

## 立即診斷步驟

### 步驟 1：執行後端診斷腳本

在**專案根目錄**執行：

```bash
cd /path/to/hr-system  # 確保在專案根目錄

cat > backend_debug.sh << 'EOFSCRIPT'
#!/bin/bash
echo "=== 後端靜態檔案服務診斷 ==="
echo ""

echo "1. 當前工作目錄"
pwd
echo ""

echo "2. PM2 進程資訊"
pm2 describe hr-system 2>/dev/null | grep -E "(cwd|exec cwd|script)" || echo "無法取得 PM2 資訊"
echo ""

echo "3. 檢查 client/dist/ 是否存在"
if [ -d "client/dist" ]; then
  echo "✅ client/dist/ 存在（從當前目錄）"
  echo "檔案列表："
  ls -lh client/dist/ | head -10
  echo ""
  
  if [ -f "client/dist/index.html" ]; then
    echo "✅ index.html 存在"
    echo "大小: $(du -h client/dist/index.html | cut -f1)"
    echo "權限: $(ls -l client/dist/index.html | cut -d' ' -f1)"
  else
    echo "❌ index.html 不存在！"
  fi
else
  echo "❌ client/dist/ 不存在（從當前目錄）"
fi
echo ""

echo "4. 搜尋所有 dist 目錄"
find . -type d -name "dist" -path "*/client/*" 2>/dev/null
echo ""

echo "5. 測試 HTTP 訪問"
echo "API 健康檢查："
curl -s http://localhost:3000/api/health
echo ""
echo ""

echo "前端首頁（HTTP 狀態）："
curl -I http://localhost:3000/ 2>&1 | grep -E "HTTP|Content-Type"
echo ""

echo "前端首頁（內容檢查）："
RESPONSE=$(curl -s http://localhost:3000/)
if echo "$RESPONSE" | grep -q "<!DOCTYPE html>"; then
  echo "✅ 返回 HTML 內容"
  echo "內容長度: $(echo "$RESPONSE" | wc -c) bytes"
elif echo "$RESPONSE" | grep -q "Cannot GET"; then
  echo "❌ 返回 'Cannot GET /' 錯誤"
  echo "這表示 express.static 沒有生效或路徑錯誤"
else
  echo "⚠️  返回非預期內容："
  echo "$RESPONSE" | head -3
fi
echo ""

echo "6. PM2 日誌（最後 20 行）"
pm2 logs hr-system --nostream --lines 20 2>/dev/null || echo "無法讀取日誌"
echo ""

echo "7. 檢查 Node 進程的工作目錄"
NODE_PID=$(pgrep -f "node.*server/src/index.js" | head -1)
if [ -n "$NODE_PID" ]; then
  echo "Node PID: $NODE_PID"
  echo "工作目錄: $(pwdx $NODE_PID 2>/dev/null || readlink -f /proc/$NODE_PID/cwd 2>/dev/null || echo '無法取得')"
else
  echo "找不到 Node 進程"
fi
echo ""

echo "=== 診斷完成 ==="
echo ""
echo "請將以上完整輸出提供給支援團隊"
EOFSCRIPT

chmod +x backend_debug.sh
./backend_debug.sh
```

### 步驟 2：根據診斷結果判斷

#### 情況 A：顯示「client/dist/ 不存在（從當前目錄）」

**原因：** PM2 啟動時的工作目錄不正確

**解決方法 1：明確設定 PM2 工作目錄**

編輯 `ecosystem.config.cjs`：

```javascript
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'hr-system',
      script: './server/src/index.js',
      cwd: __dirname,  // 👈 新增這一行！強制設定工作目錄為專案根目錄
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      // ... 其他設定
    },
  ],
};
```

然後重啟：
```bash
npm run pm2:delete
npm run pm2:start
```

**解決方法 2：使用絕對路徑**

如果方法 1 無效，修改 `server/src/index.js`：

```javascript
// 原本的相對路徑（第 58 行）
// const distPath = path.join(__dirname, '..', '..', 'client', 'dist');

// 改為使用絕對路徑
const projectRoot = path.resolve(__dirname, '..', '..');
const distPath = path.join(projectRoot, 'client', 'dist');

// 加入除錯日誌（啟動時會顯示）
console.log('[Debug] Project root:', projectRoot);
console.log('[Debug] distPath:', distPath);
console.log('[Debug] distPath exists:', require('fs').existsSync(distPath));
```

#### 情況 B：dist 存在但返回「Cannot GET /」

**原因：** `express.static` 沒有正確設定或被其他路由覆蓋

**檢查：** 確認 `server/src/index.js` 的路由順序：

```javascript
// 正確的順序：
app.use(express.static(distPath));  // ✅ 應該在所有 API 路由之前

app.get('/api/health', ...);        // API 路由
app.use('/api/employees', ...);
// ... 其他 API 路由

app.get('*', (req, res, next) => {  // ✅ Catch-all 路由應該在最後
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});
```

#### 情況 C：權限問題

**檢查權限：**
```bash
ls -la client/dist/
```

**修正權限：**
```bash
chmod -R 755 client/dist/
```

#### 情況 D：Node 進程的工作目錄錯誤

**診斷腳本會顯示 Node 進程的實際工作目錄。** 如果它不是專案根目錄，需要：

1. 停止 PM2：`npm run pm2:stop`
2. 確保在專案根目錄執行：`cd /path/to/hr-system && pwd`
3. 重新啟動：`npm run pm2:start`

## 快速修復方案

### 方案 1：加入 cwd 到 PM2 設定（推薦）

```bash
# 1. 編輯 ecosystem.config.cjs
nano ecosystem.config.cjs

# 在 apps[0] 中加入 cwd: __dirname

# 2. 重新啟動
npm run pm2:delete
npm run pm2:start
```

### 方案 2：加入除錯日誌

在 `server/src/index.js` 第 58 行後加入：

```javascript
const distPath = path.join(__dirname, '..', '..', 'client', 'dist');

// 👇 加入這些除錯日誌
console.log('=== Static Files Configuration ===');
console.log('__dirname:', __dirname);
console.log('distPath:', distPath);
console.log('distPath exists:', require('fs').existsSync(distPath));
if (require('fs').existsSync(distPath)) {
  const files = require('fs').readdirSync(distPath);
  console.log('Files in dist:', files.slice(0, 5).join(', '));
}
console.log('===================================');
```

然後：
```bash
npm run pm2:restart
npm run pm2:logs
```

查看日誌輸出，確認 `distPath` 是否正確。

### 方案 3：直接測試（不用 PM2）

```bash
# 停止 PM2
npm run pm2:stop

# 直接執行後端（用於測試）
cd /path/to/hr-system
node server/src/index.js

# 在另一個終端測試
curl http://localhost:3000/
```

如果直接執行可以，但 PM2 不行，就確定是 PM2 工作目錄問題。

## 手動驗證檢查清單

### ✅ 前端檢查

```bash
# 1. 檔案存在
[ -f client/dist/index.html ] && echo "✅ index.html 存在" || echo "❌ 不存在"

# 2. 檔案可讀
[ -r client/dist/index.html ] && echo "✅ 可讀取" || echo "❌ 無法讀取"

# 3. 檔案大小正常
SIZE=$(wc -c < client/dist/index.html 2>/dev/null || echo 0)
[ $SIZE -gt 100 ] && echo "✅ 檔案大小正常 ($SIZE bytes)" || echo "❌ 檔案太小"

# 4. 內容正確
grep -q "<!DOCTYPE html>" client/dist/index.html && echo "✅ HTML 內容正確" || echo "❌ 內容異常"
```

### ✅ 後端檢查

```bash
# 1. PM2 狀態
pm2 status | grep hr-system

# 2. 監聽 port
ss -tln | grep :3000 || netstat -tln | grep :3000

# 3. API 正常
curl -s http://localhost:3000/api/health

# 4. 靜態檔案
curl -I http://localhost:3000/ | grep "HTTP"
```

## 最有可能的解決方案

根據經驗，最常見的原因是 **PM2 工作目錄問題**。請執行：

```bash
# 停止 PM2
npm run pm2:stop

# 確保在專案根目錄
cd /path/to/hr-system
pwd  # 確認路徑正確

# 檢查 dist 從這裡是否可見
ls client/dist/index.html

# 重新啟動 PM2
npm run pm2:start

# 立即查看日誌
npm run pm2:logs
```

如果還是不行，**修改 `ecosystem.config.cjs` 加入 `cwd: __dirname`**，這會強制 PM2 使用正確的工作目錄。

## 臨時解決方案（測試用）

如果急需讓系統運作，可以暫時使用絕對路徑：

在 `server/src/index.js` 中：

```javascript
// 暫時寫死絕對路徑（僅供測試）
const distPath = '/home/youruser/hr-system/client/dist';
// 或
const distPath = process.env.DIST_PATH || path.join(__dirname, '..', '..', 'client', 'dist');
```

然後在 `server/.env` 加入：
```
DIST_PATH=/home/youruser/hr-system/client/dist
```

**注意：這只是臨時方案，應該修正 PM2 設定才是正確做法。**

## 完整修正流程

```bash
# 1. 執行診斷腳本
./backend_debug.sh > debug_output.txt

# 2. 查看輸出
cat debug_output.txt

# 3. 如果是工作目錄問題，修改 ecosystem.config.cjs
# 在 apps[0] 中加入：cwd: __dirname,

# 4. 重啟 PM2
npm run pm2:delete
npm run pm2:start

# 5. 驗證
curl http://localhost:3000/ | head -20

# 6. 在瀏覽器測試
# http://localhost:3000
```

## 需要提供的資訊

如果以上都無法解決，請提供：

1. **診斷腳本的完整輸出** (`backend_debug.sh`)
2. **專案的絕對路徑** (`pwd`)
3. **PM2 啟動時的完整命令** 
4. **curl 測試結果**：
   ```bash
   curl -v http://localhost:3000/ 2>&1 | head -30
   ```
5. **瀏覽器 Console 錯誤**（F12 開發者工具）

## 參考文件

- [PM2 部署指南](./PM2_DEPLOYMENT_GUIDE.md)
- [PM2 前端無法顯示解決方案](./PM2_FRONTEND_ACCESS_SOLUTION.md)
- [PM2 虛擬機疑難排解](./PM2_VM_TROUBLESHOOTING.md)
