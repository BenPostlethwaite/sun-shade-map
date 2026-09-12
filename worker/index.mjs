const UPSTREAM = 'https://admiraltyapi.azure-api.net/uktidalapi/api/V1/Stations';
const ORIGINS = new Set(['https://benpostlethwaitesheff.github.io', 'http://127.0.0.1:8000']);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store', 'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
    };
    if (origin && ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers});
    if (origin && !ORIGINS.has(origin)) return reply({error:'Origin not allowed'}, 403);
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:{...headers, 'Access-Control-Allow-Methods':'GET, OPTIONS'}});
    if (request.method !== 'GET') return reply({error:'Method not allowed'}, 405);
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') return reply({service:'Sun Shade Map tides', configured:Boolean(env.ADMIRALTY_API_KEY)});
    let endpoint;
    if (url.pathname === '/stations' && !url.search) endpoint = UPSTREAM;
    else if (url.pathname === '/events' && [...url.searchParams.keys()].every(k => k === 'station') &&
      url.searchParams.getAll('station').length === 1 && /^[0-9]{4}[A-Za-z]?$/.test(url.searchParams.get('station') || '')) {
      endpoint = `${UPSTREAM}/${encodeURIComponent(url.searchParams.get('station'))}/TidalEvents?duration=7`;
    } else return reply({error:'Use /stations or /events?station=STATION_ID'}, 400);
    if (!env.ADMIRALTY_API_KEY) return reply({error:'Set the ADMIRALTY_API_KEY Worker secret first'}, 503);
    try {
      const response = await fetch(endpoint, {
        headers:{'Ocp-Apim-Subscription-Key':env.ADMIRALTY_API_KEY, Accept:'application/json'},
        redirect:'manual', signal:AbortSignal.timeout(15000), cache:'no-store',
      });
      if (!response.ok) return reply({error:response.status === 429 ? 'ADMIRALTY quota reached' : 'ADMIRALTY request failed', upstreamStatus:response.status}, response.status === 429 ? 429 : 502);
      return reply(await response.json());
    } catch { return reply({error:'Unable to reach ADMIRALTY'}, 502); }
  },
};
