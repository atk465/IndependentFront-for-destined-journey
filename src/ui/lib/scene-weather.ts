/**
 * scene-weather.ts — 场景天气的**唯一读取口**（地图 / 状态投影共用）。
 */

/**
 * 当前天气的中文词。读档变量袋 `sys.天气`，`worldFlags.天气` / `worldFlags.weather`
 * 兜旧存档。查不到返回 `undefined`，调用方自行决定缺省措辞。
 */
export function resolveSceneWeather(
  profile:
    | {
        variables?: Record<string, unknown>;
        worldFlags?: Record<string, unknown>;
      }
    | null
    | undefined,
): string | undefined {
  if (!profile) return undefined;
  const sys = profile.variables?.['sys'] as Record<string, unknown> | undefined;
  const flags = profile.worldFlags;
  const candidates = [sys?.['天气'], flags?.['天气'], flags?.['weather']];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}
