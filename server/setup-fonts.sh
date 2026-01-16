#!/bin/bash
# 字型安裝腳本 / Font Installation Script
# 此腳本用於下載並安裝 PDF 生成所需的繁體中文字型

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FONTS_DIR="$SCRIPT_DIR/fonts"
FONT_URL="https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf"
FONT_FILE="$FONTS_DIR/NotoSansCJKtc-Regular.otf"

echo "正在設置 PDF 繁體中文字型..."
echo "Setting up Traditional Chinese fonts for PDF generation..."
echo ""

# 建立 fonts 目錄
if [ ! -d "$FONTS_DIR" ]; then
    echo "建立字型目錄 / Creating fonts directory..."
    mkdir -p "$FONTS_DIR"
fi

# 檢查字型是否已存在
if [ -f "$FONT_FILE" ]; then
    echo "✓ 字型檔案已存在 / Font file already exists: $FONT_FILE"
    echo "如需重新下載，請先刪除現有檔案 / To re-download, please delete the existing file first"
    exit 0
fi

# 下載字型
echo "正在下載字型檔案... / Downloading font file..."
echo "來源 / Source: $FONT_URL"
echo ""

if command -v wget &> /dev/null; then
    wget --show-progress -O "$FONT_FILE" "$FONT_URL"
elif command -v curl &> /dev/null; then
    curl -L --progress-bar -o "$FONT_FILE" "$FONT_URL"
else
    echo "錯誤：未找到 wget 或 curl 命令"
    echo "Error: Neither wget nor curl found"
    echo "請手動下載字型檔案並放置於 $FONTS_DIR"
    echo "Please manually download the font file and place it in $FONTS_DIR"
    exit 1
fi

# 驗證下載
if [ -f "$FONT_FILE" ]; then
    FILE_SIZE=$(du -h "$FONT_FILE" | cut -f1)
    echo ""
    echo "✓ 字型安裝成功！/ Font installed successfully!"
    echo "  檔案位置 / File location: $FONT_FILE"
    echo "  檔案大小 / File size: $FILE_SIZE"
else
    echo ""
    echo "✗ 字型下載失敗 / Font download failed"
    exit 1
fi
