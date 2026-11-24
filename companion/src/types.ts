import { z } from 'zod';

export const companionSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(40),
  subtitle: z.string().max(120), description: z.string().max(1000),
  traits: z.array(z.string().max(30)).max(6), artwork: z.string().max(2048),
  tint: z.enum(['rose', 'lavender', 'sage']),
  prompt: z.string().min(1).max(12000), greeting: z.string().max(2000),
  memory: z.string().max(8000), voiceId: z.string().max(120),
});
export const settingsSchema = z.object({
  provider: z.enum(['demo', 'ollama', 'openrouter']),
  model: z.string().max(200), baseUrl: z.string().max(500),
  temperature: z.number().min(0).max(2), maxTokens: z.number().int().min(64).max(8192),
  contextMessages: z.number().int().min(2).max(100),
  conversationPrompt: z.string().max(12000).default(''),
  responseStyle: z.string().max(6000).default(''),
  voice: z.enum(['off', 'browser', 'elevenlabs']),
  voiceModel: z.string().max(100), sound: z.boolean(), motion: z.boolean(),
  theme: z.enum(['light', 'dark']).default('light'),
  background: z.enum(['tea', 'evening', 'garden']),
});
export const MAX_REPLY_VARIANTS = 20;
export const replyVariantSchema = z.object({
  id: z.string().min(1).max(100), content: z.string().max(30000),
  createdAt: z.string().max(50), editedAt: z.string().max(50).optional(),
});
export const messageSchema = z.object({
  id: z.string().max(100), role: z.enum(['user', 'assistant']),
  content: z.string().max(30000), createdAt: z.string().max(50),
  editedAt: z.string().max(50).optional(),
  variants: z.array(replyVariantSchema).min(1).max(MAX_REPLY_VARIANTS).optional(),
  selectedVariant: z.number().int().min(0).max(MAX_REPLY_VARIANTS - 1).optional(),
}).superRefine((message, context) => {
  if (message.variants) {
    if (message.role !== 'assistant') context.addIssue({ code: 'custom', path: ['variants'], message: 'Only companion replies can have alternatives.' });
    const selected = message.variants[message.selectedVariant ?? 0];
    if (!selected || selected.content !== message.content) context.addIssue({ code: 'custom', path: ['selectedVariant'], message: 'The selected alternative must match the displayed reply.' });
  } else if (message.selectedVariant !== undefined) {
    context.addIssue({ code: 'custom', path: ['selectedVariant'], message: 'A selected alternative requires saved alternatives.' });
  }
});
export const appStateSchema = z.object({
  version: z.literal(1), companions: z.array(companionSchema).min(1).max(30),
  activeId: z.string().max(80), settings: settingsSchema,
  chats: z.record(z.string().max(80), z.array(messageSchema).max(200)),
});
export type Companion = z.infer<typeof companionSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ReplyVariant = z.infer<typeof replyVariantSchema>;
export type AppState = z.infer<typeof appStateSchema>;
export type Secrets = { openrouter: string; elevenlabs: string };
