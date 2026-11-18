// Site-wide config shared by the static builder and the content files.
function resolveOrigin() {
  if (process.env.SITE_ORIGIN) return process.env.SITE_ORIGIN.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/+$/, '')}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/+$/, '')}`;
  return 'https://anticrave.cdqyfdbymn.me';
}

export const SITE = {
  origin: resolveOrigin(),
  name: 'Anti-Crave Lab',
  legalName: 'Anti-Crave Lab · 劝退外卖',
  ogImage: '/og.jpg',
};

export const LANGS = {
  en: {
    code: 'en',
    htmlLang: 'en',
    locale: 'en-US',
    dir: 'ltr',
    path: '/',
    label: 'English',
    short: 'EN',
    currency: 'USD',
    ogLocale: 'en_US',
  },
  zh: {
    code: 'zh',
    htmlLang: 'zh-CN',
    locale: 'zh-CN',
    dir: 'ltr',
    path: '/zh',
    label: '简体中文',
    short: '中文',
    currency: 'CNY',
    ogLocale: 'zh_CN',
  },
  ko: {
    code: 'ko',
    htmlLang: 'ko',
    locale: 'ko-KR',
    dir: 'ltr',
    path: '/ko',
    label: '한국어',
    short: 'KO',
    currency: 'KRW',
    ogLocale: 'ko_KR',
  },
  ja: {
    code: 'ja',
    htmlLang: 'ja',
    locale: 'ja-JP',
    dir: 'ltr',
    path: '/ja',
    label: '日本語',
    short: 'JA',
    currency: 'JPY',
    ogLocale: 'ja_JP',
  },
};

export const LANG_ORDER = ['en', 'zh', 'ko', 'ja'];

// Baseline community numbers shown before the live API has data.
// They are intentionally small and documented in the repository README.
// The worker adds real Upstash counters on top of these values.
export const VOTE_SEED = {
  tteokbokki: { quit: 132, hungry: 11 },
  burger: { quit: 148, hungry: 16 },
  chicken: { quit: 197, hungry: 18 },
  sushi: { quit: 109, hungry: 9 },
  ramen: { quit: 175, hungry: 19 },
  pizza: { quit: 121, hungry: 21 },
  fries: { quit: 96, hungry: 14 },
  milktea: { quit: 168, hungry: 12 },
};

export const DISHES = [
  {
    id: 'tteokbokki',
    image: '/images/tteokbokki.jpg',
    kcal: 620,
    butter: 0.8,
    sugar: 15,
    price: { USD: 11, CNY: 28, KRW: 7000, JPY: 1000 },
    cuisine: 'korean',
    badge: 'NEW',
  },
  {
    id: 'burger',
    image: '/images/burger.jpg',
    kcal: 980,
    butter: 1.3,
    sugar: 14,
    price: { USD: 16, CNY: 42, KRW: 12900, JPY: 1780 },
    cuisine: 'american',
    badge: 'BEST',
  },
  {
    id: 'chicken',
    image: '/images/chicken.jpg',
    kcal: 1250,
    butter: 1.7,
    sugar: 12,
    price: { USD: 24, CNY: 54, KRW: 18000, JPY: 2400 },
    cuisine: 'american',
    badge: 'HOT',
  },
  {
    id: 'sushi',
    image: '/images/sushi.jpg',
    kcal: 580,
    butter: 0.7,
    sugar: 8,
    price: { USD: 18, CNY: 68, KRW: 15000, JPY: 1900 },
    cuisine: 'japanese',
    badge: 'NEW',
  },
  {
    id: 'ramen',
    image: '/images/ramen.jpg',
    kcal: 940,
    butter: 1.2,
    sugar: 11,
    price: { USD: 15, CNY: 38, KRW: 10500, JPY: 1450 },
    cuisine: 'japanese',
  },
  {
    id: 'pizza',
    image: '/images/pizza.jpg',
    kcal: 1120,
    butter: 1.5,
    sugar: 16,
    price: { USD: 22, CNY: 58, KRW: 15900, JPY: 2200 },
    cuisine: 'italian',
  },
  {
    id: 'fries',
    image: '/images/fries.jpg',
    kcal: 860,
    butter: 1.1,
    sugar: 10,
    price: { USD: 12, CNY: 32, KRW: 8900, JPY: 1200 },
    cuisine: 'american',
  },
  {
    id: 'milktea',
    image: '/images/boba.jpg',
    kcal: 640,
    butter: 0.8,
    sugar: 18,
    price: { USD: 8, CNY: 22, KRW: 6500, JPY: 880 },
    cuisine: 'drinks',
  },
];
