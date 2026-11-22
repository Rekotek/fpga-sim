// Sign-in data in localStorage: an access key (spec section 8.6) or a session token (accounts spec section 2.3
// (docs/tz-accounts.md)). One of the two is stored (section 5.1): writing one erases the other.
// A link like …/#key=… stores the key and removes it from the address bar.
const STORAGE_KEY = "fpgasim.key";
const STORAGE_SESSION = "fpgasim.session";
// Login of the saved session account: projects are visible by it until the server answers (decision 130).
const STORAGE_LOGIN = "fpgasim.login";

export function loadKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function saveKey(key: string): void {
  forgetSession();
  localStorage.setItem(STORAGE_KEY, key);
}

export function forgetKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function loadSession(): { token: string; login: string | null } | null {
  const token = localStorage.getItem(STORAGE_SESSION);
  return token ? { token, login: localStorage.getItem(STORAGE_LOGIN) } : null;
}

export function saveSession(token: string, login: string): void {
  forgetKey();
  localStorage.setItem(STORAGE_SESSION, token);
  localStorage.setItem(STORAGE_LOGIN, login);
}

export function forgetSession(): void {
  localStorage.removeItem(STORAGE_SESSION);
  localStorage.removeItem(STORAGE_LOGIN);
}

// The key from the page address. Returns it and erases it from the address bar and from history.
export function takeKeyFromUrl(): string | null {
  const match = /^#key=(.+)$/.exec(location.hash);
  if (!match?.[1]) return null;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1]; // broken link: the key goes to verification as is
  }
}
