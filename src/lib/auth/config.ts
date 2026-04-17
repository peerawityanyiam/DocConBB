const allowedDomainsList = (process.env.ALLOWED_DOMAIN || 'medicine.psu.ac.th')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

export const AUTH_CONFIG = {
  allowedDomains: allowedDomainsList,
  oauthProvider: 'google' as const,
  oauthQueryParams: {
    prompt: 'select_account',
  },
  loginPath: '/login',
  callbackPath: '/callback',
  defaultRedirect: '/',
  publicPaths: ['/login', '/callback'],
};

export function isAllowedEmail(email: string): boolean {
  if (!email || !email.includes('@')) return false;
  const parts = email.toLowerCase().split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  return allowedDomainsList.includes(domain);
}
