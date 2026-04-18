const FEEDS = {
  nick: 'https://nickostroff.com/feed.xml',
  peter: 'https://www.peterostroff.com/feed.xml',
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

export default async function handler(req, res) {
  const who = String(req.query?.who || '');
  const feedUrl = FEEDS[who];
  if (!feedUrl) {
    res.status(400).json({ error: 'unknown source' });
    return;
  }

  try {
    const upstream = await fetch(feedUrl, {
      headers: { 'user-agent': 'ostroff.la/1.0 (+https://ostroff.la)' },
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const xml = await upstream.text();

    const items = [];
    const re = /<item\b[\s\S]*?<\/item>/gi;
    let m;
    while ((m = re.exec(xml)) !== null && items.length < 5) {
      const block = m[0];
      items.push({
        title: pick(block, 'title'),
        link: pick(block, 'link'),
        date: pick(block, 'pubDate') || pick(block, 'dc:date'),
      });
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({ items });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
