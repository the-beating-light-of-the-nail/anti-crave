// Vercel Function: community check-ins + craving votes.
// Storage: Upstash Redis REST. Optional — without env vars the frontend
// automatically falls back to local seeded counts.
import { createHash } from 'node:crypto';

const PREFIX = 'anticrave:';
const DISH_IDS = ['tteokbokki', 'burger', 'chicken', 'sushi', 'ramen', 'pizza', 'fries', 'milktea'];
const SIDES = new Set(['quit', 'hungry']);

// Small demo baseline so a brand-new poll does not look broken.
// Set every number to 0 to run a fully organic board.
const SEED = {
  tteokbokki: { quit: 132, hungry: 11 },
  burger: { quit: 148, hungry: 16 },
  chicken: { quit: 197, hungry: 18 },
  sushi: { quit: 109, hungry: 9 },
  ramen: { quit: 175, hungry: 19 },
  pizza: { quit: 121, hungry: 21 },
  fries: { quit: 96, hungry: 14 },
  milktea: { quit: 168, hungry: 12 },
};

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 172800;

function send(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

function localMode(res) {
  return send(res, 200, { ok: true, mode: 'local' });
}

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function pipeline(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const data = await res.json();
  return data.map((entry) => {
    if (entry && entry.error) throw new Error(entry.error);
    return entry ? entry.result : null;
  });
}

function hashToObject(raw) {
  const out = {};
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) out[raw[i]] = raw[i + 1];
  } else if (raw && typeof raw === 'object') {
    Object.assign(out, raw);
  }
  return out;
}

function buildVotes(raw) {
  const hash = hashToObject(raw);
  const votes = {};
  for (const id of DISH_IDS) {
    const seed = SEED[id] || { quit: 0, hungry: 0 };
    votes[id] = {
      quit: Math.max(0, Number(hash[`${id}:quit`]) || 0) + seed.quit,
      hungry: Math.max(0, Number(hash[`${id}:hungry`]) || 0) + seed.hungry,
    };
  }
  return votes;
}

function safeDate(value) {
  const fallback = new Date().toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(t)) return fallback;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (Math.abs(t - todayUtc) > 86400000 * 1.5) return fallback;
  return value;
}

function safeDevId(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
}

function ipHash(req) {
  const raw = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '')
    .split(',')[0]
    .trim();
  if (!raw) return 'anon';
  return createHash('sha256').update(`anticrave:${raw}`).digest('hex').slice(0, 16);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function stats(date) {
  const [checkins, rawVotes] = await pipeline([
    ['SCARD', `${PREFIX}checkins:${date}`],
    ['HGETALL', `${PREFIX}votes`],
  ]);
  return {
    pulse: Number(checkins) || 0,
    votes: buildVotes(rawVotes),
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (!REDIS_URL || !REDIS_TOKEN) {
    localMode(res);
    return;
  }

  try {
    const url = new URL(req.url, 'https://anticrave.local');

    if (req.method === 'GET') {
      const date = safeDate(url.searchParams.get('date'));
      const data = await stats(date);
      send(res, 200, { ok: true, mode: 'live', stats: data });
      return;
    }

    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    const body = await readBody(req);
    const action = String(body.action || '');
    const date = safeDate(body.date);
    const devId = safeDevId(body.devId);
    if (devId.length < 6) {
      send(res, 400, { ok: false, error: 'invalid_device' });
      return;
    }

    const ip = ipHash(req);
    const [devCount, ipCount] = await pipeline([
      ['INCR', `${PREFIX}rl:${date}:dev:${devId}`],
      ['INCR', `${PREFIX}rl:${date}:ip:${ip}`],
      ['EXPIRE', `${PREFIX}rl:${date}:dev:${devId}`, TTL],
      ['EXPIRE', `${PREFIX}rl:${date}:ip:${ip}`, TTL],
    ]);
    if (Number(devCount) > 80 || Number(ipCount) > 320) {
      send(res, 429, { ok: false, error: 'rate_limited' });
      return;
    }

    if (action === 'checkin') {
      const [, count] = await pipeline([
        ['SADD', `${PREFIX}checkins:${date}`, devId],
        ['SCARD', `${PREFIX}checkins:${date}`],
        ['EXPIRE', `${PREFIX}checkins:${date}`, TTL],
      ]);
      send(res, 200, {
        ok: true,
        mode: 'live',
        stats: { pulse: Number(count) || 0 },
      });
      return;
    }

    if (action === 'vote') {
      const dish = String(body.dish || '');
      const side = String(body.side || '');
      if (!DISH_IDS.includes(dish) || !SIDES.has(side)) {
        send(res, 400, { ok: false, error: 'invalid_vote' });
        return;
      }
      const voteKey = `${PREFIX}vote:${date}:${devId}:${dish}`;
      const accepted = await redis(['SET', voteKey, side, 'NX', 'EX', TTL]);
      if (accepted === 'OK') {
        await redis(['HINCRBY', `${PREFIX}votes`, `${dish}:${side}`, 1]);
      }
      const current = await stats(date);
      send(res, 200, { ok: true, mode: 'live', stats: { votes: current.votes } });
      return;
    }

    send(res, 400, { ok: false, error: 'unknown_action' });
  } catch (error) {
    send(res, 500, { ok: false, mode: 'error', error: 'storage_unavailable' });
  }
}
