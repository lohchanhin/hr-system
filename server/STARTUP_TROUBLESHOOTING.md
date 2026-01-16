# 後端啟動問題排查指南 / Backend Startup Troubleshooting Guide

## 常見問題 / Common Issues

### 1. 缺少環境變數 / Missing Environment Variables

**錯誤訊息 / Error Message:**
```
Missing required environment variables: PORT, MONGODB_URI, JWT_SECRET
[nodemon] app crashed - waiting for file changes before starting...
```

**解決方法 / Solution:**

1. 複製環境變數範例檔：
   ```bash
   cd server
   cp .env.example .env
   ```

2. 編輯 `.env` 檔案，設定必要的環境變數：
   ```env
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/hr
   JWT_SECRET=your-super-secret-jwt-key-change-this
   ```

   ⚠️ **重要 / Important**: 
   - In production, use a strong secret key for `JWT_SECRET`
   - 生產環境請務必使用強密碼作為 `JWT_SECRET`

### 2. MongoDB 未啟動 / MongoDB Not Running

**錯誤訊息 / Error Message:**
```
MongoDB connection error: MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017
```

**解決方法 / Solution:**

確保 MongoDB 服務正在運行：

**Windows:**
```bash
# 啟動 MongoDB 服務
net start MongoDB
```

**macOS:**
```bash
# 使用 Homebrew 啟動
brew services start mongodb-community

# 或直接啟動
mongod --config /usr/local/etc/mongod.conf
```

**Linux:**
```bash
# Ubuntu/Debian
sudo systemctl start mongod
sudo systemctl enable mongod

# 檢查狀態
sudo systemctl status mongod
```

### 3. nodemon 未安裝 / nodemon Not Found

**錯誤訊息 / Error Message:**
```
sh: 1: nodemon: not found
```

**解決方法 / Solution:**

確保已安裝所有依賴套件：
```bash
cd server
npm install
```

### 4. 字型檔案警告 / Font File Warning

**錯誤訊息 / Error Message:**
```
警告：繁體中文字型檔案不存在
PDF 匯出可能會顯示亂碼。請執行字型安裝腳本：./setup-fonts.sh
```

**解決方法 / Solution:**

這是警告訊息，不會影響系統啟動。如需修復 PDF 匯出功能：
```bash
cd server
./setup-fonts.sh
```

## 完整啟動檢查清單 / Complete Startup Checklist

- [ ] 已安裝 Node.js 20.x 或以上版本
- [ ] 已安裝 MongoDB 4.x 或以上版本
- [ ] 已執行 `npm install` 安裝依賴套件
- [ ] 已建立 `.env` 檔案並設定環境變數
- [ ] MongoDB 服務已啟動
- [ ] 可正常執行 `npm run dev`

## 驗證啟動成功 / Verify Successful Startup

啟動成功時應該會看到：
```
[nodemon] starting `node src/index.js`
警告：繁體中文字型檔案不存在 / Warning: Traditional Chinese font file not found
Connected to MongoDB
Created default admin user admin
Server running on port 3000
```

## 相關文件 / Related Documentation

- 主要 README: `README.md` (in repository root)
- 環境變數範例: `.env.example` (in server directory)
- 伺服器文件: `README.md` (in server directory)

## 需要協助？ / Need Help?

如果按照以上步驟仍無法啟動，請檢查：
1. Node.js 版本是否符合要求 (`node --version`)
2. MongoDB 是否正確安裝 (`mongod --version`)
3. 環境變數是否正確設定
4. 防火牆是否阻擋 3000 或 27017 埠
