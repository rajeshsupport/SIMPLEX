import { ParsedRoleValidationResult, FormDropdownOption } from "../types/client-user.js";

/**
 * Parses and validates role cell values (supporting single roles, comma-separated multiple roles,
 * quotes, extra whitespace, and case-insensitive canonical mapping against live client roles).
 *
 * Order of operations:
 * Read raw cell -> split into individual roles -> trim each role -> remove quotes ->
 * remove empty tokens -> deduplicate -> canonicalise against live roles ->
 * validate each role individually -> create approved roles array.
 */
export function parseAndValidateRoles(
  rawValue: string | string[] | null | undefined,
  liveRoles: (string | FormDropdownOption | { roleName?: string; label?: string; value?: string })[] | Set<string> | Map<string, string> = []
): ParsedRoleValidationResult {
  if (rawValue === null || rawValue === undefined) {
    return {
      rawValue: "",
      parsedRoles: [],
      validRoles: [],
      invalidRoles: [],
      isValid: true,
      canonicalRoleString: "",
    };
  }

  const rawStr = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
  if (!rawStr.trim()) {
    return {
      rawValue: rawStr,
      parsedRoles: [],
      validRoles: [],
      invalidRoles: [],
      isValid: true,
      canonicalRoleString: "",
    };
  }

  // Build canonical map (lowercased trimmed name -> exact canonical live role name)
  const canonicalMap = new Map<string, string>();
  if (Array.isArray(liveRoles)) {
    for (const item of liveRoles) {
      const name = typeof item === "string" ? item : ((item as any)?.roleName || (item as any)?.label || (item as any)?.value || "");
      if (name && typeof name === "string" && name.trim()) {
        canonicalMap.set(name.trim().toLowerCase(), name.trim());
      }
    }
  } else if (liveRoles instanceof Set) {
    for (const name of liveRoles) {
      if (name && String(name).trim()) {
        canonicalMap.set(String(name).trim().toLowerCase(), String(name).trim());
      }
    }
  } else if (liveRoles instanceof Map) {
    for (const [k, v] of liveRoles.entries()) {
      if (k && String(k).trim()) {
        canonicalMap.set(String(k).trim().toLowerCase(), String(v).trim());
      }
    }
  }

  // Split raw cell by comma if string, or take elements if array
  const rawTokens = Array.isArray(rawValue) ? rawValue : rawStr.split(",");
  const seenNorm = new Set<string>();
  const parsedRoles: string[] = [];

  for (const token of rawTokens) {
    let cleaned = String(token).trim();
    // Strip leading/trailing double quotes, single quotes, backticks
    while (cleaned.length > 0 && ('"`'.includes(cleaned[0]) || '"`'.includes(cleaned[cleaned.length - 1]))) {
      cleaned = cleaned.replace(/^['"\s`]+/, "").replace(/['"\s`]+$/, "").trim();
    }
    if (!cleaned) continue;

    const norm = cleaned.toLowerCase();
    if (!seenNorm.has(norm)) {
      seenNorm.add(norm);
      parsedRoles.push(cleaned);
    }
  }

  const validRoles: string[] = [];
  const invalidRoles: string[] = [];

  for (const role of parsedRoles) {
    const norm = role.toLowerCase();
    if (canonicalMap.size > 0) {
      if (canonicalMap.has(norm)) {
        validRoles.push(canonicalMap.get(norm)!);
      } else {
        invalidRoles.push(role);
      }
    } else {
      // If live options are empty, preserve parsed role as valid
      validRoles.push(role);
    }
  }

  const isValid = invalidRoles.length === 0;
  const canonicalRoleString = validRoles.join(", ");

  return {
    rawValue: rawStr,
    parsedRoles,
    validRoles,
    invalidRoles,
    isValid,
    canonicalRoleString,
  };
}

export interface RoleDiffResult {
  existingRoles: string[];
  rolesToAdd: string[];
  rolesUnchanged: string[];
  rolesRemoved: string[];
  resultingRoles: string[];
}

/**
 * Computes an additive role diff between existing user roles and selected roles.
 * Existing mapped roles are preserved and cannot be removed in this additive version.
 */
export function computeRoleDiff(
  existingRoles: (string | null | undefined)[],
  selectedRoles: (string | null | undefined)[]
): RoleDiffResult {
  const existingSet = new Set(
    existingRoles
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      .map((r) => r.trim())
  );
  const existingNormMap = new Map<string, string>();
  for (const r of existingSet) {
    existingNormMap.set(r.toLowerCase(), r);
  }

  const selectedList = selectedRoles
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .map((r) => r.trim());

  const rolesToAdd: string[] = [];
  const rolesUnchanged: string[] = [];
  const seenToAdd = new Set<string>();

  for (const sel of selectedList) {
    const norm = sel.toLowerCase();
    if (existingNormMap.has(norm)) {
      const canonical = existingNormMap.get(norm)!;
      if (!rolesUnchanged.includes(canonical)) {
        rolesUnchanged.push(canonical);
      }
    } else {
      if (!seenToAdd.has(norm)) {
        seenToAdd.add(norm);
        rolesToAdd.push(sel);
      }
    }
  }

  // Any existing role not in rolesUnchanged is still preserved in additive mode
  for (const r of existingSet) {
    if (!rolesUnchanged.includes(r)) {
      rolesUnchanged.push(r);
    }
  }

  const resultingRoles = Array.from(new Set([...Array.from(existingSet), ...rolesToAdd]));

  return {
    existingRoles: Array.from(existingSet),
    rolesToAdd,
    rolesUnchanged,
    rolesRemoved: [], // Strictly additive - zero removals
    resultingRoles,
  };
}

/**
 * Converts role names or role objects to standardized { roleId, canonicalRoleName } items.
 * Guaranteed: Never substitutes a remote control code for canonicalRoleName.
 */
export function toRoleItems(
  roles: (string | { roleId?: string; canonicalRoleName?: string; roleName?: string; label?: string; value?: string } | null | undefined)[],
  catalog?: (string | { roleId?: string; canonicalRoleName?: string; roleName?: string; label?: string; value?: string })[]
): { roleId: string; canonicalRoleName: string }[] {
  const result: { roleId: string; canonicalRoleName: string }[] = [];
  const seen = new Set<string>();

  // Build catalog lookup: normalized name -> { roleId, canonicalRoleName }
  const catalogMap = new Map<string, { roleId: string; canonicalRoleName: string }>();
  if (catalog) {
    for (const c of catalog) {
      if (!c) continue;
      if (typeof c === 'string') {
        const trimmed = c.trim();
        if (trimmed) {
          catalogMap.set(trimmed.toLowerCase(), {
            roleId: trimmed.toLowerCase().replace(/[^a-z0-9_-]/gi, '_'),
            canonicalRoleName: trimmed,
          });
        }
      } else {
        const name = (c.canonicalRoleName || c.roleName || c.label || c.value || '').trim();
        const id = (c.roleId || c.value || name.toLowerCase().replace(/[^a-z0-9_-]/gi, '_')).trim();
        if (name) {
          catalogMap.set(name.toLowerCase(), {
            roleId: id || name.toLowerCase().replace(/[^a-z0-9_-]/gi, '_'),
            canonicalRoleName: name,
          });
        }
      }
    }
  }

  for (const item of roles) {
    if (!item) continue;
    let name = '';
    let id = '';

    if (typeof item === 'string') {
      const trimmed = item.trim();
      // If it's a JSON string of role items
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          name = (parsed.canonicalRoleName || parsed.roleName || parsed.label || parsed.value || '').trim();
          id = (parsed.roleId || parsed.value || name.toLowerCase().replace(/[^a-z0-9_-]/gi, '_')).trim();
        } catch {
          name = trimmed;
          id = trimmed.toLowerCase().replace(/[^a-z0-9_-]/gi, '_');
        }
      } else {
        name = trimmed;
        id = trimmed.toLowerCase().replace(/[^a-z0-9_-]/gi, '_');
      }
    } else {
      name = (item.canonicalRoleName || item.roleName || item.label || item.value || '').trim();
      id = (item.roleId || item.value || name.toLowerCase().replace(/[^a-z0-9_-]/gi, '_')).trim();
    }

    if (!name) continue;

    // Check catalog for canonical name and stable id
    const norm = name.toLowerCase();
    const catalogEntry = catalogMap.get(norm);
    if (catalogEntry) {
      name = catalogEntry.canonicalRoleName;
      if (catalogEntry.roleId) id = catalogEntry.roleId;
    }

    if (!seen.has(norm)) {
      seen.add(norm);
      result.push({
        roleId: id || norm.replace(/[^a-z0-9_-]/gi, '_'),
        canonicalRoleName: name,
      });
    }
  }

  return result;
}
