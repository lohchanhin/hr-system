# VM 內部訪問疑難排解 - Ubuntu 橋接模式

## 您的環境

- ✅ 作業系統：Ubuntu
- ✅ 網路模式：橋接 (Bridged)
- ✅ 訪問位置：VM 內部
- ✅ PM2 日誌：Admin user already exists, Connected to MongoDB
- ✅ 後端狀態：正常運行

## 問題診斷

根據您的情況，**後端已經正常啟動並連接到資料庫**，問題很可能是：

### 最可能的原因：前端沒有建置

PM2 啟動的是後端伺服器，但**前端必須先建置**才能被提供。

## 立即解決步驟

### 步驟 1：執行自動診斷腳本

在專案根目錄執行以下命令：

```bash
cd /home/runner/work/hr-system/hr-system  # 或您的專案路徑

# 建立診斷腳本
cat > vm_diagnostic.sh << 'EOF'
#!/bin/bash
echo "=== HR System VM 內部診斷 ==="
echo ""

echo "1. 檢查 client/dist/ 是否存在"
if [ -d "client/dist" ]; then
    echo "✅ client/dist/ 目錄存在"
    echo "   檔案數量: $(find client/dist -type f | wc -l)"
    if [ -f "client/dist/index.html" ]; then
        echo "✅ index.html 存在"
        echo "   大小: $(ls -lh client/dist/index.html | awk '{print $5}')"
    else
        echo "❌ index.html 不存在"
    fi
else
    echo "❌ client/dist/ 目錄不存在 - 需要執行 npm run build"
fi
echo ""

echo "2. 測試本地 API"
API_RESPONSE=$(curl -s http://localhost:3000/api/health)
if [ "$API_RESPONSE" = '{"status":"OK"}' ]; then
    echo "✅ API 正常: $API_RESPONSE"
else
    echo "❌ API 回應異常: $API_RESPONSE"
fi
echo ""

echo "3. 測試前端首頁"
FRONTEND_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
if [ "$FRONTEND_RESPONSE" = "200" ]; then
    echo "✅ 前端 HTTP 狀態碼: $FRONTEND_RESPONSE"
    HTML_CHECK=$(curl -s http://localhost:3000/ | grep -c "<html")
    if [ "$HTML_CHECK" -gt 0 ]; then
        echo "✅ 返回 HTML 內容"
    else
        echo "❌ 未返回 HTML 內容"
    fi
else
    echo "❌ 前端 HTTP 狀態碼: $FRONTEND_RESPONSE"
fi
echo ""

echo "4. 檢查監聽位址"
LISTEN_CHECK=$(netstat -tln 2>/dev/null | grep :3000 || ss -tln 2>/dev/null | grep :3000)
echo "$LISTEN_CHECK"
echo ""

echo "=== 建議動作 ==="
if [ ! -d "client/dist" ] || [ ! -f "client/dist/index.html" ]; then
    echo "需要建置前端："
    echo "  npm run build"
    echo "  npm run pm2:restart"
else
    echo "前端已建置，如果仍看不到，請檢查瀏覽器 Console"
fi
EOF

chmod +x vm_diagnostic.sh
./vm_diagnostic.sh
```

### 步驟 2：根據診斷結果處理

#### 情況 A：顯示「client/dist/ 目錄不存在」

**解決方法：**
```bash
# 建置前端
npm run build

# 確認建置成功
ls -la client/dist/

# 重啟 PM2
npm run pm2:restart

# 等待 3 秒後測試
sleep 3
curl http://localhost:3000/api/health

# 在瀏覽器訪問
# http://localhost:3000
```

#### 情況 B：顯示「前端 HTTP 狀態碼: 200」且「返回 HTML 內容」

**這表示後端正常，問題可能在瀏覽器：**

1. **清除瀏覽器快取**
   - Firefox: Ctrl + Shift + Delete
   - Chrome: Ctrl + Shift + Delete
   - 勾選「快取的圖片和檔案」

2. **強制重新整理**
   - Ctrl + Shift + R (Linux)
   - Ctrl + F5

3. **檢查瀏覽器 Console**
   - 按 F12 開啟開發者工具
   - 查看 Console 標籤是否有錯誤訊息
   - 查看 Network 標籤，確認檔案是否成功載入

4. **使用無痕模式測試**
   - Ctrl + Shift + N (Chrome)
   - Ctrl + Shift + P (Firefox)

#### 情況 C：curl 測試失敗

**檢查 PM2 狀態：**
```bash
pm2 status
pm2 logs hr-system --lines 100
```

## 完整重建流程

如果以上都無法解決，執行完整重建：

```bash
# 1. 停止 PM2
npm run pm2:stop

# 2. 刪除舊的建置檔案
rm -rf client/dist/

# 3. 確認依賴已安裝
npm install

# 4. 重新建置前端
npm run build

# 5. 確認建置成功
ls -la client/dist/
# 應該看到 index.html 和 assets/ 目錄

# 6. 確認 index.html 內容正確
head -20 client/dist/index.html
# 應該看到 <!DOCTYPE html> 和 <html> 標籤

# 7. 重新啟動 PM2
npm run pm2:start

# 8. 查看日誌確認啟動成功
npm run pm2:logs

# 9. 測試 API
curl http://localhost:3000/api/health

# 10. 測試前端
curl -I http://localhost:3000/

# 11. 在瀏覽器訪問
# http://localhost:3000
```

## 詳細檢查清單

### ✅ 後端檢查（您的環境已正常）

- [x] MongoDB 已連接
- [x] Admin user 已存在
- [x] PM2 狀態為 online
- [x] 伺服器運行在 port 3000

### ⚠️ 前端檢查（需要確認）

```bash
# 1. client/dist/ 目錄存在嗎？
ls -la client/dist/

# 2. index.html 存在嗎？
ls -la client/dist/index.html

# 3. 檔案大小正常嗎？（應該 > 500 bytes）
du -h client/dist/index.html

# 4. assets/ 目錄有檔案嗎？
ls -la client/dist/assets/

# 5. 後端能找到這些檔案嗎？
curl -I http://localhost:3000/assets/index-*.js
```

## 瀏覽器測試

### 在 VM 內部的 Firefox 或 Chrome：

1. **開啟瀏覽器**

2. **訪問：** `http://localhost:3000`

3. **預期結果：**
   - ✅ 看到登入頁面（HR System 標題、使用者名稱和密碼輸入框）
   
4. **如果看到錯誤：**
   - 空白頁面 → 前端沒建置或建置失敗
   - "Cannot GET /" → 前端沒建置
   - 載入很久但沒內容 → 檢查瀏覽器 Console（F12）
   - 顯示程式碼 → Content-Type 錯誤（少見）

5. **按 F12 開啟開發者工具：**
   - **Console 標籤：** 查看 JavaScript 錯誤
   - **Network 標籤：** 查看檔案載入狀況
     - 刷新頁面（F5）
     - 檢查是否有紅色的失敗請求
     - 檢查 index.html 是否 200 OK
     - 檢查 .js 和 .css 檔案是否成功載入

## 常見錯誤及解決

### 錯誤 1：看到空白頁面，Console 顯示 404

**原因：** 前端檔案不存在

**解決：**
```bash
npm run build
npm run pm2:restart
```

### 錯誤 2：看到舊版本的頁面

**原因：** 瀏覽器快取

**解決：**
```bash
# 1. 清除瀏覽器快取
# 2. 強制重新整理（Ctrl + Shift + R）
# 3. 或使用無痕模式
```

### 錯誤 3：Console 顯示「Failed to fetch」或 CORS 錯誤

**原因：** 前端嘗試連接不存在的 API

**檢查：**
```bash
# 確認 API 正常
curl http://localhost:3000/api/health

# 檢查前端設定
grep -r "VITE_API_BASE_URL" client/.env 2>/dev/null || echo "無 .env 檔案（正常）"
```

### 錯誤 4：看到 "Cannot GET /"

**原因：** Express 沒有正確設定靜態檔案服務

**檢查：**
```bash
# 確認後端程式碼中有設定
grep -A 2 "express.static" server/src/index.js

# 應該看到類似：
# app.use(express.static(distPath));
```

## Ubuntu 特定注意事項

### 如果使用 snap 安裝的 Node.js

Snap 版本的 Node.js 可能有權限問題：

```bash
# 檢查 Node 版本來源
which node
snap list | grep node

# 如果是 snap 版本，建議改用 nvm 或 apt
# 使用 nvm 安裝 Node.js：
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 檢查檔案權限

```bash
# 確認您有讀取權限
ls -la client/dist/
ls -la server/

# 如果權限不足
chmod -R 755 client/dist/
```

## 下一步行動

### 立即執行：

1. **執行診斷腳本**（最重要）
   ```bash
   ./vm_diagnostic.sh
   ```

2. **如果 client/dist/ 不存在**
   ```bash
   npm run build
   npm run pm2:restart
   ```

3. **在瀏覽器測試**
   - 開啟 Firefox 或 Chrome
   - 訪問 http://localhost:3000
   - 按 F12 查看 Console

4. **回報結果**
   - 診斷腳本的完整輸出
   - 瀏覽器 Console 的錯誤訊息（如果有）
   - 瀏覽器顯示的內容（截圖更好）

## 預期的成功狀態

當一切正常時，您應該看到：

### 診斷腳本輸出：
```
=== HR System VM 內部診斷 ===

1. 檢查 client/dist/ 是否存在
✅ client/dist/ 目錄存在
   檔案數量: 15
✅ index.html 存在
   大小: 1.2K

2. 測試本地 API
✅ API 正常: {"status":"OK"}

3. 測試前端首頁
✅ 前端 HTTP 狀態碼: 200
✅ 返回 HTML 內容

4. 檢查監聽位址
tcp   0   0 0.0.0.0:3000   0.0.0.0:*   LISTEN

=== 建議動作 ===
前端已建置，如果仍看不到，請檢查瀏覽器 Console
```

### 瀏覽器：
- 顯示 HR System 登入頁面
- Console 無錯誤訊息
- Network 標籤顯示所有檔案成功載入（綠色）

### curl 測試：
```bash
$ curl http://localhost:3000/api/health
{"status":"OK"}

$ curl -I http://localhost:3000/
HTTP/1.1 200 OK
Content-Type: text/html; charset=UTF-8
...
```

## 參考文件

- [PM2 部署指南](./PM2_DEPLOYMENT_GUIDE.md)
- [PM2 前端無法顯示解決方案](./PM2_FRONTEND_ACCESS_SOLUTION.md)
- [PM2 虛擬機疑難排解](./PM2_VM_TROUBLESHOOTING.md)
- [主要 README](../README.md)
