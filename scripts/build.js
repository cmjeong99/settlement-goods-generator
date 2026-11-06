import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { browserAssets } from './assets.js';
import { runtime } from '../public/runtime-config.js';

const projectRoot = new URL('../', import.meta.url);
export const outputDirectory = new URL('dist/', projectRoot);

export async function buildSite() {
  const rootPath = fileURLToPath(projectRoot);
  const outputPath = fileURLToPath(outputDirectory);
  if (resolve(outputPath) !== resolve(rootPath, 'dist')) throw new Error('잘못된 빌드 경로입니다.');
  // Read the complete allowlist before replacing a previous successful build.
  const assets = await Promise.all(
    browserAssets.map(async (name) => [
      name,
      await readFile(new URL(`public/${name}`, projectRoot)),
    ]),
  );
  if (runtime.mode !== 'static' || runtime.aiEnabled !== false) {
    throw new Error('배포용 runtime-config.js는 static 모드이며 AI가 비활성화되어야 합니다.');
  }
  // This target is fixed relative to this module, never a caller-supplied path.
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, content] of assets) {
    const destination = new URL(name, outputDirectory);
    await mkdir(new URL('./', destination), { recursive: true });
    await writeFile(destination, content);
  }
  await writeFile(new URL('.nojekyll', outputDirectory), '');
  return readdir(outputDirectory, { recursive: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
  console.log(`정적 사이트 빌드 완료: ${fileURLToPath(outputDirectory)}`);
}
