export type AuthEmailKind = 'verification' | 'reset' | 'welcome' | 'email-change';
export type AuthLocale = 'ar' | 'en';

const copy = {
  en: {
    verification: ['Verify your email', 'One more step to join our community. Confirm your email to continue.', 'Verify email'],
    reset: ['Reset your password', 'You requested a new password. Use the secure link below to choose one.', 'Reset password'],
    welcome: ['Welcome to GDG on Campus UJ', 'Your email is verified. Explore, learn and build with our community. Membership applications remain subject to approval.', 'Explore the community'],
    'email-change': ['Confirm your email change', 'Confirm this request to update the email address for your GDG account.', 'Confirm email change'],
    footer: 'If you did not request this email, you can safely ignore it. Never share your verification links or codes.',
    fallback: 'If the button does not work, copy this link into your browser:',
  },
  ar: {
    verification: ['أكّد بريدك الإلكتروني', 'بقيت خطوة للانضمام إلى مجتمعنا. أكّد بريدك الإلكتروني للمتابعة.', 'تأكيد البريد الإلكتروني'],
    reset: ['إعادة تعيين كلمة المرور', 'طلبت كلمة مرور جديدة. استخدم الرابط الآمن أدناه لاختيار كلمة مرور.', 'إعادة تعيين كلمة المرور'],
    welcome: ['مرحبًا بك في GDG on Campus UJ', 'تم تأكيد بريدك الإلكتروني. اكتشف وتعلّم وابتكر مع مجتمعنا. تظل طلبات العضوية خاضعة للموافقة.', 'استكشف المجتمع'],
    'email-change': ['تأكيد تغيير البريد الإلكتروني', 'أكّد هذا الطلب لتحديث عنوان البريد الإلكتروني لحسابك في GDG.', 'تأكيد تغيير البريد'],
    footer: 'إذا لم تطلب هذه الرسالة، يمكنك تجاهلها بأمان. لا تشارك روابط التحقق أو رموزه مع أي شخص.',
    fallback: 'إذا لم يعمل الزر، انسخ هذا الرابط إلى متصفحك:',
  },
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function renderAuthEmail(input: { kind: AuthEmailKind; locale: AuthLocale; url: string; frontendOrigin: string; code?: string }) {
  const url = new URL(input.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid auth email URL');
  const origin = new URL(input.frontendOrigin).origin;
  const strings = copy[input.locale];
  const [subject, message, cta] = strings[input.kind];
  const safeUrl = escapeHtml(url.href);
  const code = input.code ? `<p style="font-size:32px;letter-spacing:6px;text-align:center" dir="ltr">${escapeHtml(input.code)}</p>` : '';
  const html = `<!doctype html><html lang="${input.locale}" dir="${input.locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f5f7fb;color:#202124;font-family:Arial,Tahoma,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:40px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="height:6px;background:linear-gradient(90deg,#4285f4 25%,#ea4335 25%,#ea4335 50%,#fbbc04 50%,#fbbc04 75%,#34a853 75%)"></td></tr><tr><td style="padding:36px"><img src="${escapeHtml(origin)}/images/black-logo-with-colors.png" width="180" alt="GDG on Campus UJ"><h1 style="font-size:26px;line-height:1.4;margin:32px 0 16px">${subject}</h1><p style="font-size:16px;line-height:1.8">${message}</p>${code}<p style="margin:32px 0"><a href="${safeUrl}" style="display:inline-block;background:#1a73e8;color:#fff;padding:16px 26px;border-radius:8px;text-decoration:none;font-weight:bold">${cta}</a></p><p style="font-size:13px;color:#5f6368;line-height:1.8">${strings.fallback}<br><a href="${safeUrl}" style="color:#1a73e8;word-break:break-all">${safeUrl}</a></p><hr style="border:0;border-top:1px solid #e8eaed;margin:28px 0"><p style="font-size:12px;line-height:1.8;color:#5f6368">${strings.footer}</p><p style="font-size:12px;color:#5f6368" dir="ltr">GDG on Campus · University of Jeddah</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text: `${subject}\n\n${message}\n\n${input.code ? `${input.code}\n\n` : ''}${cta}: ${url.href}\n\n${strings.footer}\n\nGDG on Campus · University of Jeddah` };
}
