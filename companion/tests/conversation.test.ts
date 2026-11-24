import test from 'node:test';
import assert from 'node:assert/strict';
import { addReply, editMessage, regenerationHistory, replyVariants, selectReply } from '../src/conversation';
import { MAX_REPLY_VARIANTS, messageSchema, type Message } from '../src/types';

const answer: Message = { id: 'answer', role: 'assistant', content: 'Original reply.', createdAt: '2026-11-23T12:00:00Z' };
const alternate = { id: 'alternative', content: 'Another perspective.', createdAt: '2026-11-23T12:01:00Z' };

test('legacy messages remain valid and supply an original swipe', () => {
  assert.deepEqual(messageSchema.parse(answer), answer);
  assert.deepEqual(replyVariants(answer), [{ id: answer.id, content: answer.content, createdAt: answer.createdAt, editedAt: undefined }]);
});

test('regenerating preserves the original and selects the new reply', () => {
  const message = addReply(answer, alternate);
  assert.equal(message.id, answer.id);
  assert.equal(message.content, alternate.content);
  assert.equal(message.selectedVariant, 1);
  assert.equal(message.variants?.[0].content, answer.content);
  assert.equal(message.variants?.length, 2);
  assert.equal(messageSchema.safeParse(message).success, true);
  assert.equal(answer.variants, undefined);
});

test('selecting an older reply restores its text and timestamp without losing alternatives', () => {
  const message = selectReply(addReply(answer, alternate), 0);
  assert.equal(message.content, answer.content);
  assert.equal(message.createdAt, answer.createdAt);
  assert.equal(message.selectedVariant, 0);
  assert.equal(message.variants?.length, 2);
  assert.throws(() => selectReply(message, -1));
  assert.throws(() => selectReply(message, 2));
});

test('editing a selected companion reply leaves other swipes intact', () => {
  const message = editMessage(addReply(answer, alternate), '  A revised alternative.  ');
  assert.equal(message.content, 'A revised alternative.');
  assert.ok(message.editedAt);
  assert.equal(message.variants?.[1].content, message.content);
  assert.equal(message.variants?.[0].content, answer.content);
  assert.equal(selectReply(message, 0).editedAt, undefined);
  assert.equal(messageSchema.safeParse(message).success, true);
});

test('editing a user message keeps its identity and rejects empty or oversized edits', () => {
  const user: Message = { ...answer, role: 'user' };
  const edited = editMessage(user, 'My revised question.');
  assert.equal(edited.id, user.id);
  assert.equal(edited.createdAt, user.createdAt);
  assert.ok(edited.editedAt);
  assert.equal(edited.variants, undefined);
  assert.equal(editMessage(user, user.content), user);
  assert.throws(() => editMessage(user, '  '));
  assert.throws(() => editMessage(user, 'x'.repeat(30001)));
});

test('regeneration uses only the preceding conversation and keeps later messages untouched', () => {
  const user: Message = { ...answer, id: 'question', role: 'user', content: 'A question.' };
  const later: Message = { ...user, id: 'later', content: 'A later question.' };
  const conversation = [{ ...answer, id: 'greeting' }, user, addReply(answer, alternate), later];
  const before = JSON.stringify(conversation);
  const history = regenerationHistory(conversation, answer.id);
  assert.deepEqual(history.map(message => message.id), ['greeting', 'question']);
  assert.equal(JSON.stringify(conversation), before);
  assert.throws(() => regenerationHistory(conversation, 'greeting'), /Send a message/);
  assert.throws(() => regenerationHistory(conversation, user.id), /companion reply/);
});

test('reply storage rejects mismatched selections and stays within its bounded limit', () => {
  assert.equal(messageSchema.safeParse({ ...answer, variants: [alternate], selectedVariant: 0 }).success, false);
  assert.equal(messageSchema.safeParse({ ...answer, selectedVariant: 0 }).success, false);
  let message = answer;
  for (let i = 1; i < MAX_REPLY_VARIANTS; i++) message = addReply(message, { ...alternate, id: `reply-${i}` });
  assert.equal(message.variants?.length, MAX_REPLY_VARIANTS);
  assert.throws(() => addReply(message, alternate), /up to 20/);
  assert.equal(messageSchema.safeParse(message).success, true);
});
