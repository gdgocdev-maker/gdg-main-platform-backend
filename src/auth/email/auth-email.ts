export const AUTH_EMAIL_KINDS = [
  'verification',
  'reset',
  'welcome',
  'email-change',
  'password-changed',
] as const;
export type AuthEmailKind = (typeof AUTH_EMAIL_KINDS)[number];
export type AuthLocale = 'ar' | 'en';

export const EMAIL_BRAND = {
  logo: 'https://raw.githubusercontent.com/gdgocdev-maker/gdg-main-platform-frontend/d2bf9bc57d98caa73356c7405eab1710de08da90/public/images/black-logo-with-colors.png',
  linkedin:
    'https://www.linkedin.com/company/google-developer-student-club-uj/',
  x: 'https://x.com/gdguoj?s=11',
};

type Message = {
  subject: string;
  preheader: string;
  label: string;
  headline: string;
  body: string;
  cta: string;
  note: string;
  security: string;
  why: string;
};
const copy: Record<AuthLocale, Record<AuthEmailKind, Message>> = {
  en: {
    verification: {
      subject: 'Verify your email · GDG on Campus UJ',
      preheader: 'One small step. A community of possibilities.',
      label: 'YOUR NEXT STEP',
      headline: 'Great things start here.',
      body: 'Welcome to our community of curious minds at the University of Jeddah. Verify your email to take your next step with us.',
      cta: 'Verify my email',
      note: 'This link expires in 1 hour. You can request a new one from the sign-in page.',
      security:
        'Didn’t create an account? You can ignore this email. Your address will not be verified unless you use this link.',
      why: 'You received this email because this address was used to create or verify a GDG on Campus UJ account.',
    },
    reset: {
      subject: 'Reset your password · GDG on Campus UJ',
      preheader: 'A secure link to choose a new password.',
      label: 'ACCOUNT RECOVERY',
      headline: 'A fresh start for your password.',
      body: 'We received a request to reset your password. Choose a new one using the secure link below.',
      cta: 'Reset my password',
      note: 'This link expires in 1 hour and can only be used once.',
      security:
        'Didn’t request a reset? Ignore this email. Your password will stay the same.',
      why: 'You received this email because a password reset was requested for your account.',
    },
    welcome: {
      subject: 'You’re all set · GDG on Campus UJ',
      preheader: 'Connect. Learn. Build. Grow. Your next chapter starts here.',
      label: 'WELCOME TO THE COMMUNITY',
      headline: 'Your next chapter starts here.',
      body: 'Your email is verified. Discover events, exchange ideas, and turn what you learn into something that matters. We’re glad you’re here.',
      cta: 'Explore the community',
      note: 'There’s no expiry on this community link. Membership applications are reviewed separately; email verification does not confirm membership.',
      security:
        'Don’t recognize this account? Contact our team for help. Never share your sign-in details.',
      why: 'You received this welcome because your GDG on Campus UJ email address was verified.',
    },
    'email-change': {
      subject: 'Confirm your email change · GDG on Campus UJ',
      preheader: 'Please confirm before we update your account email.',
      label: 'ACCOUNT UPDATE',
      headline: 'A new address. Still you.',
      body: 'We received a request to change the email address on your account. Confirm below to continue the change.',
      cta: 'Confirm email change',
      note: 'This confirmation link expires in 1 hour. Follow any verification steps for your new address to finish.',
      security:
        'Didn’t request this change? Do not confirm it. Reset your password from the sign-in page and contact our team.',
      why: 'You received this email at your current address because an email change was requested for your account.',
    },
    'password-changed': {
      subject: 'Your password was changed · GDG on Campus UJ',
      preheader: 'A security update for your account. Please review.',
      label: 'SECURITY NOTICE',
      headline: 'Your password has been updated.',
      body: 'The password reset for your account is complete. You can now sign in with your new password.',
      cta: 'Go to sign in',
      note: 'This sign-in link does not expire. It does not contain a password or recovery token.',
      security:
        'Wasn’t you? Reset your password immediately from the sign-in page and contact our team for help.',
      why: 'You received this security notice because a password reset was completed for your account.',
    },
  },
  ar: {
    verification: {
      subject: 'أكّد بريدك الإلكتروني · مجموعة مطوّري جوجل بجامعة جدة',
      preheader: 'خطوة بسيطة، وآفاق جديدة للتعلّم والتطوير.',
      label: 'خطوتك الأولى',
      headline: 'من هنا تبدأ رحلتك.',
      body: 'أهلًا بك في مجتمع يجمع الشغوفين بالتقنية في جامعة جدة. أكّد بريدك الإلكتروني، ولنبدأ رحلة التعلّم وصناعة الأثر معًا.',
      cta: 'تأكيد بريدي الإلكتروني',
      note: 'تنتهي صلاحية الرابط بعد ساعة. يمكنك طلب رابط جديد من صفحة تسجيل الدخول.',
      security:
        'لم تنشئ حسابًا؟ يمكنك تجاهل هذه الرسالة. لن يتم تأكيد بريدك ما لم تستخدم الرابط.',
      why: 'وصلتك هذه الرسالة لأن هذا البريد استُخدم لإنشاء حساب في منصة مجموعة مطوّري جوجل بجامعة جدة أو لتأكيده.',
    },
    reset: {
      subject: 'إعادة تعيين كلمة المرور · مجموعة مطوّري جوجل بجامعة جدة',
      preheader: 'رابط آمن لاختيار كلمة مرور جديدة لحسابك.',
      label: 'استعادة الحساب',
      headline: 'لنجدّد كلمة مرورك.',
      body: 'وصلنا طلب لإعادة تعيين كلمة مرور حسابك. اختر كلمة مرور جديدة عبر الرابط الآمن أدناه.',
      cta: 'تعيين كلمة مرور جديدة',
      note: 'تنتهي صلاحية الرابط بعد ساعة، ويمكن استخدامه مرة واحدة فقط.',
      security:
        'لم تطلب تغيير كلمة المرور؟ تجاهل هذه الرسالة، وستبقى كلمة مرورك كما هي.',
      why: 'وصلتك هذه الرسالة بسبب طلب لإعادة تعيين كلمة مرور حسابك.',
    },
    welcome: {
      subject: 'أهلًا بك بيننا · مجموعة مطوّري جوجل بجامعة جدة',
      preheader: 'تعلّم، تواصل، واصنع أثرًا. رحلتك معنا تبدأ الآن.',
      label: 'أهلًا بك في مجتمعنا',
      headline: 'معًا، نصنع أثرًا.',
      body: 'تم تأكيد بريدك الإلكتروني. استكشف الفعاليات، وشارك أفكارك، وحوّل ما تتعلّمه إلى مشاريع تصنع فرقًا. سعداء بانضمامك إلينا!',
      cta: 'استكشاف المجتمع',
      note: 'رابط المجتمع متاح دون مدة صلاحية. تُراجع طلبات العضوية بشكل مستقل؛ تأكيد البريد لا يعني قبول العضوية.',
      security:
        'لا تعرف هذا الحساب؟ تواصل مع فريقنا للمساعدة، ولا تشارك بيانات الدخول مع أي شخص.',
      why: 'وصلتك رسالة الترحيب بعد تأكيد بريدك الإلكتروني في منصة مجموعة مطوّري جوجل بجامعة جدة.',
    },
    'email-change': {
      subject: 'تأكيد تغيير البريد · مجموعة مطوّري جوجل بجامعة جدة',
      preheader: 'نحتاج تأكيدك قبل متابعة تغيير بريد الحساب.',
      label: 'تحديث الحساب',
      headline: 'بريد جديد، والرحلة مستمرة.',
      body: 'وصلنا طلب لتغيير البريد الإلكتروني المرتبط بحسابك. أكّد الطلب أدناه لمتابعة التغيير.',
      cta: 'تأكيد تغيير البريد',
      note: 'تنتهي صلاحية رابط التأكيد بعد ساعة. أكمل خطوات التحقّق من البريد الجديد إن طُلبت منك.',
      security:
        'لم تطلب تغيير البريد؟ لا تؤكّد الطلب. أعد تعيين كلمة مرورك من صفحة تسجيل الدخول وتواصل مع فريقنا.',
      why: 'وصلتك هذه الرسالة على بريدك الحالي بسبب طلب لتغيير البريد الإلكتروني المرتبط بحسابك.',
    },
    'password-changed': {
      subject: 'تم تغيير كلمة مرورك · مجموعة مطوّري جوجل بجامعة جدة',
      preheader: 'إشعار أمان لحسابك. يُرجى مراجعته.',
      label: 'إشعار أمان',
      headline: 'تم تحديث كلمة مرورك.',
      body: 'اكتملت إعادة تعيين كلمة مرور حسابك. يمكنك الآن تسجيل الدخول باستخدام كلمة المرور الجديدة.',
      cta: 'تسجيل الدخول',
      note: 'رابط تسجيل الدخول لا تنتهي صلاحيته، ولا يحتوي على كلمة مرور أو رمز استعادة.',
      security:
        'لم تُجرِ هذا التغيير؟ أعد تعيين كلمة مرورك فورًا من صفحة تسجيل الدخول، وتواصل مع فريقنا للمساعدة.',
      why: 'وصلتك رسالة الأمان هذه بعد اكتمال إعادة تعيين كلمة مرور حسابك.',
    },
  },
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
const table = (content: string, attributes = '') =>
  `<table role="presentation" border="0" cellpadding="0" cellspacing="0" ${attributes}>${content}</table>`;
const paragraph = (text: string, secondary = false) =>
  `<p class="${secondary ? 'muted' : 'ink'}" style="margin:0 0 20px;font-size:${secondary ? 14 : 16}px;line-height:1.8;color:${secondary ? '#5f6368' : '#202124'}">${text}</p>`;

// A table-backed HTML button plus fixed-size VML for Windows Outlook.
function button(url: string, label: string, rtl: boolean) {
  return table(
    `<tr><td align="${rtl ? 'right' : 'left'}" style="padding:4px 0 24px">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:52px;v-text-anchor:middle;width:280px" arcsize="18%" stroke="f" fillcolor="#1967d2"><w:anchorlock/><center dir="${rtl ? 'rtl' : 'ltr'}" style="color:#ffffff;font-family:${rtl ? 'Tahoma' : 'Arial'};font-size:16px;font-weight:bold">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a class="cta" href="${url}" style="display:inline-block;background:#1967d2;border:1px solid #1967d2;border-radius:10px;color:#ffffff;font-size:16px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;padding:14px 24px;mso-hide:all">${label}</a><!--<![endif]-->
</td></tr>`,
    'width="100%"',
  );
}
function codeBlock(code: string, ar: boolean) {
  return table(
    `<tr><td class="callout" style="padding:20px;background:#f1f3f4;border:1px solid #dadce0;border-radius:12px">${paragraph(ar ? 'أو أدخل رمز التحقّق:' : 'Or enter your verification code:', true)}<p dir="ltr" class="ink" style="margin:0;text-align:center;font-family:Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:5px;color:#202124">${escapeHtml(code)}</p></td></tr>`,
    'width="100%" style="margin:0 0 24px"',
  );
}
export function renderAuthEmail(input: {
  kind: AuthEmailKind;
  locale: AuthLocale;
  url: string;
  frontendOrigin: string;
  code?: string;
}) {
  const url = new URL(input.url);
  const origin = new URL(input.frontendOrigin);
  if (
    ![url, origin].every((value) =>
      ['http:', 'https:'].includes(value.protocol),
    )
  )
    throw new Error('Invalid auth email URL');
  const ar = input.locale === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const align = ar ? 'right' : 'left';
  const font = ar
    ? "'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif"
    : 'Inter,Arial,Helvetica,sans-serif';
  const m = copy[input.locale][input.kind];
  const safeUrl = escapeHtml(url.href);
  const support = ar
    ? 'تحتاج مساعدة؟ تواصل مع فريقنا على LinkedIn'
    : 'Need a hand? Contact our team on LinkedIn';
  const fallback = ar
    ? 'إذا لم يعمل الزر، انسخ الرابط وافتحه في متصفحك:'
    : 'Button not working? Copy this link into your browser:';
  const privacy = ar
    ? 'لا تشارك روابط التحقّق أو رموزه مع أي شخص.'
    : 'Never share your verification links or codes.';
  const address = ar
    ? 'جامعة جدة · جدة، المملكة العربية السعودية'
    : 'University of Jeddah · Jeddah, Saudi Arabia';
  const strip = table(
    `<tr>${['#4285f4', '#34a853', '#f9ab00', '#ea4335'].map((color) => `<td width="25%" bgcolor="${color}" style="height:4px;font-size:0;line-height:4px">&nbsp;</td>`).join('')}</tr>`,
    'width="100%" dir="ltr" aria-hidden="true"',
  );
  const header = `<tr><td bgcolor="#ffffff" style="padding:28px 32px;border-bottom:1px solid #dadce0;background:#ffffff;color:#202124"><img src="${EMAIL_BRAND.logo}" width="280" height="45" alt="GDG on Campus UJ" style="display:block;width:280px;max-width:100%;height:auto;border:0"></td></tr>`;
  const callout = table(
    `<tr><td class="callout" style="background:#f1f3f4;padding:20px;border-radius:12px;border-${ar ? 'right' : 'left'}:3px solid ${input.kind === 'password-changed' ? '#ea4335' : '#4285f4'}">${paragraph(escapeHtml(m.security), true)}<p class="muted" style="margin:0;color:#5f6368;font-size:14px;line-height:1.8">${privacy}</p></td></tr>`,
    'width="100%"',
  );
  const body = `<tr><td class="content" align="${align}" dir="${dir}" style="padding:32px">
<p class="link" style="margin:0 0 12px;color:#1967d2;font-size:14px;font-weight:700;line-height:1.6">${m.label}</p>
<h1 class="ink" style="margin:0 0 20px;font-size:28px;line-height:1.4;font-weight:700;letter-spacing:${ar ? '0' : '-0.6px'};color:#202124">${m.headline}</h1>
${paragraph(m.body)}${input.code ? codeBlock(input.code, ar) : ''}${button(safeUrl, m.cta, ar)}${paragraph(m.note, true)}
${table(`<tr><td style="padding:0 0 24px">${paragraph(fallback, true)}<a class="link" dir="ltr" href="${safeUrl}" style="display:block;color:#1967d2;font-size:14px;line-height:1.7;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all;text-align:${align}">${safeUrl}</a></td></tr>`, 'width="100%" style="table-layout:fixed"')}
${callout}<p class="muted" style="margin:24px 0 0;font-size:14px;line-height:1.8;color:#5f6368"><a class="link" href="${EMAIL_BRAND.linkedin}" style="color:#1967d2;text-decoration:underline">${support}</a></p></td></tr>`;
  const footer = `<tr><td class="footer" align="${align}" style="padding:24px 32px;background:#f8f9fa;border-top:1px solid #dadce0;color:#5f6368;font-size:14px;line-height:1.8">
<p class="ink" dir="ltr" style="margin:0 0 4px;color:#202124;font-weight:700;text-align:${align}">GDG on Campus · University of Jeddah</p><p style="margin:0 0 16px">${address}</p>
<p style="margin:0 0 16px"><a class="link" href="${EMAIL_BRAND.linkedin}" style="color:#1967d2">LinkedIn</a> &nbsp;·&nbsp; <a class="link" href="${EMAIL_BRAND.x}" style="color:#1967d2">X</a></p>
<p style="margin:0 0 12px">${m.why}</p><p style="margin:0">${ar ? 'هذه رسالة تلقائية من' : 'An automated message from'} <span dir="ltr" style="display:inline-block">noreply@gdguj.org</span>. ${ar ? 'للمساعدة، استخدم رابط التواصل أعلاه.' : 'For help, use the contact link above.'}</p></td></tr>`;
  const html = `<!doctype html><html lang="${input.locale}" dir="${dir}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(m.subject)}</title><!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--><style>:root{color-scheme:light dark;supported-color-schemes:light dark}body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}a:focus-visible{outline:3px solid #4285f4;outline-offset:3px}@media(max-width:620px){.outer{padding:16px 12px!important}.content{padding:28px 24px!important}.footer{padding:24px!important}h1{font-size:28px!important}.cta{display:block!important}}@media(prefers-color-scheme:dark){body,.canvas{background:#171717!important}.card{background:#202124!important}.ink{color:#f1f3f4!important}.muted,.footer{color:#c4c7c5!important}.footer,.callout{background:#292a2d!important;border-color:#5f6368!important}.link{color:#a8c7fa!important}.cta{background:#1967d2!important;color:#ffffff!important}}</style></head><body style="margin:0;padding:0;background:#f1f3f4;color:#202124;font-family:${font}"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${m.preheader}${'&#847; &zwnj; &nbsp;'.repeat(40)}</div>
${table(`<tr><td class="outer" align="center" style="padding:32px 16px"><!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->${table(`<tr><td>${strip}</td></tr>${header}${body}${footer}`, `class="card" width="100%" dir="${dir}" style="max-width:600px;border-collapse:separate;border-spacing:0;overflow:hidden;background:#ffffff;border:1px solid #dadce0;border-radius:16px;font-family:${font}"`)}<!--[if mso]></td></tr></table><![endif]--></td></tr>`, 'class="canvas" width="100%" style="background:#f1f3f4"')}</body></html>`;
  return {
    subject: m.subject,
    html,
    text: `${m.subject}\n\n${m.preheader}\n\n${m.headline}\n\n${m.body}\n\n${input.code ? `${ar ? 'رمز التحقّق' : 'Verification code'}: ${input.code}\n\n` : ''}${m.cta}: ${url.href}\n\n${m.note}\n\n${m.security}\n${privacy}\n\n${support}: ${EMAIL_BRAND.linkedin}\n\nGDG on Campus · University of Jeddah\n${address}\nLinkedIn: ${EMAIL_BRAND.linkedin}\nX: ${EMAIL_BRAND.x}\n\n${m.why}\n${ar ? 'رسالة تلقائية من' : 'Automated message from'} noreply@gdguj.org`,
  };
}
