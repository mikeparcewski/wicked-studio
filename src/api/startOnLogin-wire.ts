/**
 * Wire shape of crew's start-on-login read (studio#1324, crew#1829; wicked-crew-api-types `StartOnLoginStatus`, not yet
 * in a published api-types). Studio pins an older api-types, so it is typed here, field for field, until the pin moves.
 */

/**
 * `GET /api/v1/settings/start-on-login`: whether this daemon's port starts at login. The unit is the one
 * `wicked-crew serve --install-service` writes for the port: a launchd agent on macOS, a systemd user unit on Linux.
 * Elsewhere (`platform: 'other'`, Windows) nothing is automated: the install command prints a Task Scheduler recipe and
 * `installed` is always false. Installing and removing stay CLI steps; these are their commands.
 */
export interface StartOnLoginStatus {
  platform: 'darwin' | 'linux' | 'other';
  /** The port this daemon listens on: the unit is per port. */
  port: number;
  installed: boolean;
  /** The unit file, home-relative (`~/Library/LaunchAgents/…`); `null` when none is installed. */
  unit: string | null;
  /** `wicked-crew serve --port <port> --install-service`. */
  installCommand: string;
  /** `wicked-crew serve --port <port> --uninstall-service`. */
  uninstallCommand: string;
}
