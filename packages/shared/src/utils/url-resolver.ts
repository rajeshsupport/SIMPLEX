export interface ResolveClientRouteOptions {
  baseUrl: string;
  applicationPath?: string;
  route?: string;
  fallbackRoute?: string;
}

/**
 * Normalizes and resolves client routes safely.
 * - Normalizes trailing/leading slashes.
 * - Removes any existing /MasterVx.x segment from baseUrl before adding applicationPath.
 * - Never concatenates duplicate version paths.
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
