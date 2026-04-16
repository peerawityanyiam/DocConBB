// 1. รับค่าโดเมนที่อนุญาต (คั่นด้วยลูกน้ำ) และแปลงเป็น Array
const allowedDomainsString = process.env.ALLOWED_DOMAIN || 'medicine.psu.ac.th,gmail.com';
const allowedDomainsList = allowedDomainsString.split(',').map(domain => domain.trim());

export const AUTH_CONFIG = {
  // เปลี่ยนเป็นเก็บ Array ของโดเมนแทน
  allowedDomains: allowedDomainsList,
  oauthProvider: 'google' as const,
  oauthQueryParams: {
    // ลบ hd: primaryDomain ออกไปเลย เพื่อเปิดรับ @gmail.com และโดเมนอื่นๆ
    prompt: 'select_account',
  },
  loginPath: '/login',
  callbackPath: '/callback',
  defaultRedirect: '/',
  publicPaths: ['/login', '/callback'],
};

// 2. ปรับฟังก์ชันเช็คอีเมล ให้ตรวจสอบจาก Array ของโดเมน
export function isAllowedEmail(email: string): boolean {
  if (!email || !email.includes('@')) return false;
  
  const emailDomain = email.split('@')[1].toLowerCase();
  return AUTH_CONFIG.allowedDomains.includes(emailDomain);
}
