// Zero-dependency static builder for Anti-Crave Lab.
// Generates four localized app routes, two high-intent landing pages,
// sitemap/robots and copies static assets for Vercel.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, LANGS, LANG_ORDER, DISHES, VOTE_SEED } from '../src/config.js';
import en from '../src/strings/en.js';
import zh from '../src/strings/zh.js';
import ko from '../src/strings/ko.js';
import ja from '../src/strings/ja.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');
const PUBLIC = join(ROOT, 'public');
const STR = { en, zh, ko, ja };

const LANDINGS = {
  en: { path: '/fake-food-delivery-app', alternate: 'zh' },
  zh: { path: '/zh/hanguo-jiazhuang-dianwaimai', alternate: 'en' },
};

const COMPARE_CTA = {
  en: 'Read the full Korean fake delivery comparison →',
  zh: '看完整的韩国假装点外卖对比 →',
};

const LANDING_ALT_LABEL = {
  en: '中文',
  zh: 'English',
};

const HREFLANG = { en: 'en', zh: 'zh-CN', ko: 'ko', ja: 'ja' };

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function jsonForScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function get(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function renderTemplate(template, vars, raw = {}) {
  let out = template;
  for (const [key, value] of Object.entries(raw)) {
    out = out.split(`{{{${key}}}}`).join(String(value));
  }
  out = out.replace(/\{\{([\w.]+)\}\}/g, (match, path) => {
    const value = get(vars, path);
    return value == null ? '' : esc(value);
  });
  return out;
}

function canonicalFor(path) {
  return `${SITE.origin}${path}`;
}

function hreflangFor(paths) {
  const lines = paths.map(
    (code) => `<link rel="alternate" hreflang="${HREFLANG[code]}" href="${canonicalFor(LANGS[code].path)}">`
  );
  lines.push(`<link rel="alternate" hreflang="x-default" href="${canonicalFor(LANGS.en.path)}">`);
  return lines.join('\n  ');
}

function landingHreflang() {
  return [
    `<link rel="alternate" hreflang="en" href="${canonicalFor(LANDINGS.en.path)}">`,
    `<link rel="alternate" hreflang="zh-CN" href="${canonicalFor(LANDINGS.zh.path)}">`,
    `<link rel="alternate" hreflang="x-default" href="${canonicalFor(LANDINGS.en.path)}">`,
  ].join('\n  ');
}

function ogAlternatesFor(currentCode) {
  return LANG_ORDER.filter((code) => code !== currentCode)
    .map((code) => `<meta property="og:locale:alternate" content="${LANGS[code].ogLocale}">`)
    .join('\n  ');
}

function langLinksFor(currentCode) {
  return LANG_ORDER.map((code) => {
    const lang = LANGS[code];
    const current = code === currentCode;
    return `<a class="lang-option" href="${lang.path}" hreflang="${HREFLANG[code]}"${
      current ? ' aria-current="true"' : ''
    }><span>${esc(lang.label)}</span><small>${esc(lang.short)}</small></a>`;
  }).join('');
}

function footerLangLinksFor(currentCode) {
  return LANG_ORDER.map((code) => {
    const lang = LANGS[code];
    return `<a href="${lang.path}" hreflang="${HREFLANG[code]}"${code === currentCode ? ' aria-current="page"' : ''}>${esc(
      lang.label
    )}</a>`;
  }).join('');
}

function landingFooterLinks(currentCode) {
  return LANG_ORDER.map((code) => {
    const lang = LANGS[code];
    return `<a href="${lang.path}" hreflang="${HREFLANG[code]}"${
      code === currentCode ? ' aria-current="page"' : ''
    }>${esc(lang.label)}</a>`;
  }).join('');
}

function buildSeo(code, strings) {
  const seo = strings.seo;
  const gallery = seo.gallery
    .map(
      (item, index) => `<figure class="seo-figure">
        <div class="img-wrap">
          <img src="/images/${index === 0 ? 'burger' : 'chicken'}.jpg" alt="${esc(item.alt)}" class="${
        index === 0 ? 'img-blue' : 'img-plaster'
      }" width="900" height="675" loading="lazy" decoding="async">
        </div>
        <figcaption><b>${esc(item.title)}</b>${esc(item.caption)}</figcaption>
      </figure>`
    )
    .join('');

  const science = seo.science
    .map(
      (item, index) => `<div class="science-card">
        <b><i>0${index + 1}</i>${esc(item.title)}</b>
        <p>${esc(item.p1)}</p>
        <p>${esc(item.p2)}</p>
      </div>`
    )
    .join('');

  const cols = seo.compareCols || ['Feature', 'Korean original', 'Anti-Crave Lab'];
  const rows = seo.compareRows
    .map(
      (row) => `<tr>
        <td>${esc(row[0])}</td>
        <td>${esc(row[1])}</td>
        <td>${esc(row[2])}</td>
      </tr>`
    )
    .join('');

  const how = seo.howSteps
    .map(
      (step, index) => `<div class="how-card">
        <b>0${index + 1}</b>
        <strong>${esc(step.title)}</strong>
        <p>${esc(step.text)}</p>
      </div>`
    )
    .join('');

  const faqs = seo.faqs
    .map(
      (faq, index) => `<details class="faq-item"${index === 0 ? ' open' : ''}>
        <summary>${esc(faq.q)}</summary>
        <p>${esc(faq.a)}</p>
      </details>`
    )
    .join('');

  const landingPath = LANDINGS[code];
  const compareLink =
    landingPath && COMPARE_CTA[code]
      ? `<a class="compare-link" href="${landingPath.path}">${esc(COMPARE_CTA[code])}</a>`
      : '';

  return `<article class="seo" id="guide">
    <header class="seo-hero">
      <div class="eyebrow">Sensory appetite lab · 感官食欲实验室</div>
      <h2>${esc(seo.h2)}</h2>
      <div class="seo-intro">
        <p>${esc(seo.intro1)}</p>
        <p>${esc(seo.intro2)}</p>
      </div>
    </header>

    <section id="science">
      <h3>${esc(seo.galleryTitle)}</h3>
      <div class="seo-gallery">${gallery}</div>
    </section>

    <section>
      <h3>${esc(seo.scienceTitle)}</h3>
      <div class="science-grid">${science}</div>
    </section>

    <section id="compare">
      <h3>${esc(seo.compareTitle)}</h3>
      <p class="compare-lede">${esc(seo.compareLede)}</p>
      <div class="compare-wrap">
        <table class="compare-table">
          <thead><tr><th>${esc(cols[0])}</th><th>${esc(cols[1])}</th><th>${esc(cols[2])}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="compare-note">${esc(seo.compareNote)}</p>
      ${compareLink}
    </section>

    <section id="how">
      <h3>${esc(seo.howTitle)}</h3>
      <div class="how-grid">${how}</div>
    </section>

    <section id="faq">
      <h3>${esc(seo.faqTitle)}</h3>
      <div class="faq-list">${faqs}</div>
    </section>

    <aside class="disclaimer">
      <b>${esc(seo.disclaimerTitle)}</b>
      <p>${esc(seo.disclaimer1)}</p>
      <p>${esc(seo.disclaimer2)}</p>
    </aside>

    <div class="seo-cta">
      <div>
        <b>${esc(seo.ctaTitle)}</b>
        <p>${esc(seo.ctaText)}</p>
      </div>
      <a class="btn btn-primary" href="#app">${esc(seo.ctaBtn)}</a>
    </div>
  </article>`;
}

function buildWebApplicationJsonLd(code, strings) {
  const lang = LANGS[code];
  const canonical = canonicalFor(lang.path);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': `${canonical}#app`,
        name: `${SITE.name} — ${strings.ui.h1}`,
        alternateName: [
          'Visual Appetite Suppressant Simulator',
          '劝退外卖 · 深夜戒断社',
          '야식 금단 연구소',
          '夜食やめラボ',
        ],
        url: canonical,
        applicationCategory: 'LifestyleApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires JavaScript and Canvas support',
        inLanguage: [lang.htmlLang],
        description: strings.meta.description,
        isAccessibleForFree: true,
        image: `${SITE.origin}/og.jpg`,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        featureList: [
          'Targeted blue hue appetite suppression filter',
          'Calorie anchoring as butter sticks and sugar cubes',
          'Web Audio anti-mukbang sound synthesis',
          '9-grid sensory-specific satiety experiment',
          '15-second craving tolerance challenge',
          'Fake delivery cart with monthly savings tracker',
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        mainEntity: strings.seo.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text: faq.a },
        })),
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE.origin}#website`,
        url: SITE.origin,
        name: SITE.name,
        inLanguage: LANG_ORDER.map((c) => LANGS[c].htmlLang),
      },
    ],
  };
}

function buildLandingContent(code, strings) {
  const landing = strings.landing;
  const seo = strings.seo;
  const home = LANGS[code].path;

  const sections = landing.sections
    .map(
      (section) => `<section>
        <h2>${esc(section.h2)}</h2>
        <div class="section-copy">${section.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      </section>`
    )
    .join('');

  const rows = seo.compareRows
    .map(
      (row) => `<tr>
        <td>${esc(row[0])}</td>
        <td>${esc(row[1])}</td>
        <td>${esc(row[2])}</td>
      </tr>`
    )
    .join('');

  const faqs = landing.faqs
    .map(
      (faq, index) => `<details class="faq-item"${index === 0 ? ' open' : ''}>
        <summary>${esc(faq.q)}</summary>
        <p>${esc(faq.a)}</p>
      </details>`
    )
    .join('');

  return `<header class="landing-hero">
      <div class="eyebrow">상상배달 · 想象外卖 · Fake delivery</div>
      <h1>${esc(landing.h1)}</h1>
      <p class="lede">${esc(landing.lede)}</p>
      <p class="meta-line">${esc(landing.updated)}</p>
      <div class="landing-actions">
        <a class="btn btn-primary" href="${home}">${esc(landing.ctaTry)}</a>
        <a class="btn btn-ghost" href="#how">${esc(landing.ctaHow)}</a>
      </div>
    </header>

    <div class="landing-grid">
      <figure class="landing-shot">
        <div class="img-wrap"><img src="/images/burger.jpg" class="img-blue" alt="${esc(seo.gallery[0].alt)}" width="900" height="675" loading="eager" decoding="async"></div>
        <p>${esc(seo.gallery[0].caption)}</p>
      </figure>
      <figure class="landing-shot">
        <div class="img-wrap"><img src="/images/chicken.jpg" class="img-plaster" alt="${esc(seo.gallery[1].alt)}" width="900" height="675" loading="lazy" decoding="async"></div>
        <p>${esc(seo.gallery[1].caption)}</p>
      </figure>
    </div>

    ${sections}

    <section id="how">
      <h2>${esc(landing.tableTitle)}</h2>
      <div class="compare-wrap">
        <table class="compare-table">
          <thead><tr>
            <th>${esc(seo.compareCols[0])}</th><th>${esc(seo.compareCols[1])}</th><th>${esc(seo.compareCols[2])}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>${esc(landing.faqTitle)}</h2>
      <div class="faq-list">${faqs}</div>
    </section>

    <p class="landing-note">${esc(landing.note)}</p>

    <div class="landing-cta">
      <h2>${esc(landing.h1)}</h2>
      <p>${esc(landing.lede)}</p>
      <div class="landing-actions">
        <a class="btn btn-primary" href="${home}">${esc(landing.ctaTry)}</a>
      </div>
    </div>`;
}

function buildLandingJsonLd(code, strings, canonical) {
  const landing = strings.landing;
  const lang = LANGS[code];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${canonical}#page`,
        url: canonical,
        name: landing.metaTitle,
        description: landing.metaDesc,
        inLanguage: lang.htmlLang,
        isPartOf: {
          '@type': 'WebSite',
          '@id': `${SITE.origin}#website`,
          url: SITE.origin,
          name: SITE.name,
        },
      },
      {
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        mainEntity: landing.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text: faq.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#breadcrumb`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: SITE.name,
            item: canonicalFor(lang.path),
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: landing.h1,
            item: canonical,
          },
        ],
      },
    ],
  };
}

function buildHomePage(code, template) {
  const strings = STR[code];
  const lang = LANGS[code];
  const canonical = canonicalFor(lang.path);
  const vars = {
    lang: lang.htmlLang,
    dir: lang.dir,
    canonical,
    ogImage: `${SITE.origin}${SITE.ogImage}`,
    ogLocale: lang.ogLocale,
    langPath: lang.path,
    currency: lang.currency,
    site: SITE,
    meta: strings.meta,
    ui: strings.ui,
    year: new Date().getFullYear(),
  };
  const raw = {
    hreflang: hreflangFor(LANG_ORDER),
    ogAlternates: ogAlternatesFor(code),
    langLinks: langLinksFor(code),
    footerLangLinks: footerLangLinksFor(code),
    seo: buildSeo(code, strings),
    jsonLd: jsonForScript(buildWebApplicationJsonLd(code, strings)),
    i18nJson: jsonForScript({ lang: strings.lang, ui: strings.ui, dishes: strings.dishes }),
    cfgJson: jsonForScript({
      origin: SITE.origin,
      lang: code,
      path: lang.path,
      locale: lang.locale,
      currency: lang.currency,
      dishes: DISHES,
      voteSeed: VOTE_SEED,
      apiBase: '/api/community',
    }),
  };
  const html = renderTemplate(template, vars, raw);
  const outDir = join(DIST, lang.path.replace(/^\/|\/$/g, ''));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
}

function buildLandingPage(code, template) {
  const strings = STR[code];
  const landing = strings.landing;
  const config = LANDINGS[code];
  if (!landing || !config) return;
  const lang = LANGS[code];
  const altCode = config.alternate;
  const canonical = canonicalFor(config.path);
  const vars = {
    lang: lang.htmlLang,
    dir: lang.dir,
    canonical,
    ogImage: `${SITE.origin}${SITE.ogImage}`,
    ogLocale: lang.ogLocale,
    homePath: lang.path,
    appPath: lang.path,
    site: SITE,
    meta: {
      title: landing.metaTitle,
      description: landing.metaDesc,
      keywords: strings.meta.keywords,
      ogTitle: landing.metaTitle,
      ogDesc: landing.lede,
    },
    year: new Date().getFullYear(),
    ctaTry: landing.ctaTry,
    brandKicker: strings.ui.brandKicker,
    alternateLandingPath: LANDINGS[altCode].path,
    alternateLang: HREFLANG[altCode],
    alternateLabel: LANDING_ALT_LABEL[altCode],
    footerNote: strings.ui.footerNote,
    footerPhotos: strings.ui.footerPhotos,
    footerMedical: strings.ui.footerMedical,
  };
  const raw = {
    hreflang: landingHreflang(),
    footerLangLinks: landingFooterLinks(code),
    landingContent: buildLandingContent(code, strings),
    jsonLd: jsonForScript(buildLandingJsonLd(code, strings, canonical)),
  };
  const html = renderTemplate(template, vars, raw);
  const outDir = join(DIST, config.path.replace(/^\/|\/$/g, ''));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
}

function buildSitemap() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const homeEntries = LANG_ORDER.map((code) => {
    const lang = LANGS[code];
    const alternates = LANG_ORDER.map(
      (c) => `    <xhtml:link rel="alternate" hreflang="${HREFLANG[c]}" href="${canonicalFor(LANGS[c].path)}"/>`
    ).join('\n');
    return `  <url>
    <loc>${canonicalFor(lang.path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${code === 'en' ? '1.0' : '0.9'}</priority>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${canonicalFor(LANGS.en.path)}"/>
  </url>`;
  }).join('\n');

  const landingEntries = Object.entries(LANDINGS)
    .map(([code, config]) => {
      const alternates = Object.entries(LANDINGS)
        .map(
          ([c, cfg]) => `    <xhtml:link rel="alternate" hreflang="${HREFLANG[c]}" href="${canonicalFor(cfg.path)}"/>`
        )
        .join('\n');
      return `  <url>
    <loc>${canonicalFor(config.path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${canonicalFor(LANDINGS.en.path)}"/>
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${homeEntries}
${landingEntries}
</urlset>
`;
  writeFileSync(join(DIST, 'sitemap.xml'), xml);
}

function main() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const homeTemplate = readFileSync(join(SRC, 'page.html'), 'utf8');
  const landingTemplate = readFileSync(join(SRC, 'landing.html'), 'utf8');

  for (const code of LANG_ORDER) buildHomePage(code, homeTemplate);
  for (const code of Object.keys(LANDINGS)) buildLandingPage(code, landingTemplate);

  cpSync(PUBLIC, DIST, { recursive: true });

  copyFileSync(join(SRC, 'styles.css'), join(DIST, 'styles.css'));
  copyFileSync(join(SRC, 'app.js'), join(DIST, 'app.js'));

  if (!existsSync(join(PUBLIC, 'og.jpg'))) {
    console.warn('[build] public/og.jpg is missing — social cards will 404 until it is generated.');
  }

  writeFileSync(
    join(DIST, 'robots.txt'),
    `User-agent: *
Allow: /
Disallow: /api/
Disallow: /*?p=1
Disallow: /*?poison=1
Sitemap: ${SITE.origin}/sitemap.xml
`
  );

  writeFileSync(
    join(DIST, 'manifest.webmanifest'),
    JSON.stringify(
      {
        name: SITE.name,
        short_name: 'Anti-Crave',
        description: STR.en.meta.description,
        start_url: '/',
        display: 'standalone',
        background_color: '#FFF1EC',
        theme_color: '#FFF1EC',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      null,
      2
    )
  );

  buildSitemap();

  console.log(`Built Anti-Crave Lab for ${SITE.origin}`);
  console.log(`  /  /zh  /ko  /ja`);
  console.log(`  ${LANDINGS.en.path}  ${LANDINGS.zh.path}`);
}

main();
