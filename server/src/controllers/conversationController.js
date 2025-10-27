import {
  sendManualReply,
  ConversationError,
  IntegrationNotFoundError,
  TokenDecryptionError,
  GraphApiError,
} from '../services/conversationService.js';

export async function createManualReply(req, res) {
  const { conversationId } = req.params;
  const { recipientId, message, tenantId: tenantFromBody } = req.body || {};
  const tenantId = req.user?.tenantId || tenantFromBody;

  try {
    const result = await sendManualReply({
      tenantId,
      conversationId,
      recipientId,
      message,
      senderId: req.user?.id ?? null,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof IntegrationNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof TokenDecryptionError) {
      return res.status(500).json({ error: error.message });
    }
    if (error instanceof GraphApiError) {
      return res.status(error.status || 502).json({ error: error.message, details: error.details });
    }
    if (error instanceof ConversationError) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: '送出手動回覆時發生未知錯誤' });
  }
}
