# VM 與 MongoDB 唯讀檢查結果

稽核日期：2026-07-28
原則：未修改正式 VM、PM2、MongoDB、資料檔或備份；未執行正式環境還原。

## 連線與公開服務結果

| 目標 | 結果 | 判定 |
| --- | --- | --- |
| `192.168.1.99:22` | 從本稽核環境連線逾時 | 私網 VM 無法直接檢查 |
| `220.130.79.214:22` | SSH 無法建立 | 無法唯讀取得主機證據 |
| `220.130.79.215:22` | SSH 無法建立 | 無法唯讀取得主機證據 |
| `220.130.79.215:3000` | HTTP 可達 | 可做公開端點觀察 |

公開服務的唯讀觀察：

- `/` 回傳 `200`。
- 未帶 Token 呼叫 `/api/employees` 回傳 `401`。
- 以非信任 Origin 發送預檢請求，未取得 `Access-Control-Allow-Origin`，未發現任意 Origin CORS。
- 回應缺少 Content Security Policy、HSTS、`X-Content-Type-Options` 等常見安全標頭，並暴露 `X-Powered-By`。
- 五次健康頁請求約 143 至 148 ms；五次未授權員工 API 約 136 至 148 ms。這只能反映公開網路當下結果，不代表登入後查詢與結薪效能。

## 尚未取得的正式 VM 證據

SSH 不可達，因此以下項目不能標記為通過：

| 項目 | 狀態 | 驗收證據 |
| --- | --- | --- |
| PM2 程序、啟動目錄、Node 版本與環境變數來源 | 未驗證 | `pm2 list`、`pm2 describe`，敏感值遮蔽後存檔 |
| MongoDB authentication 與角色 | 未驗證 | `security.authorization`、使用者角色摘要 |
| MongoDB `bindIp`、port 與 TLS | 未驗證 | `/etc/mongod.conf` 安全相關欄位、`ss -lntp` |
| MongoDB `dbPath` 與持久化磁碟 | 未驗證 | 設定、掛載點、檔案系統及重啟後資料存在性 |
| MongoDB 資料目錄權限 | 未驗證 | 目錄擁有者、權限與服務帳號 |
| 索引、唯一鍵及集合筆數 | 未驗證 | `getIndexes()`、`countDocuments()` 摘要 |
| systemd 與 MongoDB 日誌輪替 | 未驗證 | 服務狀態、journal、logrotate 設定與磁碟占用 |
| 備份排程、保留世代與異地副本 | 未驗證 | timer/cron、最近備份、雜湊、保留清單 |
| 磁碟容量與告警 | 未驗證 | `df`、監控告警規則及最近測試事件 |
| 隔離還原演練 | 未執行 | 新資料庫還原、筆數/索引/抽樣雜湊及應用驗證 |

## 本機 MongoDB 觀察

這是開發電腦的 MongoDB，不是正式 VM，僅用來評估預設風險：

| 項目 | 本機觀察 |
| --- | --- |
| 網路 | 綁定 `127.0.0.1:27017` |
| Authentication | 未配置 |
| TLS | 未配置 |
| 儲存 | Windows 本機資料目錄，journal 使用預設值 |
| 開發資料庫 | `hr` 約 21 個集合、18 個物件、46 個索引 |
| 備份 | 工作區未找到 `.bson`、`.archive`、`.gz` 或 `.zip` 備份 |

本機配置不能用來推論正式 VM 安全，也不能作為備份存在的證據。

## 正式 VM 唯讀採證命令

以下命令由具權限的維運人員在 VM 執行，只讀取狀態。輸出交付前須遮蔽 URI、帳密、JWT secret、Cookie 與 Token。

```bash
date -Is
timedatectl
uptime
df -hT
free -h
lsblk -f

sudo systemctl status mongod --no-pager -l
sudo journalctl -u mongod --since "30 days ago" --no-pager | tail -n 500
sudo grep -nE '^[[:space:]]*(dbPath|bindIp|port|authorization|mode|destination|path):' /etc/mongod.conf
sudo ss -lntp
sudo stat -c '%U %G %a %n' /var/lib/mongodb /var/log/mongodb 2>/dev/null

pm2 list
pm2 describe hr-system
pm2 logs hr-system --lines 100 --nostream

mongosh --quiet --eval '
  db.adminCommand({ listDatabases: 1, nameOnly: true }).databases
    .forEach(x => print(x.name));
'
mongosh hr --quiet --eval '
  db.getCollectionNames().sort().forEach(c => {
    print(c, db.getCollection(c).countDocuments(),
      JSON.stringify(db.getCollection(c).getIndexes().map(i => i.name)));
  });
'

systemctl list-timers --all --no-pager | grep -Ei 'mongo|backup|snapshot'
sudo crontab -l
crontab -l
sudo find /var/backups /srv /opt -maxdepth 4 -type f \
  \( -name '*.archive' -o -name '*.bson' -o -name '*.gz' -o -name '*.zip' \) \
  -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort
```

不要直接輸出 `pm2 env` 或 `cat .env` 到工單或聊天；這類輸出常包含完整資料庫連線字串與密鑰。

## 備份與還原驗收

1. 先對備份檔計算 SHA-256，記錄建立時間、來源主機、MongoDB 版本及資料庫名稱。
2. 在隔離主機建立全新的暫存資料庫，不使用 `--drop` 指向正式資料庫。
3. 還原後比較集合名稱、筆數、索引、必要唯一鍵及抽樣文件雜湊。
4. 以隔離應用驗證登入、員工、班表、簽核與薪資查詢，不發送通知或外部請求。
5. 記錄 RPO、RTO、失敗訊息與清理步驟；完成後刪除隔離資料，不改動正式環境。
6. 至少保留多個世代及一份不同主機或不同儲存系統的副本，並定期重做還原演練。
