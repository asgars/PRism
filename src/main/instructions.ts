import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { minimatch } from 'minimatch';
import type { ChangedFile } from '../shared/types';

export interface ReviewInstruction { name: string; content: string; patterns: string[] }

export function parseInstruction(name: string, text: string): ReviewInstruction {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!frontmatter) { return { name, content: text, patterns: ['**'] }; }
  const document = parseDocument(frontmatter[1]);
  if (document.errors.length) { throw new Error(`Invalid instruction frontmatter in ${name}: ${document.errors[0].message}`); }
  const metadata = document.toJS() as { applyTo?: unknown } | null;
  const applyTo = metadata?.applyTo;
  if (applyTo !== undefined && typeof applyTo !== 'string' && !(Array.isArray(applyTo) && applyTo.every((pattern) => typeof pattern === 'string'))) {
    throw new Error(`applyTo must be a string or a string array in ${name}`);
  }
  const patterns = applyTo === undefined ? ['**'] : typeof applyTo === 'string' ? applyTo.split(/,(?![^{]*\})/).map((pattern) => pattern.trim()).filter(Boolean) : applyTo as string[];
  return { name, content: text.slice(frontmatter[0].length), patterns };
}

export function buildReviewBatches(files: ChangedFile[], instructions: ReviewInstruction[]) {
  const batches: { content: string; paths: string[]; instructions: ReviewInstruction[]; signature: string }[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const content = JSON.stringify({ path: file.path, oldPath: file.oldPath, change: file.change, lines: file.lines });
    if (content.length > 120_000) { warnings.push(`${file.path}: exceeds the per-file model context limit; not reviewed`); continue; }
    const matching = instructions.filter((instruction) => instruction.patterns.some((pattern) => minimatch(file.path.replace(/^\//, ''), pattern, { dot: true })));
    const signature = JSON.stringify(matching.map((instruction) => instruction.name));
    let batch = batches.find((candidate) => candidate.signature === signature && candidate.content.length + content.length <= 120_000);
    if (!batch) { batch = { content: '', paths: [], instructions: matching, signature }; batches.push(batch); }
    batch.content += `${content}\n`; batch.paths.push(file.path);
  }
  return { batches, warnings };
}

export async function loadInstructions(folders: string[]) {
  const files: ReviewInstruction[] = [];
  let bytes = 0;
  async function visit(root: string, directory: string, depth: number) {
    if (depth > 12) { throw new Error('Instruction folders exceed the maximum nesting depth of 12.'); }
    const entries = (await readdir(directory, { withFileTypes: true })).sort((first, second) => first.name.localeCompare(second.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || ['node_modules', '.git', 'out', 'release'].includes(entry.name)) { continue; }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await visit(root, path, depth + 1); }
      else if (/\.(md|txt)$/i.test(entry.name)) {
        const info = await lstat(path);
        if (info.isSymbolicLink()) { continue; }
        bytes += info.size;
        if (bytes > 160_000 || files.length >= 100) { throw new Error('Instruction folders exceed 100 files or 160 KB. Choose a smaller review-specific folder.'); }
        const content = await readFile(path, 'utf8');
        if (content.includes('\0')) { throw new Error(`Instruction file is not text: ${entry.name}`); }
        files.push(parseInstruction(`${root}/${relative(root, path).replaceAll('\\', '/')}`, content));
      }
    }
  }
  for (const folder of folders) { await visit(folder, folder, 0); }
  return files;
}