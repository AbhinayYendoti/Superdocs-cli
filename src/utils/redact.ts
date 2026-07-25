const SECRET_PATTERNS = [
  /\bsk_[A-Za-z0-9_.-]+\b/g,
  /\blce_[A-Za-z0-9_.-]+\b/g,
  /(api_key=)([^&\s]+)/gi,
  /(Authorization:\s*Bearer\s+)([^\s]+)/gi,
  /("(?:apiKey|api_key|SUPERDOCS_API_KEY)"\s*:\s*")([^"]+)(")/g
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => {
    if (pattern.source.includes("apiKey") || pattern.source.includes("SUPERDOCS_API_KEY")) {
      return current.replace(pattern, "$1[redacted]$3");
    }
    if (pattern.source.includes("api_key") || pattern.source.includes("Authorization")) {
      return current.replace(pattern, "$1[redacted]");
    }

    return current.replace(pattern, "[redacted]");
  }, value);
}
