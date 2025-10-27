import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { jest } from '@jest/globals';

const fetchMock = jest.fn();
global.fetch = fetchMock;

const findIntegrationMock = jest.fn();
const updateConversationMock = jest.fn();
const createMessageMock = jest.fn();

jest.unstable_mockModule('../src/models/InstagramIntegration.js', () => ({
  default: { findOne: findIntegrationMock },
}));

jest.unstable_mockModule('../src/models/Conversation.js', () => ({
  default: { findOneAndUpdate: updateConversationMock },
}));

jest.unstable_mockModule('../src/models/Message.js', () => ({
  default: { create: createMessageMock },
}));

let app;
let conversationRoutes;

function encryptAccessToken(plain, secret) {
  const key = Buffer.from(secret, 'utf-8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
}

beforeAll(async () => {
  process.env.META_ACCESS_TOKEN_SECRET = '12345678901234567890123456789012';
  conversationRoutes = (await import('../src/routes/conversationRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'user-1', role: 'admin', tenantId: 'tenant-1' };
    next();
  });
  app.use('/api/conversations', conversationRoutes);
});

beforeEach(() => {
  fetchMock.mockReset();
  findIntegrationMock.mockReset();
  updateConversationMock.mockReset();
  createMessageMock.mockReset();
});

describe('手動回覆 Instagram 對話', () => {
  it('成功回覆時會呼叫 Graph API 並建立對話與訊息紀錄', async () => {
    const secret = process.env.META_ACCESS_TOKEN_SECRET;
    const encryptedToken = encryptAccessToken('ACCESS_TOKEN', secret);
    findIntegrationMock.mockResolvedValue({
      _id: 'integration-1',
      tenantId: 'tenant-1',
      metaAccessToken: encryptedToken,
    });
    const conversationDoc = { _id: 'conversation-db-1', externalId: 'conv-123' };
    updateConversationMock.mockResolvedValue(conversationDoc);
    createMessageMock.mockResolvedValue({ _id: 'message-db-1' });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message_id: 'mid.123' }),
    });

    const res = await request(app)
      .post('/api/conversations/conv-123/replies')
      .send({ recipientId: 'ig-user-1', message: '哈囉' });

    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v19.0/me/messages',
      expect.objectContaining({ method: 'POST' })
    );
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({
      recipient: { id: 'ig-user-1' },
      message: { text: '哈囉' },
    });
    expect(updateConversationMock).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', externalId: 'conv-123' },
      expect.objectContaining({
        $set: expect.objectContaining({
          recipientId: 'ig-user-1',
        }),
        $setOnInsert: expect.objectContaining({
          tenantId: 'tenant-1',
          externalId: 'conv-123',
        }),
      }),
      expect.objectContaining({ upsert: true })
    );
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        direction: 'outbound',
        body: '哈囉',
        recipientId: 'ig-user-1',
        externalMessageId: 'mid.123',
      })
    );
    expect(res.body).toMatchObject({
      conversation: { id: 'conversation-db-1', externalId: 'conv-123' },
      message: { id: 'message-db-1', externalMessageId: 'mid.123' },
      recipientId: 'ig-user-1',
    });
  });

  it('Graph API 失敗時不會寫入資料並回傳錯誤', async () => {
    const secret = process.env.META_ACCESS_TOKEN_SECRET;
    const encryptedToken = encryptAccessToken('ACCESS_TOKEN', secret);
    findIntegrationMock.mockResolvedValue({
      _id: 'integration-1',
      tenantId: 'tenant-1',
      metaAccessToken: encryptedToken,
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid recipient' } }),
    });

    const res = await request(app)
      .post('/api/conversations/conv-999/replies')
      .send({ recipientId: 'bad-user', message: '哈囉' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Invalid recipient' });
    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(createMessageMock).not.toHaveBeenCalled();
  });
});
