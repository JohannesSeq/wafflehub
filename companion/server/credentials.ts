import { z } from 'zod';

const credential = z.string().trim().min(1).max(1000).regex(/^\S+$/, 'API keys cannot contain whitespace.');
export const providerKeysSchema = z.object({ openrouter: credential.optional(), elevenlabs: credential.optional() }).strict();
export const providerKeyPatchSchema = z.object({
  openrouter: credential.nullable().optional(),
  elevenlabs: credential.nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Choose a key to save or remove.');
export type ProviderKeys = z.infer<typeof providerKeysSchema>;
export type ProviderKeyPatch = z.infer<typeof providerKeyPatchSchema>;
export interface KeyStore {
  read(): Promise<ProviderKeys>;
  update(patch: ProviderKeyPatch): Promise<void>;
}
