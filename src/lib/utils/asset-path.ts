/**
 * assetPath — helper that prepends the Next.js basePath to a public asset URL.
 *
 * In development  : basePath is '' → '/vrm/Amiya.vrm'
 * On GitHub Pages : basePath is '/Ctrl_Alt_Moe' → '/Ctrl_Alt_Moe/vrm/Amiya.vrm'
 *
 * This uses the NEXT_PUBLIC_BASE_PATH env var, which is automatically set
 * from next.config.ts `basePath`.  Alternatively falls back to '' (dev).
 */
export function assetPath(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  if (!base) return path;
  // Avoid double slashes
  if (path.startsWith('/')) return `${base}${path}`;
  return `${base}/${path}`;
}
