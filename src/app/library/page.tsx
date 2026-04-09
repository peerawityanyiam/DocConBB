import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const DOCUMENT_CONTROL_GAS_URL =
  process.env.NEXT_PUBLIC_DOCUMENT_CONTROL_GAS_URL ||
  'https://accounts.google.com/AccountChooser?continue=https://script.google.com/a/macros/medicine.psu.ac.th/s/AKfycbx0oytFnXvNDaMfPkfLTUQKd8zr-uHpNhuaJNv2csLnM3pKADaWxpa0laQcVciTvRe-/exec';

export default async function LibraryPage() {
  redirect(DOCUMENT_CONTROL_GAS_URL);
}
