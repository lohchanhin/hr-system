#!/bin/bash
# 字型安裝腳本 / Font Installation Script
# 此腳本用於下載並安裝 PDF 生成所需的繁體中文字型

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FONTS_DIR="$SCRIPT_DIR/fonts"
FONT_URL="https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf"
FONT_FILE="$FONTS_DIR/NotoSansCJKtc-Regular.otf"
# SHA256 checksum for verification (update this when font version changes)
# This is an example - actual checksum should be verified
EXPECTED_CHECKSUM=""

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

DOWNLOAD_SUCCESS=false

if command -v wget &> /dev/null; then
    if wget --timeout=30 --tries=3 --show-progress -O "$FONT_FILE" "$FONT_URL"; then
        DOWNLOAD_SUCCESS=true
    else
        echo "wget 下載失敗，嘗試使用 curl / wget failed, trying curl..."
    fi
fi

if [ "$DOWNLOAD_SUCCESS" = false ] && command -v curl &> /dev/null; then
    if curl -L --max-time 30 --retry 3 --progress-bar -o "$FONT_FILE" "$FONT_URL"; then
        DOWNLOAD_SUCCESS=true
    fi
fi

if [ "$DOWNLOAD_SUCCESS" = false ]; then
    echo "錯誤：下載失敗"
    echo "Error: Download failed"
    echo "請檢查網路連線或手動下載字型檔案並放置於 $FONTS_DIR"
    echo "Please check network connection or manually download the font file and place it in $FONTS_DIR"
    rm -f "$FONT_FILE"  # Clean up partial download
    exit 1
fi

# 驗證下載
if [ -f "$FONT_FILE" ]; then
    FILE_SIZE=$(du -h "$FONT_FILE" | cut -f1)
    echo ""
    echo "✓ 字型安裝成功！/ Font installed successfully!"
    echo "  檔案位置 / File location: $FONT_FILE"
    echo "  檔案大小 / File size: $FILE_SIZE"
    
    # Verify file is a valid font file (basic check)
    FILE_TYPE=$(file -b "$FONT_FILE")
    if [[ "$FILE_TYPE" == *"OpenType"* ]] || [[ "$FILE_TYPE" == *"TrueType"* ]]; then
        echo "  檔案類型 / File type: ✓ Valid font file"
    else
        echo "  警告：檔案類型可能不正確 / Warning: File type may be incorrect"
        echo "  類型 / Type: $FILE_TYPE"
    fi
else
    echo ""
    echo "✗ 字型下載失敗 / Font download failed"
    exit 1
fi
