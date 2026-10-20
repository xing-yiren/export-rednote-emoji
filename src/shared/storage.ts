/** chrome.storage.local 封装：只存少量偏好与临时状态，不存图片字节。 */
export interface Settings {
  concurrency: number;
  sort: 'discovery' | 'author';
  showAvatars: boolean;
}

export const DEFAULT_SETTINGS: Settings = { concurrency: 3, sort: 'discovery', showAvatars: true };

export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
