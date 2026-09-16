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
  '/userrole',
  '/addusers',
  '/adduser',
  '/users',
  '/login',
  '/services',
  '/dashboard',
  '/index',
  '/home',
  '/addresourceparentdetails',
  '/addparentresourceuser',
  '/addresource',
  '/resources',
  '/resourceusermapping',
  '/resource',
  '/emrpanelselection',
  '/addusereclaim',
  '/usereclaim',
  '/addeclaimuser',
  '/eclaimuser',
];

/**
 * Ensures the given base URL has a trailing slash.
 */
export function ensureTrailingSlash(baseUrl: string): string {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('MISSING_CLIENT_URL: Base URL is required');
  }
  const trimmed = baseUrl.trim();
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * Default role mapping route appended to the client base URL.
 */
export const DEFAULT_ROLE_MAPPING_ROUTE = '/addUserRole';

/**
 * Normalizes a client-configured URL to its application base URL.
 * - Preserves protocol (http/https)
 * - Preserves domain and port (e.g. http://192.168.1.100:8080)
 * - Preserves complete application/context path (e.g. /HMC/MasterV9.4)
 * - Preserves client-specific version (e.g. MasterV10.18, MasterV9.4)
 * - Removes trailing slashes
 * - Strips trailing screen routes (e.g. /login, /users, /addUserRole, /userRole) if present
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
 * Rules:
 * - Treat stored client baseUrl as authoritative and complete.
 * - Define default role-mapping route as /addUserRole only.
 * - Construct using: new URL('addUserRole', ensureTrailingSlash(baseUrl)).toString()
 * - Never append /MasterV9.3 again.
 */
export function resolveClientRoleUrl(options: ResolveClientRoleUrlOptions): string {
  const rawUrl = options.baseUrl || options.configuredUrl;
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('MISSING_CLIENT_URL: Client configured base URL is required to resolve Role Master URL');
  }

  const trimmed = rawUrl.trim();
  const normalizedBase = normalizeClientBaseUrl(trimmed);

  let finalBase = normalizedBase;
  if (options.applicationPath && options.applicationPath.trim()) {
    const appPath = options.applicationPath.trim().startsWith('/')
      ? options.applicationPath.trim()
      : `/${options.applicationPath.trim()}`;
    const cleanAppPath = appPath.replace(/\/+$/, '');
    if (cleanAppPath.toLowerCase().startsWith('/masterv')) {
      if (/\/MasterV[0-9.]+/i.test(finalBase)) {
        finalBase = finalBase.replace(/\/MasterV[0-9.]+/gi, cleanAppPath);
      } else {
        finalBase = `${finalBase}${cleanAppPath}`;
      }
    } else if (!finalBase.toLowerCase().includes(cleanAppPath.toLowerCase())) {
      finalBase = `${finalBase}${cleanAppPath}`;
    }
  }

  let roleRoute = (options.userRoleRoute && options.userRoleRoute.trim())
    ? options.userRoleRoute.trim()
    : 'addUserRole';

  // If userRoleRoute is a full URL, extract its pathname
  if (roleRoute.startsWith('http://') || roleRoute.startsWith('https://')) {
    try {
      const u = new URL(roleRoute);
      roleRoute = u.pathname;
    } catch {}
  }

  // Strip baseUrl pathname if cleanRoute starts with it
  try {
    const baseObj = new URL(finalBase);
    const basePath = baseObj.pathname.replace(/\/+$/, '');
    if (basePath && basePath !== '/' && roleRoute.toLowerCase().startsWith(basePath.toLowerCase())) {
      roleRoute = roleRoute.slice(basePath.length);
    }
  } catch {}

  // Strip any version path prefix if already in finalBase
  const baseVersionMatch = finalBase.match(/\/MasterV[0-9.]+/i);
  if (baseVersionMatch && roleRoute.toLowerCase().startsWith(baseVersionMatch[0].toLowerCase())) {
    roleRoute = roleRoute.slice(baseVersionMatch[0].length);
  }

  roleRoute = roleRoute.replace(/^\/+/, '');
  if (!roleRoute) {
    roleRoute = 'addUserRole';
  }

  const constructed = new URL(roleRoute, ensureTrailingSlash(finalBase)).toString();
  const versionMatches = constructed.match(/\/MasterV[0-9.]+/gi);
  if (versionMatches && versionMatches.length > 1) {
    const lastVersion = versionMatches[versionMatches.length - 1];
    return constructed.replace(/(\/MasterV[0-9.]+)+/gi, lastVersion).replace(/\/+$/, '');
  }

  return constructed.replace(/\/+$/, '');
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
 * - Treats stored client baseUrl as authoritative and complete.
 * - Appends endpoint route only using: new URL(endpoint, ensureTrailingSlash(baseUrl)).toString()
 * - Never duplicates /MasterV9.3 or any version path.
 */
export function resolveClientRoute(options: ResolveClientRouteOptions): string {
  const { baseUrl, applicationPath, route, fallbackRoute = '/' } = options;

  if (!baseUrl || typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new Error('MISSING_CLIENT_URL: Base URL is required');
  }

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

  const normalizedBase = normalizeClientBaseUrl(baseUrl.trim());

  let finalBase = normalizedBase;
  if (applicationPath && applicationPath.trim()) {
    const appPath = applicationPath.trim().startsWith('/')
      ? applicationPath.trim()
      : `/${applicationPath.trim()}`;
    const cleanAppPath = appPath.replace(/\/+$/, '');
    if (cleanAppPath.toLowerCase().startsWith('/masterv')) {
      if (/\/MasterV[0-9.]+/i.test(finalBase)) {
        finalBase = finalBase.replace(/\/MasterV[0-9.]+/gi, cleanAppPath);
      } else {
        finalBase = `${finalBase}${cleanAppPath}`;
      }
    } else if (!finalBase.toLowerCase().includes(cleanAppPath.toLowerCase())) {
      finalBase = `${finalBase}${cleanAppPath}`;
    }
  }

  let endpointRoute = targetRoute;

  // Strip baseUrl pathname if cleanRoute starts with it
  try {
    const baseObj = new URL(finalBase);
    const basePath = baseObj.pathname.replace(/\/+$/, '');
    if (basePath && basePath !== '/' && endpointRoute.toLowerCase().startsWith(basePath.toLowerCase())) {
      endpointRoute = endpointRoute.slice(basePath.length);
    }
  } catch {}

  // Strip any version path prefix if already in finalBase
  const baseVersionMatch = finalBase.match(/\/MasterV[0-9.]+/i);
  if (baseVersionMatch && endpointRoute.toLowerCase().startsWith(baseVersionMatch[0].toLowerCase())) {
    endpointRoute = endpointRoute.slice(baseVersionMatch[0].length);
  }

  endpointRoute = endpointRoute.replace(/^\/+/, '');
  if (!endpointRoute) {
    return finalBase;
  }

  const constructed = new URL(endpointRoute, ensureTrailingSlash(finalBase)).toString();
  const versionMatches = constructed.match(/\/MasterV[0-9.]+/gi);
  if (versionMatches && versionMatches.length > 1) {
    const lastVersion = versionMatches[versionMatches.length - 1];
    return constructed.replace(/(\/MasterV[0-9.]+)+/gi, lastVersion).replace(/\/+$/, '');
  }

  return constructed.replace(/\/+$/, '');
}

export interface ResolveClientResourceUrlOptions {
  baseUrl?: string;
  configuredUrl?: string;
  applicationPath?: string;
  quickResourceRoute?: string | null;
}

export function resolveClientResourceUrl(options: ResolveClientResourceUrlOptions): string {
  const rawUrl = options.configuredUrl || options.baseUrl;
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('MISSING_CLIENT_URL: Client configured base URL is required to resolve resource URL');
  }

  const resourceRouteRaw = options.quickResourceRoute || '/addResourceParentDetails';
  return resolveClientRoute({
    baseUrl: rawUrl,
    applicationPath: options.applicationPath,
    route: resourceRouteRaw,
    fallbackRoute: '/addResourceParentDetails',
  });
}

export interface ResolveClientResourceUserMappingUrlOptions {
  baseUrl?: string;
  configuredUrl?: string;
  applicationPath?: string;
  resourceUserRoute?: string | null;
}

export function resolveClientResourceUserMappingUrl(options: ResolveClientResourceUserMappingUrlOptions): string {
  const rawUrl = options.configuredUrl || options.baseUrl;
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('MISSING_CLIENT_URL: Client configured base URL is required to resolve resource user mapping URL');
  }

  const mappingRouteRaw = options.resourceUserRoute || '/addParentResourceUser';
  return resolveClientRoute({
    baseUrl: rawUrl,
    applicationPath: options.applicationPath,
    route: mappingRouteRaw,
    fallbackRoute: '/addParentResourceUser',
  });
}

export interface ResolveClientEmrPanelUrlOptions {
  baseUrl?: string;
  configuredUrl?: string;
  applicationPath?: string;
  emrPanelRoute?: string | null;
}

export function resolveClientEmrPanelUrl(options: ResolveClientEmrPanelUrlOptions): string {
  const rawUrl = options.configuredUrl || options.baseUrl;
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('MISSING_CLIENT_URL: Client configured base URL is required to resolve EMR panel URL');
  }

  const emrRouteRaw = options.emrPanelRoute || '/emrPanelSelection';
  return resolveClientRoute({
    baseUrl: rawUrl,
    applicationPath: options.applicationPath,
    route: emrRouteRaw,
    fallbackRoute: '/emrPanelSelection',
  });
}

export interface ResolveClientEclaimUserUrlOptions {
  baseUrl?: string;
  configuredUrl?: string;
  applicationPath?: string;
  eclaimUserRoute?: string | null;
}

export function resolveClientEclaimUserUrl(options: ResolveClientEclaimUserUrlOptions): string {
  const rawUrl = options.configuredUrl || options.baseUrl;
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('MISSING_CLIENT_URL: Client configured base URL is required to resolve eClaim user URL');
  }

  const eclaimRouteRaw = options.eclaimUserRoute || '/addUserEclaim';
  return resolveClientRoute({
    baseUrl: rawUrl,
    applicationPath: options.applicationPath,
    route: eclaimRouteRaw,
    fallbackRoute: '/addUserEclaim',
  });
}


