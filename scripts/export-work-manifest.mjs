/** Export the actual TypeScript lists, rather than trying to parse them with regexes. */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.data/tmdb');
await mkdir(dir, { recursive: true });
const bundle = path.join(dir, 'manifest.cjs');
await build({
  stdin: { contents: `
    import data from './film-poster-data.json';
    import { filmCollections, koreanModernHistory } from './film-collections';
    import { peopleCollections } from './people-collections';
    import { koreanBoxOfficeCollection } from './korean-box-office-collection';
    import { chungmuroCollection } from './chungmuro-collection';
    import { koreanThrillers, zhangYanThrillers } from './korean-thrillers';
    const records = new Map(Object.entries(data).map(([key, meta]) => [key, {
      key, title: key.slice(0, key.lastIndexOf('|')), year: Number(key.slice(key.lastIndexOf('|') + 1)),
      mediaType: meta.mediaType || 'unknown', ...meta,
    }]));
    const add = (title, year, mediaType, person, role) => {
      const key = title + '|' + year;
      const item = records.get(key) || { key, title, year, mediaType };
      if (item.mediaType === 'unknown') item.mediaType = mediaType;
      if (person) item[role] = [...new Set([...(item[role] || '').split(/[,，、/]/).map(s => s.trim()).filter(Boolean), person])].join(' / ');
      records.set(key, item);
    };
    for (const collection of [...filmCollections, koreanModernHistory, koreanBoxOfficeCollection, chungmuroCollection, ...peopleCollections]) {
      for (const section of collection.sections) for (const [title, year] of section.films) {
        const role = collection.role === 'director' || (collection.role === 'both' && /^(导演|执导|自导)/.test(section.label)) ? 'director' : 'cast';
        add(title, year, section.mediaType || 'movie', collection.fullName, role);
      }
    }
    for (const [, title, year] of [...koreanThrillers, ...zhangYanThrillers]) add(title, year, 'movie');
    export default [...records.values()].sort((a,b) => a.key.localeCompare(b.key));
  `, resolveDir: path.join(root, 'src/lib'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle,
});
const records = createRequire(import.meta.url)(bundle).default;
await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(records, null, 2) + '\n');
console.log(`Exported ${records.length} title/year records to .data/tmdb/manifest.json`);
