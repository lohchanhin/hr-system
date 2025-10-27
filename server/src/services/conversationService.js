import crypto from 'crypto';
import InstagramIntegration from '../models/InstagramIntegration.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';

export class ConversationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConversationError';
  }
}

export class IntegrationNotFoundError extends ConversationError {
  constructor(message = '找不到 Instagram 整合設定') {
    super(message);
    this.name = 'IntegrationNotFoundError';
  }
}

export class TokenDecryptionError extends ConversationError {
  constructor(message = '無法解密存取權杖') {
    super(message);
    this.name = 'TokenDecryptionError';
  }
}

export class GraphApiError extends ConversationError {
  constructor(message = '傳送訊息至 Instagram 失敗', status = 502, details = null) {
    super(message);
    this.name = 'GraphApiError';
    this.status = status;
    this.details = details;
  }
}

function getMetaAccessTokenSecret() {
  const secret = process.env.META_ACCESS_TOKEN_SECRET;
  if (!secret) {
    throw new TokenDecryptionError('未設定 META_ACCESS_TOKEN_SECRET 環境變數');
  }
  const buffer = Buffer.from(secret, 'utf-8');
  if (buffer.length !== 32) {
    throw new TokenDecryptionError('META_ACCESS_TOKEN_SECRET 必須為 32 位元組長度');
  }
  return buffer;
}

export function decryptMetaAccessToken(encryptedToken) {
  try {
    if (!encryptedToken) {
      throw new Error('缺少加密權杖');
    }
    const parts = encryptedToken.split(':');
    if (parts.length !== 3) {
      throw new Error('權杖格式不正確');
    }
    const [ivHex, contentHex, authTagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(contentHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const key = getMetaAccessTokenSecret();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch (error) {
    if (error instanceof TokenDecryptionError) {
      throw error;
    }
    throw new TokenDecryptionError(error.message);
  }
}

async function callGraphApi(accessToken, recipientId, message) {
  const response = await fetch('https://graph.facebook.com/v19.0/me/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: message },
      messaging_type: 'RESPONSE',
    }),
  });

  if (!response.ok) {
    let details = null;
    try {
      details = await response.json();
    } catch (err) {
      // ignore parsing error
    }
    const errorMessage =
      details?.error?.message || `Graph API 回傳狀態碼 ${response.status}`;
    throw new GraphApiError(errorMessage, response.status, details);
  }
  try {
    return await response.json();
  } catch (err) {
    return {};
  }
}

export async function sendManualReply({
  tenantId,
  conversationId,
  recipientId,
  message,
  senderId = null,
}) {
  if (!tenantId) {
    throw new ConversationError('缺少租戶識別');
  }
  if (!conversationId) {
    throw new ConversationError('缺少對話識別');
  }
  if (!recipientId) {
    throw new ConversationError('缺少 recipientId');
  }
  if (!message) {
    throw new ConversationError('缺少訊息內容');
  }

  const integration = await InstagramIntegration.findOne({ tenantId });
  if (!integration) {
    throw new IntegrationNotFoundError();
  }

  const accessToken = decryptMetaAccessToken(integration.metaAccessToken);
  const graphResponse = await callGraphApi(accessToken, recipientId, message);

  const now = new Date();
  const conversation = await Conversation.findOneAndUpdate(
    { tenantId, externalId: conversationId },
    {
      $set: {
        recipientId,
        integration: integration._id,
        lastRepliedAt: now,
      },
      $setOnInsert: {
        tenantId,
        externalId: conversationId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const createdMessage = await Message.create({
    conversation: conversation._id,
    tenantId,
    direction: 'outbound',
    body: message,
    recipientId,
    senderId,
    externalMessageId: graphResponse?.message_id || null,
    sentAt: now,
  });

  return {
    conversation: {
      id: conversation._id?.toString?.() ?? conversation._id,
      externalId: conversation.externalId ?? conversationId,
    },
    message: {
      id: createdMessage._id?.toString?.() ?? createdMessage._id,
      externalMessageId: graphResponse?.message_id || null,
    },
    recipientId,
    sentAt: now.toISOString(),
  };
}
