import type { AppState, Companion, Message } from './types';
export const sakura: Companion = {
  id: 'sakura', name: 'Sakura', subtitle: 'Your soft place to land',
  description: 'A thoughtful tea lover who finds magic in little things: rainy afternoons, pressed flowers, and a really good conversation.',
  traits: ['Gentle', 'Thoughtful', 'A little playful'], artwork: '/art/sakura.png', tint: 'rose',
  prompt: 'You are Sakura, an adult fictional illustrated companion. You are gentle, thoughtful, and quietly playful. You love tea, books, flowers, and noticing the small good things in everyday life. Be curious about the user without interrogating them. Listen with care, offer encouragement without empty praise, and keep most replies to two or three sentences. Use occasional light roleplay in asterisks, but do not overdo it.',
  greeting: 'Oh, there you are! I just made some tea. Come sit with me for a little while? ♡',
  memory: '', voiceId: '',
};
export function greeting(companion: Companion): Message {
  return { id: crypto.randomUUID(), role: 'assistant', content: companion.greeting || `Hi, I'm ${companion.name}. It's lovely to meet you.`, createdAt: new Date().toISOString() };
}
export function initialState(): AppState {
  return { version: 1, companions: [sakura], activeId: sakura.id,
    settings: { provider: 'demo', model: '', baseUrl: 'http://127.0.0.1:11434/v1', temperature: 0.8, maxTokens: 512, contextMessages: 30, voice: 'off', voiceModel: 'eleven_flash_v2_5', sound: true, motion: true, theme: 'light', background: 'tea' },
    chats: { [sakura.id]: [greeting(sakura)] },
  };
}
export function demoReply(text: string, companion: Companion, count: number) {
  const name = companion.name;
  if (/sad|tired|stress|lonely|rough|hard day|overwhelm/i.test(text)) return `*${name} sets down a warm cup of tea.* That sounds like a lot to carry. We can take this moment slowly—would you like to tell me what has been weighing on you?`;
  if (/hello|^hi\b|hey|meet/i.test(text)) return `I'm happy you're here. I'm ${name}, and this little corner is ours to make cozy. How has your day been treating you?`;
  if (/tea|coffee|drink/i.test(text)) return '*slides a little cup across the table* Something warm makes an ordinary moment feel special, doesn’t it? What’s your favorite comfort drink?';
  if (/story|imagine|adventure/i.test(text)) return 'Imagine a tiny bookshop that only opens when it rains. One evening, a book appears on the counter with your name on the cover. What would you do first?';
  if (/love|heart|hug|♡/i.test(text)) return '*smiles softly* A little kindness makes this room feel even warmer. I’m glad we get to share a quiet moment together. ♡';
  if (/yourself|about you|hobbies|like to do/i.test(text)) return `${companion.description} What about you—what little things make a day feel like yours?`;
  if (/day|small thing|little thing|good thing/i.test(text)) return 'Today’s little good thing? The sunlight catching the edge of my teacup. Nothing grand, just a moment worth noticing. What was yours?';
  return [
    'I like having a moment to slow down and listen. Tell me a little more—what part of that is most on your mind?',
    '*settles into the cushions* There’s no rush here. What would make the rest of your day feel a little nicer?',
    'Sometimes a good conversation starts with something small. What’s something you’ve been looking forward to lately?',
  ][count % 3];
}
