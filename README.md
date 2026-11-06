# dsh-desktop-autostart-win

Windows sign-in autostart for the **DeepSeek Harness desktop app**. The plugin
adds one page to Settings — **Startup / 开机自启** — with a single switch.

| Switch | Effect |
| --- | --- |
| On | Writes `DeepSeek Harness` = `"<desktop app>.exe"` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, and clears a previous "disabled" decision from Task Manager, so Windows launches the app after you sign in. |
| Off | Deletes that value, so the app no longer starts by itself. |

Nothing is duplicated in the plugin config: the startup entry is the only stored
state, so the page always reports what Windows will actually run.

## Install

Requires **DSH 0.2.2-rc.1 or newer** (0.2.x) and **Windows 10/11**. Replace
`desktop` with the profile you actually start DSH with.

### From npm

```sh
dsh plugin --profile desktop add dsh-desktop-autostart-win
```

### From GitHub

This form needs Git on the machine (DSH checks the repository with
`git ls-remote` before installing):

```sh
dsh plugin --profile desktop add github:nanwu98/dsh-desktop-autostart-win
```

Pin a release with `#v1.0.0`:

```sh
dsh plugin --profile desktop add github:nanwu98/dsh-desktop-autostart-win#v1.0.0
```

### From the plugin page

Open **插件 → 添加插件**, paste the package name
`dsh-desktop-autostart-win` or the repository URL, and install. Restart DSH if
the page asks for it; then open **设置 → 开机自启**.

## How the app is found

The plugin never hard-codes an install path. It tries these sources in order
and stops at the first existing executable:

| Source | What it reads |
| --- | --- |
| Running desktop app | `process.execPath` when the Host is the desktop app itself |
| App Paths | `App Paths\DeepSeek Harness.exe` under HKCU and HKLM, 64- and 32-bit views |
| Install folders | `%LOCALAPPDATA%\Programs`, `%ProgramFiles%`, `%ProgramFiles(x86)%` + the usual product folder names |
| Installer records | `DisplayIcon`, `InstallLocation`, `UninstallString` in the HKCU/HKLM uninstall keys |

Only a real `.exe` is accepted, and `node.exe`, `electron.exe` and uninstallers
are rejected. The Settings page shows which source matched, so you can tell why
a path was chosen. A miss is retried on the next page load (the result is cached
for one minute).

This means the switch still works from a plain `dsh` CLI session: the desktop
app is found from the registry even though the CLI itself is `node.exe`.

## The startup entry

Windows has two places that decide whether a startup entry runs: the `Run` key
and Task Manager's approval record. The plugin writes the first and clears the
second, so an entry that was disabled in **Task Manager → Startup** comes back
when you turn the switch on. If the entry exists but is still disabled, the page
says so instead of pretending it is on.

Administrator rights are not required: everything is per-user (`HKCU`) and
nothing is written machine-wide.

## Permissions and privacy

Reads, only to find the app and report state:

- `HKCU\...\CurrentVersion\Run` and `...\Explorer\StartupApproved\Run`
- `App Paths` under HKCU/HKLM (64- and 32-bit views)
- Uninstall records under HKCU/HKLM (only the display name, icon, install
  folder, and uninstall command)

Writes, only when you use the switch:

- adds or deletes the `DeepSeek Harness` value in the per-user `Run` key
- deletes the matching `StartupApproved` value so Windows does not skip it

The plugin makes **no network requests**, writes **no files**, and collects
**no telemetry**. The detected path and registry values are returned only to the
local Settings page (the routes reject non-loopback peers and are read-only
except for the one boolean switch).

## Uninstall

Turn the switch off first if you no longer want the app to start at sign-in, then
remove the bundle:

```sh
dsh plugin --profile desktop remove dsh-desktop-autostart-win
```

Removing the bundle deletes the routes and the page. It does not clear the
startup entry.

## Development

The package is plain ESM JavaScript with no build step and no runtime
dependencies. Run the unit tests with:

```sh
npm test
```

The tests cover the registry-output parser, encoding fallback, path cleanup,
approval record decoding, and the executable-name filter. They do not touch the
real registry.

## Compatibility

- DSH `>=0.2.2-rc.1 <0.3.0` (declared in `engines.dsh`; DSH refuses versions
  outside the range before installing)
- Windows 10/11 (`dsh.bundle.platforms` is `["win32"]`, so other systems are
  rejected instead of showing a dead switch)
- Node.js 22+ (the runtime bundled with DSH)

## Plugin index

This repository also publishes a format-1 plugin index, so the package can be
discovered from the built-in **Discover** tab:

- `https://raw.githubusercontent.com/nanwu98/dsh-desktop-autostart-win/main/index.json`
- jsDelivr mirror: `https://cdn.jsdelivr.net/gh/nanwu98/dsh-desktop-autostart-win@main/index.json`

Add it under **插件 → 发现 → 索引源 → 添加索引源**. The Discover tab needs the
experimental `plugin-market` bundle enabled in this DSH release.

## License

MIT. This package is independent of other plugins with a similar name; it
manages the per-user `Run` key rather than the Startup folder.
