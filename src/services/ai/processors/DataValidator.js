/**
 * isDataInsufficient
 * ------------------
 * Checks if the result is insufficient by:
 * 1) Checking for null/undefined values.
 * 2) For strings, checking if empty or containing "error".
 * 3) For arrays, considering it insufficient only if every element is insufficient.
 * 4) For objects, checking for minimal keys or explicit error signals.
 */
export function isDataInsufficient(result) {
  // 1) Null or undefined.
  if (result == null) {
    return true;
  }

  // 2) If it's a string, check for emptiness or error keywords.
  if (typeof result === "string") {
    if (containsErrorKeyword(result)) return true;
    return result.trim().length === 0;
  }

  // 3) If it's an array:
  if (Array.isArray(result)) {
    if (result.length === 0) return true;
    // Consider the array insufficient only if every element is insufficient.
    return result.every(item => isDataInsufficient(item));
  }

  // 4) If it's an object:
  if (typeof result === "object") {
    if (Object.keys(result).length === 0) return true;
    return objectHasErrorSignal(result);
  }

  // 5) For other types, assume the data is sufficient.
  return false;
}

/**
 * containsErrorKeyword
 * --------------------
 * Checks if the given text contains the substring "error" (case-insensitive).
 */
export function containsErrorKeyword(text) {
  return text.toLowerCase().includes("error");
}

/**
 * objectHasErrorSignal
 * --------------------
 * Checks whether an object contains an error signal.
 * It only flags if a key exactly indicates an error (e.g. "error", "errorMessage")
 * or if any value is a string that contains "error".
 */
export function objectHasErrorSignal(obj) {
  // Define a list of keys that we interpret as error signals.
  const errorKeys = ["error", "err", "errmsg", "errormessage"];
  
  for (const [key, val] of Object.entries(obj)) {
    // (a) Check if the key matches one of our error keys (case-insensitive)
    if (errorKeys.some(errKey => key.toLowerCase() === errKey)) {
      if (val) return true;
    }
    // (b) Check if the value is a string that contains "error"
    if (typeof val === "string" && containsErrorKeyword(val)) {
      return true;
    }
    // (c) For nested objects (but not arrays), do a shallow check.
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      if (Object.keys(val).some(k => errorKeys.includes(k.toLowerCase()))) {
        return true;
      }
    }
  }
  
  return false;
}
