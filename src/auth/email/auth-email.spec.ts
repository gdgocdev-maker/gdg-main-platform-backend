import { describe, expect, it } from 'vitest';
import {
  AUTH_EMAIL_KINDS,
  EMAIL_BRAND,
  renderAuthEmail,
} from './auth-email.js';

describe('auth email rendering', () => {
  for (const locale of ['en', 'ar'] as const) {
    for (const kind of AUTH_EMAIL_KINDS) {
      it(`${locale} ${kind} preserves safe layout, complete text and action`, () => {
        const result = renderAuthEmail({
          kind,
          locale,
          url: 'https://gdg.example/verify?token=test&next=home',
          frontendOrigin: 'https://gdg.example',
        });
        expect(result.html).toContain(`lang="${locale}"`);
        expect(result.html).toContain(
          `dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`,
        );
        expect(result.html).toContain('token=test&amp;next=home');
        expect(result.text).toContain('token=test&next=home');
        expect(result.html).toContain('alt="GDG on Campus UJ"');
        expect(result.html).toContain(EMAIL_BRAND.logo);
        expect(result.html).toContain('name="color-scheme"');
        expect(result.html).toContain('v:roundrect');
        expect(result.html).toContain('max-width:600px');
        expect(result.html.match(/class="cta"/g)).toHaveLength(1);
        expect(result.html).not.toMatch(/data:image|<script|<svg/);
        expect(Buffer.byteLength(result.html)).toBeLessThan(100_000);
        expect(result.text).toContain(EMAIL_BRAND.linkedin);
        expect(result.text).toContain('noreply@gdguj.org');
        expect(result.text).toContain(locale === 'ar' ? 'صلاح' : 'expir');
        if (locale === 'ar') expect(result.html).toContain('border-right:3px');
      });
    }
  }
  it('rejects unsafe URL protocols in either URL and escapes codes', () => {
    const base = {
      kind: 'verification' as const,
      locale: 'en' as const,
      frontendOrigin: 'https://gdg.example',
    };
    expect(() =>
      renderAuthEmail({ ...base, url: 'javascript:alert(1)' }),
    ).toThrow();
    expect(() =>
      renderAuthEmail({
        ...base,
        url: 'https://gdg.example',
        frontendOrigin: 'javascript:alert(1)',
      }),
    ).toThrow();
    const result = renderAuthEmail({
      ...base,
      url: 'https://gdg.example',
      code: '<script>"&',
    });
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;&quot;&amp;');
    expect(result.text).toContain('<script>"&');
  });
});
