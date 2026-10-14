import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { completionUrl, ModelSettings } from './model';

export class ModelSettingsStore {
  constructor(private path: string) {}
  private publicSettings(input: ModelSettings): ModelSettings {
    if (typeof input?.baseUrl !== 'string' || typeof input?.modelName !== 'string' || !input.modelName.trim()) {
      throw new Error('INVALID_SETTINGS');
    }
    completionUrl(input.baseUrl);
    return { baseUrl: input.baseUrl, modelName: input.modelName };
  }
  async load(): Promise<ModelSettings | null> {
    let text: string;
    try { text = await readFile(this.path, 'utf8'); }
    catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
    return this.publicSettings(JSON.parse(text));
  }
  async save(input: ModelSettings): Promise<void> {
    const settings = this.publicSettings(input);
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(settings), { mode: 0o600 });
    await rename(temp, this.path);
  }
}
