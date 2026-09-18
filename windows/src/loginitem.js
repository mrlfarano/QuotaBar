export function loginItemOptions(app) {
  return {
    name: app.isPackaged ? 'QuotaBar' : 'QuotaBar (development)',
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  };
}

export function isLoginEnabled(app, options = loginItemOptions(app)) {
  // Electron parses this as a command line when looking up launchItems.
  const settings = app.getLoginItemSettings({ path: `"${options.path}"`, args: options.args });
  return settings.launchItems.some((item) => item.name === options.name && item.scope === 'user'
    && item.enabled && JSON.stringify(item.args) === JSON.stringify(options.args));
}

export function setLoginEnabled(app, enabled, options = loginItemOptions(app)) {
  app.setLoginItemSettings({ ...options, openAtLogin: enabled, enabled });
  if (isLoginEnabled(app, options) !== enabled) {
    throw new Error('Windows could not update Start at login. Please try again.');
  }
}
