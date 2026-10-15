/** Keep existing backups importable after the HomeTV rename. */
export const SETTINGS_FORMAT = 'HomeTV-Settings';
export function isSettingsFormat(name: unknown): boolean {
  return name === SETTINGS_FORMAT || name === 'LibreTV-Settings';
}
