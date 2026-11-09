import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Keep browser dependencies local so both the server and static export work offline.
const root = new URL('../', import.meta.url);
const files = [
  ['prismjs/components/prism-core.min.js', 'prism-core.min.js'],
  ['prismjs/components/prism-sql.min.js', 'prism-sql.min.js'],
  ['sql-formatter/dist/sql-formatter.min.js', 'sql-formatter.min.js'],
];
await mkdir(new URL('public/vendor/', root), { recursive: true });
for (const [source, destination] of files) {
  const content = await readFile(new URL(`node_modules/${source}`, root));
  await writeFile(new URL(`public/vendor/${destination}`, root), content);
}
const licenses = await Promise.all(
  [
    ['prismjs', 'LICENSE'],
    ['sql-formatter', 'LICENSE'],
  ].map(async ([name, licenseFile]) => {
    const pkg = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root)));
    const license = await readFile(new URL(`node_modules/${name}/${licenseFile}`, root), 'utf8');
    return `${name} ${pkg.version}\n\n${license}`;
  }),
);
// nearley's bundled runtime uses the same MIT grant. Preserve its upstream notice:
// https://github.com/kach/nearley/blob/master/LICENSE.txt
const nearley = JSON.parse(await readFile(new URL('node_modules/nearley/package.json', root)));
const mit = await readFile(new URL('node_modules/prismjs/LICENSE', root), 'utf8');
licenses.push(
  `nearley ${nearley.version}\n\n${mit.replace('Copyright (c) 2012 Lea Verou', 'Copyright (c) 2014, 2015, 2016, 2017, 2018, 2019 Kartik Chandra, Tim Radvan')}`,
);
await writeFile(new URL('public/vendor/LICENSES.md', root), licenses.join('\n\n---\n\n'));
console.log('SQL 편집기 브라우저 라이브러리 동기화 완료');
