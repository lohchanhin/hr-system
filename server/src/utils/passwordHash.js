// 員工密碼的雜湊格式（salt:hash，PBKDF2-SHA512 十萬次、64 bytes），Employee model 的 password 虛擬欄位與批量匯入共用。
// 同步版一次約數十毫秒：單筆新增／改密碼用它沒有問題；批量匯入一次幾百、幾千人時要用非同步版（在背景執行緒計算），
// 不然整個伺服器會卡住好幾分鐘，其他人的請求都得等。
import crypto from 'crypto'

const ITERATIONS = 100000
const KEY_LENGTH = 64
const DIGEST = 'sha512'

export function hashPassword(plain) {
  if (!plain) return undefined
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(plain, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex')
  return `${salt}:${hash}`
}

/** 與 hashPassword 相同的格式，但不佔用主執行緒 */
export function hashPasswordAsync(plain) {
  if (!plain) return Promise.resolve(undefined)
  const salt = crypto.randomBytes(16).toString('hex')
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(plain), salt, ITERATIONS, KEY_LENGTH, DIGEST, (error, derived) => {
      if (error) reject(error)
      else resolve(`${salt}:${derived.toString('hex')}`)
    })
  })
}

export default { hashPassword, hashPasswordAsync }
