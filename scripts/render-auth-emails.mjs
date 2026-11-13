// Build first. External Playwright tooling avoids adding a runtime dependency.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AUTH_EMAIL_KINDS,
  EMAIL_BRAND,
  renderAuthEmail,
} from '../dist/auth/email/auth-email.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright'
);
const out = resolve('artifacts/auth-emails/v2');
await mkdir(out, { recursive: true });
const fixturePath = resolve(
  process.env.EMAIL_LOGO_FIXTURE ??
    '../frontend/public/images/black-logo-with-colors.png',
);
const logo = await readFile(fixturePath);
const browser = await chromium.launch({ headless: true });
const manifest = {
  engine: 'Chromium',
  logo: { url: EMAIL_BRAND.logo, fixturePath, substituted: true },
  renders: [],
};
try {
  for (const kind of AUTH_EMAIL_KINDS)
    for (const locale of ['en', 'ar']) {
      const url = ['welcome', 'password-changed'].includes(kind)
        ? `https://gdguj.org/${locale}/login`
        : `https://gdguj.org/${locale}/login?email-preview=${kind}`;
      const mail = renderAuthEmail({
        kind,
        locale,
        url,
        frontendOrigin: 'https://gdguj.org',
      });
      const name = `${kind}-${locale}`;
      if (Buffer.byteLength(mail.html) >= 100_000)
        throw new Error(`Gmail clipping: ${name}`);
      await writeFile(`${out}/${name}.html`, mail.html);
      await writeFile(`${out}/${name}.txt`, mail.text);
      for (const [device, width] of [
        ['desktop', 800],
        ['mobile', 390],
      ])
        for (const theme of ['light', 'dark']) {
          const page = await browser.newPage({
            viewport: { width, height: 900 },
            deviceScaleFactor: 1,
            colorScheme: theme,
          });
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.route(EMAIL_BRAND.logo, (route) =>
            route.fulfill({
              status: 200,
              contentType: 'image/png',
              body: logo,
            }),
          );
          await page.setContent(mail.html, { waitUntil: 'networkidle' });
          await page.evaluate(() => document.fonts.ready);
          const checks = await page.evaluate(() => {
            const image = document.querySelector('img');
            const button = document.querySelector('.cta');
            const card = document.querySelector('.card');
            const rgb = (value) =>
              value
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map(Number);
            const luminance = (color) =>
              rgb(color)
                .map((v) => {
                  v /= 255;
                  return v <= 0.04045
                    ? v / 12.92
                    : ((v + 0.055) / 1.055) ** 2.4;
                })
                .reduce(
                  (sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i],
                  0,
                );
            const contrast = (element) => {
              let parent = element;
              while (
                parent &&
                getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)'
              )
                parent = parent.parentElement;
              const a = luminance(getComputedStyle(element).color);
              const b = luminance(getComputedStyle(parent).backgroundColor);
              return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            };
            const textElements = [...document.querySelectorAll('h1,p,a')];
            return {
              logoDecoded: image.complete && image.naturalWidth > 0,
              noOverflow: document.documentElement.scrollWidth <= innerWidth,
              cardWidth: card.getBoundingClientRect().width,
              ctaHeight: button.getBoundingClientRect().height,
              minContrast: Math.min(...textElements.map(contrast)),
              minFontSize: Math.min(
                ...textElements.map((e) =>
                  parseFloat(getComputedStyle(e).fontSize),
                ),
              ),
            };
          });
          if (
            !checks.logoDecoded ||
            !checks.noOverflow ||
            checks.cardWidth > 600.5 ||
            checks.ctaHeight < 48 ||
            checks.minContrast < 4.5 ||
            checks.minFontSize < 14 ||
            errors.length
          )
            throw new Error(
              `${name} ${device} ${theme}: ${JSON.stringify({ checks, errors })}`,
            );
          const file = `${name}-${device}-${theme}.png`;
          await page.screenshot({ path: `${out}/${file}`, fullPage: true });
          manifest.renders.push({
            file,
            kind,
            locale,
            width,
            theme,
            htmlBytes: Buffer.byteLength(mail.html),
            ...checks,
          });
          await page.close();
        }
    }
  await writeFile(
    `${out}/manifest.json`,
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(
    `Rendered and checked ${manifest.renders.length} screenshots in ${out}`,
  );
} finally {
  await browser.close();
}
