export function shouldAttachAdminAuthorization(url, apiBase = "") {
  if (!url) return false;
  try {
    const base = apiBase || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const parsed = new URL(url, base);
    const origin = typeof window !== "undefined" ? window.location.origin : base;
    return parsed.origin === origin;
  } catch (error) {
    return false;
  }
}

export class RequestSerial {
  constructor() { this.value = 0; }
  next() { this.value += 1; return this.value; }
  invalidate() { this.value += 1; return this.value; }
  isCurrent(value) { return Number(value) === this.value; }
}
