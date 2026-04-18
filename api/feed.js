const PEOPLE = {
  nick: { name: 'Nick Ostroff', feed: 'https://nickostroff.com/feed.xml' },
  peter: { name: 'Peter Ostroff', feed: 'https://www.peterostroff.com/feed.xml' },
};

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function pick(block, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? decode(m[1]) : '';
}

function pickAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["']`, 'i');
  const m = block.match(re);
  return m ? decode(m[1]) : '';
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, '').trim() + '…';
}

function findImage(block, description) {
  return (
    pickAttr(block, 'media:thumbnail', 'url') ||
    pickAttr(block, 'media:content', 'url') ||
    pickAttr(block, 'enclosure', 'url') ||
    (description.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? '')
  );
}

function parseFeed(xml, person, key) {
  const items = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[0];
    const rawDesc = pick(block, 'description') || pick(block, 'content:encoded');
    items.push({
      title: pick(block, 'title'),
      link: pick(block, 'link'),
      date: pick(block, 'pubDate') || pick(block, 'dc:date'),
      summary: truncate(stripHtml(rawDesc), 180),
      image: findImage(block, rawDesc),
      author: person.name,
      authorKey: key,
    });
  }
  return items;
}

export default async function handler(req, res) {
  const raw = String(req.query?.who || '');
  const keys = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!keys.length || keys.some((k) => !PEOPLE[k])) {
    res.status(400).json({ error: 'unknown source' });
    return;
  }

  try {
    const results = await Promise.all(
      keys.map(async (key) => {
        const person = PEOPLE[key];
        const upstream = await fetch(person.feed, {
          headers: { 'user-agent': 'ostroff.la/1.0 (+https://ostroff.la)' },
        });
        if (!upstream.ok) throw new Error(`${key}: upstream ${upstream.status}`);
        return parseFeed(await upstream.text(), person, key);
      }),
    );

    const merged = results.flat().sort((a, b) => {
      const da = new Date(a.date).getTime() || 0;
      const db = new Date(b.date).getTime() || 0;
      return db - da;
    });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ items: merged });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
