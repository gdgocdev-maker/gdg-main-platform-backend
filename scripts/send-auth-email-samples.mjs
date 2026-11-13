// Explicit owner-authorized six-message design review only. Never uses real tokens.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { Resend } from 'resend';
import {
  AUTH_EMAIL_KINDS,
  EMAIL_BRAND,
  renderAuthEmail,
} from '../dist/auth/email/auth-email.js';
const env = parse(await readFile('.env', 'utf8'));
const to = 'abdullahwalid18@gmail.com';
if (
  !env.RESEND_API_KEY ||
  !/^(?:[^<>]*<)?noreply@gdguj\.org>?$/.test(env.EMAIL_FROM ?? '')
)
  throw new Error(
    'Expected configured Resend key and noreply@gdguj.org sender',
  );
const directory = 'artifacts/auth-emails/v2';
await mkdir(directory, { recursive: true });
const receiptPath = `${directory}/resend-receipts.json`;
let receipts;
try {
  receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  receipts = [];
}
const resend = new Resend(env.RESEND_API_KEY);
for (const [kind, locale] of [
  ...AUTH_EMAIL_KINDS.map((kind) => [kind, 'en']),
  ['verification', 'ar'],
]) {
  const key = `auth-email-design-v2-${kind}-${locale}`;
  if (receipts.some((item) => item.key === key)) continue;
  const reservation = `${directory}/.${key}.reserved`;
  // Persistent reservation prevents unintentional repeats beyond Resend's 24h key window.
  await writeFile(reservation, new Date().toISOString(), {
    flag: 'wx',
    mode: 0o600,
  });
  const mail = renderAuthEmail({
    kind,
    locale,
    frontendOrigin: 'https://gdguj.org',
    url: `https://gdguj.org/${locale}/login?email-preview=${kind}`,
  });
  const { data, error } = await resend.emails.send(
    { from: env.EMAIL_FROM, to, ...mail },
    { idempotencyKey: key },
  );
  if (error || !data?.id)
    throw new Error(
      `Sample delivery failed for ${kind}/${locale}; inspect reservation before retrying`,
    );
  receipts.push({
    key,
    kind,
    locale,
    to,
    id: data.id,
    sentAt: new Date().toISOString(),
    logoUrlSent: EMAIL_BRAND.logo,
  });
  await writeFile(receiptPath, JSON.stringify(receipts, null, 2) + '\n');
  console.log(`${kind}/${locale}: ${data.id}`);
  // Resend permits two requests/second; pace the fixed six-message batch.
  await new Promise((resolve) => setTimeout(resolve, 650));
}
