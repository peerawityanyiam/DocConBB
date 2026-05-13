const DEFAULT_DOCUMENT_CONTROL_GAS_EXEC_URL =
  'https://script.google.com/a/macros/medicine.psu.ac.th/s/AKfycbx0oytFnXvNDaMfPkfLTUQKd8zr-uHpNhuaJNv2csLnM3pKADaWxpa0laQcVciTvRe-/exec';

function getConfiguredGasExecUrl(): URL {
  const configuredUrl =
    process.env.NEXT_PUBLIC_DOCUMENT_CONTROL_GAS_URL?.trim() ||
    DEFAULT_DOCUMENT_CONTROL_GAS_EXEC_URL;

  try {
    const url = new URL(configuredUrl);
    const continueUrl = url.searchParams.get('continue');

    if (url.hostname === 'accounts.google.com' && continueUrl) {
      return new URL(continueUrl);
    }

    return url;
  } catch {
    return new URL(DEFAULT_DOCUMENT_CONTROL_GAS_EXEC_URL);
  }
}

export function buildDocumentControlUrl(authuser?: string): string {
  const gasUrl = getConfiguredGasExecUrl();
  const normalizedAuthuser = authuser?.trim().toLowerCase();

  if (normalizedAuthuser) {
    gasUrl.searchParams.set('authuser', normalizedAuthuser);
  }

  const chooserUrl = new URL('https://accounts.google.com/AccountChooser');
  chooserUrl.searchParams.set('continue', gasUrl.toString());

  return chooserUrl.toString();
}
