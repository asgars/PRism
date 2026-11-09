import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReviewBatches, loadInstructions, parseInstruction } from '../src/main/instructions';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });
async function fixture() { const folder = await mkdtemp(join(tmpdir(), 'prism-instructions-')); folders.push(folder); return folder; }
describe('instruction loading', () => {
  it('scopes frontmatter patterns and groups files by applicable review instructions', () => {
    const global = parseInstruction('global.md', 'Review correctness.');
    const scoped = parseInstruction('cs.instructions.md', '---\napplyTo: "**/*.{cs,csx}"\n---\nUse C# rules.');
    const { batches } = buildReviewBatches([
      { path: '/src/a.cs', oldPath: '/src/a.cs', change: 'add', lines: [] },
      { path: '/src/b.ts', oldPath: '/src/b.ts', change: 'add', lines: [] },
    ], [global, scoped]);
    expect(batches).toHaveLength(2);
    expect(batches[0].instructions.map((instruction) => instruction.name)).toEqual(['global.md', 'cs.instructions.md']);
    expect(batches[1].instructions.map((instruction) => instruction.name)).toEqual(['global.md']);
    expect(scoped.content).toBe('Use C# rules.');
  });
  it('rejects invalid YAML and unsupported applicability types', () => {
    expect(() => parseInstruction('broken.md', '---\napplyTo: [\n---\nRules')).toThrow('frontmatter');
    expect(() => parseInstruction('broken.md', '---\napplyTo: 123\n---\nRules')).toThrow('applyTo');
  });
  it('loads nested text and markdown in deterministic order and skips dependencies', async () => {
    const root = await fixture();
    await mkdir(join(root, 'nested')); await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'a.md'), 'First'); await writeFile(join(root, 'nested', 'b.txt'), 'Second');
    await writeFile(join(root, 'node_modules', 'ignore.md'), 'Ignore'); await writeFile(join(root, 'binary.png'), 'Ignore');
    expect((await loadInstructions([root])).map((file) => file.content)).toEqual(['First', 'Second']);
  });
  it('fails explicitly instead of silently truncating large instructions', async () => {
    const root = await fixture(); await writeFile(join(root, 'large.md'), 'x'.repeat(160001));
    await expect(loadInstructions([root])).rejects.toThrow('160 KB');
  });
  it('reports removed or inaccessible instruction folders', async () => {
    const root = await fixture();
    await expect(loadInstructions([join(root, 'missing')])).rejects.toThrow();
  });
});