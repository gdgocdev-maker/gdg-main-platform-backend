import { describe, expect, it } from 'vitest';
import { renderAuthEmail } from './auth-email.js';
describe('auth email rendering', () => {
  for (const locale of ['en', 'ar'] as const) {
    for (const kind of ['verification', 'reset', 'welcome', 'email-change'] as const) {
      it(`${locale} ${kind} has an accessible CTA and plain text`, () => {
        const result = renderAuthEmail({ kind, locale, url: 'https://gdg.example/verify?token=test&next=home', frontendOrigin: 'https://gdg.example' });
        expect(result.html).toContain(`lang="${locale}"`);
        expect(result.html).toContain(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
        expect(result.html).toContain('token=test&amp;next=home');
        expect(result.text).toContain('token=test&next=home');
        expect(result.html).toContain('alt="GDG on Campus UJ"');
      });
    }
  }
  it('rejects script URLs and escapes supplied codes', () => {
    const base = { kind: 'verification' as const, locale: 'en' as const, frontendOrigin: 'https://gdg.example' };
    expect(() => renderAuthEmail({ ...base, url: 'javascript:alert(1)' })).toThrow();
    expect(renderAuthEmail({ ...base, url: 'https://gdg.example', code: '<script>' }).html).not.toContain('<script>');
  });
});
