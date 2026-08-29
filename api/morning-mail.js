export const config = { runtime: 'edge' };

export default async function handler() {
  const raw = process.env.MORNING_MAIL_JSON || '';
  if (!raw) {
    return new Response(JSON.stringify({ error: 'mail log not loaded' }), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }
  return new Response(raw, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
