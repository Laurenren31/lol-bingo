// 下載英雄方形頭像到 public/champions/{slug}.webp
//
// 官網 https://www.leagueoflegends.com/zh-tw/champions/ 的英雄圖片來自 Riot 的 Data Dragon。
// 這裡用 Data Dragon 的 champion.json 把 champions.json 的 slug 對應到圖片代號
// （例如 monkeyking → MonkeyKing），下載 tiles 方形圖，縮成 200×200 的 webp。
//
// 用法：npm run images            （已存在的會略過）
//       npm run images -- --force  （全部重抓）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CHAMPIONS } from '../shared/champions';

const OUT = path.resolve(__dirname, '..', 'public', 'champions');
const force = process.argv.includes('--force');
const TILE_ALIAS: Record<string, string> = { Fiddlesticks: 'FiddleSticks' };

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const [version] = await json<string[]>('https://ddragon.leagueoflegends.com/api/versions.json');
  const dd = await json<{ data: Record<string, { id: string }> }>(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_TW/champion.json`,
  );
  const keyOf = new Map(Object.values(dd.data).map((c) => [c.id.toLowerCase(), c.id]));
  console.log(`Data Dragon ${version}，共 ${keyOf.size} 位英雄`);

  const missing: string[] = [];
  let done = 0;
  const queue = [...CHAMPIONS];
  async function worker() {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const file = path.join(OUT, `${c.slug}.webp`);
      if (!force && existsSync(file)) {
        done++;
        continue;
      }
      const key = keyOf.get(c.slug);
      if (!key) {
        missing.push(`${c.name}（${c.slug}）`);
        continue;
      }
      // Data Dragon 的 tiles 有少數檔名大小寫不同（例如 FiddleSticks），最後退回版本化的方形頭像
      const candidates = [
        `https://ddragon.leagueoflegends.com/cdn/img/champion/tiles/${key}_0.jpg`,
        ...(TILE_ALIAS[key] ? [`https://ddragon.leagueoflegends.com/cdn/img/champion/tiles/${TILE_ALIAS[key]}_0.jpg`] : []),
        `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${key}.png`,
      ];
      let buf: Buffer | null = null;
      for (const url of candidates) {
        const r = await fetch(url);
        if (r.ok) {
          buf = Buffer.from(await r.arrayBuffer());
          break;
        }
      }
      if (!buf) {
        missing.push(`${c.name}（${candidates.join('、')} 都失敗）`);
        continue;
      }
      writeFileSync(file, await sharp(buf).resize(200, 200, { fit: 'cover' }).webp({ quality: 72 }).toBuffer());
      done++;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`完成 ${done}/${CHAMPIONS.length}`);
  if (missing.length) {
    console.error('以下英雄沒有抓到圖片：\n  ' + missing.join('\n  '));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
