// OpenStreetMap XML (.osm) の最小限のパーサ。依存ライブラリなし。
import fs from 'node:fs';

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

const attr = (s, k) => {
  const m = s.match(new RegExp(`\\b${k}="([^"]*)"`));
  return m ? m[1] : undefined;
};

const tagsOf = (body) => {
  const t = {};
  for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\/>/g)) t[decode(m[1])] = decode(m[2]);
  return t;
};

export function parseOsm(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  for (const m of xml.matchAll(/<node ([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const id = attr(m[1], 'id');
    nodes.set(id, { id, lat: Number(attr(m[1], 'lat')), lon: Number(attr(m[1], 'lon')), tags: m[3] ? tagsOf(m[3]) : {} });
  }
  for (const m of xml.matchAll(/<way ([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const id = attr(m[1], 'id');
    ways.set(id, { id, nd: [...m[2].matchAll(/<nd ref="(\d+)"\/>/g)].map((x) => x[1]), tags: tagsOf(m[2]) });
  }
  for (const m of xml.matchAll(/<relation ([^>]*?)>([\s\S]*?)<\/relation>/g)) {
    const id = attr(m[1], 'id');
    const members = [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"\/>/g)].map((x) => ({
      type: x[1],
      ref: x[2],
      role: x[3],
    }));
    relations.set(id, { id, members, tags: tagsOf(m[2]) });
  }
  return { nodes, ways, relations };
}

/** マルチポリゴンのメンバーウェイを端点でつないでリングにする */
export function assembleRings(wayNodeLists) {
  const segs = wayNodeLists.filter((s) => s.length >= 2).map((s) => [...s]);
  const rings = [];
  while (segs.length) {
    let cur = segs.pop();
    let grew = true;
    while (cur[0] !== cur[cur.length - 1] && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = cur[cur.length - 1];
        if (s[0] === end) cur = cur.concat(s.slice(1));
        else if (s[s.length - 1] === end) cur = cur.concat([...s].reverse().slice(1));
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4 && cur[0] === cur[cur.length - 1]) rings.push(cur);
  }
  return rings;
}
