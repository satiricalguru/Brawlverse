// Syntax-checks every JS file in the repo the same way CI does, so a parse error
// is caught on the machine that wrote it instead of in a pull request.
// Run it with `npm run check`.
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function jsFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await jsFiles(rel)));
    else if (/\.(js|mjs)$/.test(entry.name)) found.push(rel);
  }
  return found;
}

const check = (file) =>
  new Promise((resolve) => {
    execFile(process.execPath, ['--check', join(root, file)], (err, _stdout, stderr) => {
      if (!err) return resolve(null);
      const reason = (stderr || err.message).trim().split('\n')[0];
      resolve(`${relative(root, join(root, file))}: ${reason}`);
    });
  });

const files = [...(await jsFiles('src')), ...(await jsFiles('tools'))].sort();
let failed = 0;

for (const file of files) {
  const error = await check(file);
  if (error) {
    failed++;
    console.error(`fail  ${error}`);
  } else {
    console.log(`ok    ${file}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} files parse cleanly.`);
process.exit(failed ? 1 : 0);
