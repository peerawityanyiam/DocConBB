export const AUTH_CONFIG = {
  allowedDomain: process.env.ALLOWED_DOMAIN || 'medicine.psu.ac.th',
  oauthProvider: 'google' as const,
  oauthQueryParams: {
    hd: 'medicine.psu.ac.th',
    prompt: 'select_account',
  },
  loginPath: '/login',
  callbackPath: '/callback',
  defaultRedirect: '/',
  publicPaths: ['/login', '/callback'],
};

export function isAllowedEmail(email: string): boolean {
  return email.endsWith(`@${AUTH_CONFIG.allowedDomain}`);
}
