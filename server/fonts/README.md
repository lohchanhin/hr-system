# 字型檔案 / Font Files

此目錄用於存放 PDF 生成所需的中文字型檔案。

## 安裝字型 / Font Installation

為了支援 PDF 匯出功能的繁體中文顯示，需要安裝 Noto Sans CJK TC (Traditional Chinese) 字型。

### 方法 1：自動下載（推薦）

從 server 目錄執行以下命令自動下載字型檔案：

```bash
# 確保你在 server 目錄中
cd server
./setup-fonts.sh
```

或者使用 wget 手動下載：

```bash
cd server
mkdir -p fonts
wget https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf -O fonts/NotoSansCJKtc-Regular.otf
```

### 方法 2：手動下載

1. 前往 [Noto CJK GitHub](https://github.com/notofonts/noto-cjk)
2. 下載 `NotoSansCJKtc-Regular.otf`（繁體中文常規字體）
3. 將檔案放置於此目錄 (`server/fonts/`)

## 字型檔案

- **NotoSansCJKtc-Regular.otf** - Noto Sans CJK TC Regular（繁體中文常規字體）
  - 大小：約 16MB
  - 用途：PDF 薪資報表生成
  - 來源：Google Noto Fonts

## 環境變數配置（可選）

如果需要使用不同的字型檔案路徑，可以設定環境變數：

```bash
export PDF_CHINESE_FONT_PATH=/path/to/your/font.otf
```

## 注意事項

- 字型檔案不會被提交到 Git 版本庫（已加入 .gitignore）
- 部署時需要確保字型檔案存在於此目錄
- 如果字型檔案缺失，PDF 生成將會顯示亂碼或方框
- 伺服器啟動時會檢查字型檔案是否存在並顯示警告訊息
