import { MAX_REPLY_VARIANTS, type Message, type ReplyVariant } from './types';

export function replyVariants(message: Message): ReplyVariant[] {
  return message.variants ?? [{ id: message.id, content: message.content, createdAt: message.createdAt, editedAt: message.editedAt }];
}

export function selectReply(message: Message, index: number): Message {
  if (message.role !== 'assistant') throw new Error('Only companion replies have alternatives.');
  const variants = replyVariants(message);
  const selected = variants[index];
  if (!selected) throw new Error('That reply is not available.');
  return { ...message, content: selected.content, createdAt: selected.createdAt, editedAt: selected.editedAt, variants, selectedVariant: index };
}

export function addReply(message: Message, variant: ReplyVariant): Message {
  const variants = replyVariants(message);
  if (variants.length >= MAX_REPLY_VARIANTS) throw new Error(`You can keep up to ${MAX_REPLY_VARIANTS} replies for one message.`);
  return selectReply({ ...message, variants: [...variants, variant] }, variants.length);
}

export function editMessage(message: Message, text: string): Message {
  const content = text.trim();
  if (!content || content.length > 30000) throw new Error('Use between 1 and 30,000 characters.');
  if (content === message.content) return message;
  const editedAt = new Date().toISOString();
  if (message.role === 'user') return { ...message, content, editedAt };
  const selectedVariant = message.selectedVariant ?? 0;
  const variants = replyVariants(message).map((variant, index) => index === selectedVariant ? { ...variant, content, editedAt } : variant);
  return selectReply({ ...message, variants }, selectedVariant);
}

/** Regeneration sees the conversation before this answer, never its alternatives. */
export function regenerationHistory(messages: Message[], messageId: string): Message[] {
  const index = messages.findIndex(message => message.id === messageId);
  if (index < 0 || messages[index].role !== 'assistant') throw new Error('Choose a companion reply to regenerate.');
  const history = messages.slice(0, index);
  if (!history.some(message => message.role === 'user')) throw new Error('Send a message before generating another reply.');
  return history;
}
