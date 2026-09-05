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
