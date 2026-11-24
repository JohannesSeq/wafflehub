import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { providerKeyPatchSchema, providerKeysSchema, type KeyStore, type ProviderKeyPatch, type ProviderKeys } from './credentials';

/** Local Node-only storage. This module is never imported by the Worker. */
export function createFileKeyStore(filename: string): KeyStore {
  let queue = Promise.resolve();
  async function read(): Promise<ProviderKeys> {
    let raw: string;
    try { raw = await readFile(filename, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error('Local API keys could not be read.'); }
    try {
      if (raw.length > 8192) throw new Error('Invalid local credentials file.');
      return providerKeysSchema.parse(JSON.parse(raw));
    } catch { throw new Error('The local API key file could not be read. Existing keys were left unchanged.'); }
  }
  function update(input: ProviderKeyPatch) {
    const patch = providerKeyPatchSchema.parse(input);
    const operation = queue.catch(() => {}).then(async () => {
      const keys = await read();
      for (const name of ['openrouter', 'elevenlabs'] as const) {
        if (patch[name] === null) delete keys[name];
        else if (patch[name] !== undefined) keys[name] = patch[name];
      }
      const directory = dirname(filename);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const temporary = join(directory, `.provider-keys-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(keys, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        await rename(temporary, filename);
      } finally { await rm(temporary, { force: true }); }
    });
    queue = operation;
    return operation;
  }
  return { read, update };
}
