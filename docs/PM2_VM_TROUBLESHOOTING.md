# PM2 虛擬機部署問題排查指南

## 問題描述

您的情況：
- ✅ 所有設定都已確認正確
- ✅ PM2 顯示 "Server running on port 3000"
- ❌ 訪問 localhost:3000 仍然看不到前端
- 🖥️ 部署環境：虛擬機（VM）

## 虛擬機特有問題

在虛擬機環境中部署時，有幾個常見的網路和訪問問題：

### 問題 1：監聽位址限制

**問題描述：**
後端可能只監聽 `127.0.0.1`（localhost），無法從虛擬機外部訪問。

**檢查方法：**
```bash
# 查看 PM2 進程監聽的位址
pm2 logs hr-system | grep "Server running"

# 檢查實際監聽的 port 和 IP
sudo netstat -tlnp | grep :3000
# 或使用 ss
sudo ss -tlnp | grep :3000
```

**預期輸出：**
```bash
# ✅ 正確（監聽所有介面）
tcp        0      0 0.0.0.0:3000            0.0.0.0:*               LISTEN      12345/node

# ❌ 問題（只監聽 localhost）
tcp        0      0 127.0.0.1:3000          0.0.0.0:*               LISTEN      12345/node
```

**解決方法：**

檢查 `server/src/index.js` 中的監聽設定（第 234 行附近）：

```javascript
// ❌ 可能的問題寫法
app.listen(PORT, 'localhost', () => {
  console.log(`Server running on port ${PORT}`);
});

// ✅ 正確寫法（監聽所有介面）
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ✅ 或明確指定監聽所有介面
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
```

**當前專案的設定：**
查看 `server/src/index.js` 第 234 行，應該是：
```javascript
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

這個設定是正確的，會監聽所有介面。

### 問題 2：防火牆阻擋

**問題描述：**
虛擬機的防火牆可能阻擋 port 3000。

**檢查方法：**

**Ubuntu/Debian (ufw):**
```bash
# 檢查防火牆狀態
sudo ufw status

# 如果防火牆啟用，檢查 3000 port 是否開放
sudo ufw status | grep 3000
```

**CentOS/RHEL (firewalld):**
```bash
# 檢查防火牆狀態
sudo firewall-cmd --state

# 檢查開放的 port
sudo firewall-cmd --list-ports
```

**解決方法：**

**Ubuntu/Debian:**
```bash
# 開放 port 3000
sudo ufw allow 3000/tcp

# 重新載入防火牆
sudo ufw reload

# 確認規則已加入
sudo ufw status
```

**CentOS/RHEL:**
```bash
# 開放 port 3000
sudo firewall-cmd --zone=public --add-port=3000/tcp --permanent

# 重新載入防火牆
sudo firewall-cmd --reload

# 確認規則已加入
sudo firewall-cmd --list-ports
```

### 問題 3：SELinux 限制（CentOS/RHEL）

**問題描述：**
SELinux 可能阻止 Node.js 監聽非標準 port。

**檢查方法：**
```bash
# 檢查 SELinux 狀態
sestatus

# 查看 SELinux 日誌
sudo grep denied /var/log/audit/audit.log | grep 3000
```

**解決方法：**

**臨時解決（測試用）：**
```bash
# 設定為寬容模式
sudo setenforce 0
```

**永久解決：**
```bash
# 允許 Node.js 監聽 port 3000
sudo semanage port -a -t http_port_t -p tcp 3000

# 或關閉 SELinux（不推薦）
sudo vi /etc/selinux/config
# 設定 SELINUX=disabled
```

### 問題 4：虛擬機網路模式

**問題描述：**
不同的虛擬機網路模式會影響訪問方式。

#### NAT 模式
- **訪問方式：** 只能從虛擬機內部訪問（localhost:3000）
- **解決方法：** 設定 port forwarding

**VirtualBox 設定：**
```
設定 → 網路 → 進階 → 連接埠轉送
主機 Port: 3000 → 客體 Port: 3000
```

**VMware 設定：**
```
虛擬機設定 → 硬體 → 網路介面卡 → NAT 設定
新增 port forwarding 規則
```

#### 橋接模式（Bridged）
- **訪問方式：** 使用虛擬機的 IP 位址
- **檢查 IP：** `ip addr show` 或 `ifconfig`
- **訪問：** `http://[VM_IP]:3000`

#### Host-Only 模式
- **訪問方式：** 使用虛擬機的 Host-Only IP
- **檢查 IP：** `ip addr show` 或 `ifconfig`
- **訪問：** `http://[Host-Only_IP]:3000`

### 問題 5：從哪裡訪問？

**確認訪問位置：**

1. **從虛擬機內部瀏覽器訪問：**
   ```
   http://localhost:3000
   http://127.0.0.1:3000
   ```

2. **從虛擬機內部使用 curl 測試：**
   ```bash
   # 測試後端 API
   curl http://localhost:3000/api/health
   
   # 測試前端
   curl http://localhost:3000/ | head -20
   ```

3. **從宿主機瀏覽器訪問：**
   - NAT 模式：需要設定 port forwarding
   - 橋接模式：`http://[VM_IP]:3000`
   - Host-Only：`http://[Host-Only_IP]:3000`

4. **從其他機器訪問：**
   - 需要橋接模式
   - 需要開放防火牆
   - `http://[VM_IP]:3000`

## 完整診斷流程

### 步驟 1：確認服務狀態

```bash
# 1. PM2 狀態
pm2 status

# 2. 查看日誌
pm2 logs hr-system --lines 50

# 3. 確認進程在運行
ps aux | grep node
```

### 步驟 2：確認網路監聽

```bash
# 確認 port 3000 正在監聽
sudo netstat -tlnp | grep :3000
# 或
sudo ss -tlnp | grep :3000

# 預期輸出應該包含：
# tcp   0   0 0.0.0.0:3000   0.0.0.0:*   LISTEN   [PID]/node
```

### 步驟 3：虛擬機內部測試

```bash
# 測試後端 API
curl http://localhost:3000/api/health
# 預期返回：{"status":"OK"}

# 測試前端首頁
curl -I http://localhost:3000/
# 預期返回：HTTP/1.1 200 OK

# 獲取前端內容
curl http://localhost:3000/ | grep "<html"
# 應該返回 HTML 內容
```

**如果虛擬機內部測試成功，但外部無法訪問，問題在於網路設定（防火牆或網路模式）。**

### 步驟 4：檢查防火牆

```bash
# Ubuntu/Debian
sudo ufw status

# CentOS/RHEL
sudo firewall-cmd --list-all

# 如果防火牆開啟且沒有 3000 port，需要開放
```

### 步驟 5：檢查 client/dist/ 內容

```bash
# 確認前端檔案存在
ls -lh client/dist/

# 確認 index.html 存在
cat client/dist/index.html | head -20

# 確認後端能找到檔案
node -e "
const path = require('path');
const fs = require('fs');
const distPath = path.join(__dirname, 'client', 'dist');
console.log('distPath:', distPath);
console.log('exists:', fs.existsSync(distPath));
console.log('index.html exists:', fs.existsSync(path.join(distPath, 'index.html')));
"
```

### 步驟 6：測試靜態檔案服務

```bash
# 測試 CSS 或 JS 檔案
curl -I http://localhost:3000/assets/index-*.js

# 測試 favicon
curl -I http://localhost:3000/favicon.ico
```

## 虛擬機專用解決方案

### 方案 1：使用 Nginx 反向代理（推薦）

Nginx 可以解決很多網路訪問問題。

**安裝 Nginx：**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# CentOS/RHEL
sudo yum install nginx
```

**設定 Nginx：**
```bash
sudo vi /etc/nginx/sites-available/hr-system
```

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**啟用設定：**
```bash
# Ubuntu/Debian
sudo ln -s /etc/nginx/sites-available/hr-system /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# CentOS/RHEL
sudo cp /etc/nginx/sites-available/hr-system /etc/nginx/conf.d/hr-system.conf
sudo nginx -t
sudo systemctl restart nginx
```

**開放防火牆 port 80：**
```bash
# Ubuntu/Debian
sudo ufw allow 80/tcp

# CentOS/RHEL
sudo firewall-cmd --zone=public --add-service=http --permanent
sudo firewall-cmd --reload
```

**訪問：**
```
http://[VM_IP]
```

### 方案 2：明確監聽所有介面

如果不想使用 Nginx，確保 Node.js 監聽所有介面。

**檢查目前設定：**
```bash
grep -A 5 "app.listen" server/src/index.js
```

**如需要，可以明確指定：**

在 `server/.env` 中加入：
```env
HOST=0.0.0.0
```

修改 `server/src/index.js`（如果需要）：
```javascript
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;

// ...

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});
```

### 方案 3：使用 SSH 隧道（臨時測試）

如果只是想臨時從宿主機訪問，可以使用 SSH 隧道：

```bash
# 在宿主機執行
ssh -L 3000:localhost:3000 user@vm_ip

# 然後在宿主機瀏覽器訪問
http://localhost:3000
```

## 詳細日誌收集

如果以上都無法解決，請收集以下資訊：

```bash
#!/bin/bash
# 建立診斷報告

echo "=== PM2 虛擬機診斷報告 ===" > vm_diagnostic.txt
echo "" >> vm_diagnostic.txt

echo "## 1. 系統資訊" >> vm_diagnostic.txt
uname -a >> vm_diagnostic.txt
cat /etc/os-release >> vm_diagnostic.txt
echo "" >> vm_diagnostic.txt

echo "## 2. 網路設定" >> vm_diagnostic.txt
ip addr show >> vm_diagnostic.txt
echo "" >> vm_diagnostic.txt

echo "## 3. PM2 狀態" >> vm_diagnostic.txt
pm2 status >> vm_diagnostic.txt
echo "" >> vm_diagnostic.txt

echo "## 4. 監聽的 Port" >> vm_diagnostic.txt
sudo netstat -tlnp | grep :3000 >> vm_diagnostic.txt
echo "" >> vm_diagnostic.txt

echo "## 5. 防火牆狀態" >> vm_diagnostic.txt
if command -v ufw &> /dev/null; then
    sudo ufw status >> vm_diagnostic.txt
elif command -v firewall-cmd &> /dev/null; then
    sudo firewall-cmd --list-all >> vm_diagnostic.txt
fi
echo "" >> vm_diagnostic.txt

echo "## 6. SELinux 狀態" >> vm_diagnostic.txt
if command -v sestatus &> /dev/null; then
    sestatus >> vm_diagnostic.txt
fi
echo "" >> vm_diagnostic.txt

echo "## 7. PM2 日誌（最後 50 行）" >> vm_diagnostic.txt
pm2 logs hr-system --lines 50 --nostream >> vm_diagnostic.txt
echo "" >> vm_diagnostic.txt

echo "## 8. 本地測試" >> vm_diagnostic.txt
echo "API Health:" >> vm_diagnostic.txt
curl -s http://localhost:3000/api/health >> vm_diagnostic.txt
echo "" >> vm_diagnostic.txt
echo "Frontend:" >> vm_diagnostic.txt
curl -I http://localhost:3000/ 2>&1 >> vm_diagnostic.txt
echo "" >> vm_diagnostic.txt

echo "## 9. client/dist/ 檢查" >> vm_diagnostic.txt
ls -lh client/dist/ >> vm_diagnostic.txt
echo "" >> vm_diagnostic.txt

echo "報告已儲存到 vm_diagnostic.txt"
cat vm_diagnostic.txt
```

執行並分享這個診斷報告：
```bash
chmod +x vm_diagnostic.sh
./vm_diagnostic.sh
```

## 常見虛擬機部署錯誤

### 錯誤 1：EADDRINUSE (Port 被佔用)

**錯誤訊息：**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**檢查：**
```bash
# 查看是誰佔用 port 3000
sudo lsof -i :3000
# 或
sudo netstat -tlnp | grep :3000
```

**解決：**
```bash
# 終止佔用 port 的進程
sudo kill -9 [PID]

# 或修改 server/.env 使用不同 port
PORT=3001
```

### 錯誤 2：EACCES (權限不足)

**錯誤訊息：**
```
Error: listen EACCES: permission denied 0.0.0.0:3000
```

**原因：**
在某些系統中，非 root 用戶無法監聽 1024 以下的 port。

**解決：**
```bash
# 使用 3000 以上的 port（已經是 3000，應該沒問題）
# 或允許 Node.js 監聽低 port
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

### 錯誤 3：Cannot find module

**錯誤訊息：**
```
Error: Cannot find module '/path/to/server/src/index.js'
```

**檢查：**
```bash
# 確認檔案存在
ls -la /home/runner/work/hr-system/hr-system/server/src/index.js

# 確認工作目錄
pwd
```

**解決：**
```bash
# 確保在正確的目錄啟動 PM2
cd /home/runner/work/hr-system/hr-system
npm run pm2:start
```

## 總結與建議

### 虛擬機部署檢查清單

- [ ] 前端已建置（`client/dist/` 存在）
- [ ] MongoDB 正在運行
- [ ] PM2 狀態為 "online"
- [ ] 虛擬機內部可以訪問（curl localhost:3000）
- [ ] 防火牆已開放 port 3000
- [ ] SELinux 未阻擋（如果使用 CentOS/RHEL）
- [ ] 虛擬機網路模式正確設定
- [ ] 後端監聽 0.0.0.0 而非 127.0.0.1

### 推薦配置

**簡單部署（直接訪問 port 3000）：**
1. 使用橋接網路模式
2. 開放防火牆 port 3000
3. 確保監聽 0.0.0.0

**正式部署（使用 Nginx）：**
1. 設定 Nginx 反向代理
2. 開放防火牆 port 80/443
3. 後端只需監聽 localhost:3000
4. 可以設定 SSL

### 下一步

如果按照本指南仍然無法解決：

1. **執行診斷腳本**，收集完整資訊
2. **確認訪問位置**（虛擬機內部？宿主機？其他電腦？）
3. **提供具體錯誤訊息**（瀏覽器 Console、PM2 日誌）
4. **說明虛擬機環境**（VirtualBox? VMware? 網路模式？作業系統？）

## 參考資料

- [PM2 部署指南](./PM2_DEPLOYMENT_GUIDE.md)
- [PM2 前端無法顯示解決方案](./PM2_FRONTEND_ACCESS_SOLUTION.md)
- [PM2 常見問題](./PM2_FAQ.md)
- [Nginx 官方文件](https://nginx.org/en/docs/)
