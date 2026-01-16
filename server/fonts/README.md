# 字型檔案 / Font Files

此目錄用於存放 PDF 生成所需的中文字型檔案。

## 安裝字型 / Font Installation

為了支援 PDF 匯出功能的繁體中文顯示，需要安裝 Noto Sans CJK TC (Traditional Chinese) 字型。

### 方法 1：自動下載（推薦）

執行以下命令自動下載字型檔案：

```bash
cd /home/runner/work/hr-system/hr-system/server
mkdir -p fonts
wget -q https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf -O fonts/NotoSansCJKtc-Regular.otf
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

## 注意事項

- 字型檔案不會被提交到 Git 版本庫（已加入 .gitignore）
- 部署時需要確保字型檔案存在於此目錄
- 如果字型檔案缺失，PDF 生成將會失敗或顯示亂碼
