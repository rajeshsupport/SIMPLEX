/**
 * The client host, application context and version are client-specific.
 * Only the addUserRole route is common by default.
 * Never hardcode the staging host or MasterV9.3.
 */

export interface ResolveClientRouteOptions {
  baseUrl: string;
  applicationPath?: string;
  route?: string;
  fallbackRoute?: string;
}

export interface ResolveClientRoleUrlOptions {
  baseUrl?: string;
  configuredUrl?: string;
  applicationPath?: string;
  userRoleRoute?: string | null;
}

const KNOWN_SCREEN_ROUTES = [
  '/adduserrole',
  '/addusers',
  '/adduser',
  '/users',
  '/login',
  '/services',
  '/dashboard',
  '/index',
  '/home',
];

/**
 * Normalizes a client-configured URL to its application base URL.
 * - Preserves protocol (http/https)
 * - Preserves domain and port (e.g. http://192.168.1.100:8080)
 * - Preserves complete application/context path (e.g. /HMC/MasterV9.4)
 * - Preserves client-specific version (e.g. MasterV10.18, MasterV9.4)
 * - Removes trailing slashes
 * - Strips trailing screen routes (e.g. /login, /users, /addUserRole) if present
 * - Avoids duplicate slashes
 * - Never assumes or replaces MasterV9.3
 */
export function normalizeClientBaseUrl(configuredUrl: string): string {
  if (!configuredUrl || typeof configuredUrl !== 'string' || !configuredUrl.trim()) {
    throw new Error('MISSING_CLIENT_URL: Client configured base URL is required');
  }

  const trimmed = configuredUrl.trim();

  let urlObj: URL;
  try {
    urlObj = new URL(trimmed);
  } catch {
    throw new Error(`INVALID_CLIENT_URL: Invalid client base URL format: '${trimmed}'`);
  }

  let pathname = urlObj.pathname.replace(/\/+/g, '/').replace(/\/+$/, '');

  // Check if pathname ends with any known screen route and strip it to get base
  const lowerPath = pathname.toLowerCase();
  for (const screen of KNOWN_SCREEN_ROUTES) {
    if (lowerPath === screen || lowerPath.endsWith(screen)) {
      pathname = pathname.slice(0, pathname.length - screen.length).replace(/\/+$/, '');
      break;
    }
  }

  // Deduplicate consecutive identical version paths if corrupted
  const versionMatches = pathname.match(/\/MasterV[0-9.]+/gi);
  if (versionMatches && versionMatches.length > 1) {
    const lastVersion = versionMatches[versionMatches.length - 1];
    pathname = pathname.replace(/(\/MasterV[0-9.]+)+/gi, lastVersion);
  }

  urlObj.pathname = pathname;
  urlObj.search = '';
  urlObj.hash = '';

  return urlObj.toString().replace(/\/+$/, '');
}

/**
 * Resolves the Role Master URL dynamically for the selected client.
 * Priority:
 * 1. Client-specific UserRoleRoute override (if provided)
 * 2. Default common route: /addUserRole
 *
 * Preferred logic:
 * clientRoleUrl = normalizeClientBaseUrl(clientConfiguredUrl) + "/addUserRole"
 */
export function resolveClientRoleUrl(options: ResolveClientRoleUrlOptions): string {
  const rawUrl = options.baseUrl || options.configuredUrl;
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('MISSING_CLIENT_URL: Client configured base URL is required to resolve Role Master URL');
  }

  const roleRouteRaw = (options.userRoleRoute && options.userRoleRoute.trim())
    ? options.userRoleRoute.trim()
    : '/addUserRole';

  const roleRoute = roleRouteRaw.startsWith('/') ? roleRouteRaw : `/${roleRouteRaw}`;

  // If input URL already ends with the target role route, validate and normalize without duplicating
  const trimmed = rawUrl.trim();
  try {
    const u = new URL(trimmed);
    const cleanPath = u.pathname.replace(/\/+/g, '/').replace(/\/+$/, '');
    if (cleanPath.toLowerCase().endsWith(roleRoute.toLowerCase())) {
      u.pathname = cleanPath;
      u.search = '';
      u.hash = '';
      return u.toString().replace(/\/+$/, '');
    }
  } catch {
    throw new Error(`INVALID_CLIENT_URL: Invalid client base URL format: '${trimmed}'`);
  }

  const normalizedBase = normalizeClientBaseUrl(trimmed);

  // If applicationPath is specified and not already in normalizedBase
  let finalBase = normalizedBase;
  if (options.applicationPath && options.applicationPath.trim()) {
    const appPath = options.applicationPath.trim().startsWith('/')
      ? options.applicationPath.trim()
      : `/${options.applicationPath.trim()}`;
    const cleanAppPath = appPath.replace(/\/+$/, '');
    if (!normalizedBase.toLowerCase().endsWith(cleanAppPath.toLowerCase())) {
      finalBase = `${normalizedBase}${cleanAppPath}`;
    }
  }

  const urlObj = new URL(finalBase);
  const cleanPath = `${urlObj.pathname}/${roleRoute}`.replace(/\/+/g, '/').replace(/\/+$/, '');
  urlObj.pathname = cleanPath;
  urlObj.search = '';
  urlObj.hash = '';

  return urlObj.toString().replace(/\/+$/, '');
}

/**
 * Validates that an authenticated post-login redirect stays within the selected client's configured host.
 */
export function validateRedirectHost(
  configuredBaseUrl: string,
  redirectedUrl: string
): { isValid: boolean; error?: string; normalizedBaseUrl?: string } {
  try {
    const configUrlObj = new URL(configuredBaseUrl);
    const redirectUrlObj = new URL(redirectedUrl);

    if (configUrlObj.host.toLowerCase() !== redirectUrlObj.host.toLowerCase()) {
      return {
        isValid: false,
        error: `HOST_MISMATCH_AFTER_REDIRECT: Redirected host '${redirectUrlObj.host}' does not match configured client host '${configUrlObj.host}'`,
      };
    }

    return {
      isValid: true,
      normalizedBaseUrl: normalizeClientBaseUrl(redirectedUrl),
    };
  } catch (err: any) {
    return {
      isValid: false,
      error: `INVALID_URL_AFTER_REDIRECT: ${err.message}`,
    };
  }
}

/**
 * Normalizes and resolves client routes safely.
 * - Normalizes trailing/leading slashes.
 * - Preserves protocol, host, port, application paths, and client versions.
 * - Avoids duplicate slashes and duplicate version segments.
 */
export function resolveClientRoute(options: ResolveClientRouteOptions): string {
  const { baseUrl, applicationPath, route, fallbackRoute = '/' } = options;

  let targetRoute = (route && route.trim()) ? route.trim() : fallbackRoute;

  // If targetRoute is already a full HTTP/HTTPS URL:
  if (targetRoute.startsWith('http://') || targetRoute.startsWith('https://')) {
    try {
      const urlObj = new URL(targetRoute);
      let pathname = urlObj.pathname.replace(/\/+/g, '/');
      const versionMatches = pathname.match(/\/MasterV[0-9.]+/gi);
      if (versionMatches && versionMatches.length > 1) {
        const lastVersion = versionMatches[versionMatches.length - 1];
        pathname = pathname.replace(/(\/MasterV[0-9.]+)+/gi, lastVersion);
      }
      urlObj.pathname = pathname;
      return urlObj.toString().replace(/\/+$/, '');
    } catch {}
  }

  let cleanBase = (baseUrl || '').trim().replace(/\/+$/, '');
  let origin = cleanBase;
  let baseRest = '';
  try {
    if (cleanBase.startsWith('http')) {
      const u = new URL(cleanBase);
      origin = u.origin;
      baseRest = u.pathname;
    }
  } catch {}

  let cleanAppPath = (applicationPath || '').trim();
  if (cleanAppPath) {
    cleanAppPath = cleanAppPath.startsWith('/') ? cleanAppPath : `/${cleanAppPath}`;
    cleanAppPath = cleanAppPath.replace(/\/+$/, '');
  }

  // Remove existing /MasterVx.x segment from baseUrl/baseRest before adding applicationPath
  if (cleanAppPath && cleanAppPath.toLowerCase().startsWith('/masterv')) {
    baseRest = baseRest.replace(/\/MasterV[0-9.]+/gi, '');
  } else if (!cleanAppPath) {
    if (targetRoute.toLowerCase().startsWith('/masterv') || targetRoute.toLowerCase().startsWith('masterv')) {
      baseRest = baseRest.replace(/\/MasterV[0-9.]+/gi, '');
    }
  }

  targetRoute = targetRoute.startsWith('/') ? targetRoute : `/${targetRoute}`;
  targetRoute = targetRoute.replace(/\/+/g, '/');

  if (cleanAppPath && targetRoute.toLowerCase().startsWith(cleanAppPath.toLowerCase())) {
    cleanAppPath = '';
  } else if (targetRoute.toLowerCase().startsWith('/masterv')) {
    cleanAppPath = '';
  }

  let combinedPath = `${baseRest}${cleanAppPath}${targetRoute}`.replace(/\/+/g, '/');

  // Final safeguard: remove duplicate consecutive version segments
  const matches = combinedPath.match(/\/MasterV[0-9.]+/gi);
  if (matches && matches.length > 1) {
    const lastVersion = matches[matches.length - 1];
    combinedPath = combinedPath.replace(/(\/MasterV[0-9.]+)+/gi, lastVersion);
  }

  if (combinedPath.length > 1 && combinedPath.endsWith('/')) {
    combinedPath = combinedPath.slice(0, -1);
  }

  return `${origin}${combinedPath}`;
}

