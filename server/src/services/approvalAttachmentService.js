// 簽核附件的歸屬管理：上傳時登記上傳者；建立（或重新送出）簽核單時，
// 只能掛「自己上傳、而且還沒掛到別張單」的檔案，掛上後就綁定那一張單。
import mongoose from 'mongoose'
import ApprovalAttachment from '../models/approval_attachment.js'
import { APPROVAL_ATTACHMENT_URL_PATTERN, FormDataError, collectAttachmentFilenames } from './approvalFormData.js'

export async function registerUploadedAttachments(files, uploaderId) {
  if (!files?.length) return []
  const rows = files.map(file => ({
    filename: file.filename,
    uploader: uploaderId,
    original_name: file.originalname,
    size: file.size,
    mime: file.mimetype,
    request: null,
  }))
  await ApprovalAttachment.insertMany(rows)
  return rows
}

/**
 * 核對 data 內的附件並認領給 requestId。
 * - alreadyAttached：這張單原本就有的附件檔名（重新送出時允許沿用，舊資料可能沒有上傳紀錄）。
 * - 其餘的檔案必須有上傳紀錄、上傳者是 actorId、而且還沒掛到別張單；否則 FormDataError。
 * 附件的名稱／大小／類型以上傳紀錄為準，不採用前端送來的值。
 * 回傳 { data, claimed }，claimed 是這次新認領的檔名（建立失敗時用 releaseAttachments 還原）。
 */
export async function bindApprovalAttachments({ data, fileFieldIds, actorId, requestId, alreadyAttached = [] }) {
  const filenames = collectAttachmentFilenames(data, fileFieldIds)
  if (!filenames.length) return { data, claimed: [] }

  const existingSet = new Set(alreadyAttached)
  const rows = await ApprovalAttachment.find({ filename: { $in: filenames } }).lean()
  const rowByName = new Map(rows.map(row => [row.filename, row]))

  const toClaim = []
  for (const filename of filenames) {
    const row = rowByName.get(filename)
    if (!row) {
      // 沒有上傳紀錄：只有「這張單原本就有的舊附件」可以沿用
      if (existingSet.has(filename)) continue
      throw new FormDataError('附件無效或已失效，請重新上傳後再送出')
    }
    if (String(row.uploader) !== String(actorId)) {
      throw new FormDataError('附件不是由您上傳的，請重新上傳後再送出')
    }
    if (row.request && String(row.request) !== String(requestId)) {
      throw new FormDataError('附件已被其他申請使用，請重新上傳後再送出')
    }
    if (!row.request) toClaim.push(filename)
  }

  if (toClaim.length) {
    const result = await ApprovalAttachment.updateMany(
      { filename: { $in: toClaim }, uploader: actorId, request: null },
      { $set: { request: requestId } },
    )
    const modified = result?.modifiedCount ?? result?.nModified ?? 0
    if (modified !== toClaim.length) {
      await releaseAttachments(requestId, toClaim)
      throw new FormDataError('附件已被其他申請使用，請重新上傳後再送出')
    }
  }

  const trusted = { ...data }
  for (const id of fileFieldIds) {
    trusted[id] = (Array.isArray(data[id]) ? data[id] : []).map((item) => {
      const match = APPROVAL_ATTACHMENT_URL_PATTERN.exec(String(item?.url || ''))
      const row = match ? rowByName.get(match[1]) : null
      if (!row) return item // 沿用的舊附件維持原樣
      return {
        name: row.original_name || item.name || match[1],
        url: item.url,
        size: row.size,
        type: row.mime,
      }
    })
  }
  return { data: trusted, claimed: toClaim }
}

/** 建立簽核單失敗時，把這次認領的附件放回「未使用」 */
export async function releaseAttachments(requestId, filenames) {
  if (!filenames?.length) return
  try {
    await ApprovalAttachment.updateMany(
      { filename: { $in: filenames }, request: requestId },
      { $set: { request: null } },
    )
  } catch (error) {
    console.error('[approval] release attachments failed:', error?.name)
  }
}

/** 下載時用：附件若已綁定別張單，就不該從這張單下載 */
export async function isAttachmentBoundElsewhere(filename, requestId) {
  const row = await ApprovalAttachment.findOne({ filename }).lean()
  return Boolean(row?.request && String(row.request) !== String(requestId))
}

export function newRequestId() {
  return new mongoose.Types.ObjectId()
}

export default { registerUploadedAttachments, bindApprovalAttachments, releaseAttachments, isAttachmentBoundElsewhere, newRequestId }
