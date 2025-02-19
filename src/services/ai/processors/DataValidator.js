/**
   * isDataInsufficient
   * ------------------
   * Checks for:
   * 1) null/undefined
   * 2) minimal length for strings / JSON
   * 3) minimal array/object size
   * 4) presence of "error" property or content
*/
export function isDataInsufficient(result) {
    // 1) Null or undefined => insufficient
    if (!result) {
    return true;
    }

    // 2) If it's a string => check length & "error" mention
    if (typeof result === "string") {
    if (containsErrorKeyword(result)) return true;
    return false;
    }

    // 3) If it's an array => check minimal length & if any item says "error"
    if (Array.isArray(result)) {
    if (result.length < 1) return true;

    // Optionally scan each item if it's a string or object
    for (const item of result) {
        if (typeof item === "string" && containsErrorKeyword(item)) {
        return true;
        }
        if (typeof item === "object" && objectHasErrorSignal(item)) {
        return true;
        }
    }
    return false;
    }

    // By default, treat unknown types as insufficient
    return false;
}

 /**
 * containsErrorKeyword
 * --------------------
 * Simple check: does the text contain the substring "error"?
 * (case-insensitive)
 */
export function containsErrorKeyword(text) {
    return text.toLowerCase().includes("error");
}

/**
 * objectHasErrorSignal
 * --------------------
 * 1) Checks if any top-level key includes "error"
 * 2) Checks if the value is a string containing "error"
 * 3) Optionally, do a shallow or deep scan
 */
export function objectHasErrorSignal(obj) {
    // We do a shallow check here; you can recursively check nested objects if needed

    for (const [key, val] of Object.entries(obj)) {
        // (a) If the key contains the substring "error"
        if (key.toLowerCase().includes("error")) {
        return true;
        }

        // (b) If the value is a string containing "error"
        if (typeof val === "string" && containsErrorKeyword(val)) {
        return true;
        }

        // (c) If the value is itself an object: check if it has an "error" field
        if (typeof val === "object" && val != null) {
        // shallow check for "error" field
        if (Object.keys(val).some(k => k.toLowerCase().includes("error"))) {
            return true;
        }

        // optionally do a deeper recursive check:
        // if (this.objectHasErrorSignal(val)) return true;
        }
    }

    return false;
}