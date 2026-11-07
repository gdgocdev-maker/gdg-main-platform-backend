import { ConfigService } from '@nestjs/config';

export function guestWalletScope(config: ConfigService) {
  const token = config.get<string>('WALLET_GUEST_WORKER_TOKEN')?.trim();
  const committeeCodes = guestCommittees(config);
  return !guestWalletRelayScope(config) &&
    token &&
    token.length >= 32 &&
    committeeCodes.length
    ? { token, committeeCodes }
    : null;
}

function guestCommittees(config: ConfigService) {
  return (config.get<string>('WALLET_GUEST_COMMITTEES') ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z0-9_]{1,20}$/.test(value));
}

export function guestWalletRelayScope(config: ConfigService) {
  const token = config.get<string>('WALLET_GUEST_RELAY_TOKEN')?.trim();
  const origin = config.get<string>('WALLET_GUEST_RELAY_ORIGIN');
  const committeeCodes = guestCommittees(config);
  if (
    !token ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(token) ||
    !origin ||
    !committeeCodes.length
  )
    return null;
  try {
    const apiOrigin = guestOrigin(origin);
    const publicOrigin = guestOrigin(config.get<string>('WALLET_GUEST_PUBLIC_ORIGIN') || origin);
    return { token, origin: apiOrigin, publicOrigin, committeeCodes };
  } catch {
    return null;
  }
}

function guestOrigin(value: string) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const testHttp = loopback && url.protocol === 'http:' && process.env.NODE_ENV !== 'production';
  if ((url.protocol !== 'https:' && !testHttp) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') {
    throw new Error('Invalid guest Wallet origin');
  }
  return url.origin;
}
