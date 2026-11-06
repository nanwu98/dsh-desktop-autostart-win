/**
 * Browser half of the dsh-desktop-autostart-win bundle: one standalone
 * Settings page.
 *
 * The page shows what Windows currently holds (read from the Host on mount) and
 * writes the switch state straight back, so the only stored truth is the
 * startup entry itself. Every control is local — no Harness Client package is
 * loaded as a module — and styling uses theme tokens so light and dark both
 * follow the shell.
 * @module dsh-desktop-autostart-win/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-desktop-autostart-win',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this bundle. */
    const NS = 'desktop-autostart'
    const STATE_URL = '/dsh-desktop-autostart-win/state'
    const SET_URL = '/dsh-desktop-autostart-win/set'

    /** @type {Record<string, string>} */
    const en = {
      nav: 'Startup',
      title: 'Startup',
      intro:
        'Open the DeepSeek Harness desktop app automatically when you sign in to Windows. Turning this off removes the startup entry.',
      toggleTitle: 'Launch DeepSeek Harness at sign-in',
      onHint: 'On — the desktop app opens automatically the next time you sign in.',
      offHint: 'Off — the desktop app does not open automatically.',
      checking: 'Reading the startup entry…',
      loadFailed: 'The startup entry could not be read.',
      saveFailed: 'The startup entry could not be updated.',
      retry: 'Retry',
      target: 'Launch target',
      source: 'Detected via',
      sourceRunningApp: 'the running desktop app',
      sourceAppPaths: 'Windows App Paths',
      sourceInstallDir: 'the default install folder',
      sourceUninstall: 'the installer records',
      sourceUnknown: 'automatic detection',
      unsupportedPlatform: 'Startup is only available on Windows.',
      unsupportedNotFound:
        'The DeepSeek Harness desktop app could not be found on this computer. Install it, or start it once, then retry.',
      disabledByWindows:
        'The entry exists but Windows has it disabled (Task Manager → Startup). Turn the switch on again to re-enable it.',
      note: 'Writes one per-user startup value under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run and clears the Task Manager disable flag. No administrator rights, no network access, no telemetry.',
    }

    /** @type {Record<string, string>} */
    const zh = {
      nav: '开机自启',
      title: '开机自启',
      intro: '登录 Windows 后自动打开 DeepSeek Harness 桌面版。关闭后会移除该启动项。',
      toggleTitle: '登录时自动启动 DeepSeek Harness',
      onHint: '已开启：下次登录 Windows 时会自动打开桌面版。',
      offHint: '已关闭：登录 Windows 后不会自动打开桌面版。',
      checking: '正在读取启动项状态…',
      loadFailed: '无法读取启动项状态。',
      saveFailed: '无法更新启动项。',
      retry: '重试',
      target: '启动目标',
      source: '检测方式',
      sourceRunningApp: '正在运行的桌面版',
      sourceAppPaths: 'Windows App Paths',
      sourceInstallDir: '默认安装目录',
      sourceUninstall: '安装器记录',
      sourceUnknown: '自动检测',
      unsupportedPlatform: '开机自启仅在 Windows 上可用。',
      unsupportedNotFound:
        '没有在这台电脑上找到 DeepSeek Harness 桌面版。请安装桌面版，或先启动一次再重试。',
      disabledByWindows:
        '启动项还在，但已被 Windows 禁用（任务管理器 → 启动）。重新打开开关即可恢复。',
      note: '写入当前用户的启动项（HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run），并清除任务管理器里的禁用标记。不需要管理员权限，不联网，不上报任何数据。',
    }

    /** Detection source → dictionary key. */
    const SOURCE_KEYS = {
      'running-app': 'sourceRunningApp',
      'app-paths': 'sourceAppPaths',
      'install-dir': 'sourceInstallDir',
      uninstall: 'sourceUninstall',
    }

    /** Page styles; rendered with the component so unmounting removes them. */
    const CSS = `
.dsa-section{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsa-heading{margin:0;font-size:18px;font-weight:600;line-height:26px}
.dsa-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dsa-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:0 16px}
.dsa-row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:16px 0}
.dsa-copy{min-width:0}
.dsa-title{font-size:14px;line-height:20px}
.dsa-description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsa-target{margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsa-source{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsa-warn{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}
.dsa-error{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.dsa-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsa-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .15s ease}
.dsa-switch[data-on="true"]{background:var(--dsw-alias-brand-primary)}
.dsa-switch:disabled{opacity:.5;cursor:default}
.dsa-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsa-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.28);transition:transform .15s ease}
.dsa-switch[data-on="true"] .dsa-knob{transform:translateX(16px)}
.dsa-link{padding:0;border:0;background:none;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;text-decoration:underline}
`

    /**
     * Read one JSON endpoint.
     * @param {string} url - same-origin route.
     * @param {RequestInit} [options] - fetch options.
     * @returns {Promise<any>} parsed body.
     */
    async function requestJson(url, options) {
      const response = await fetch(url, {
        ...options,
        headers: { accept: 'application/json', ...(options && options.headers) },
      })
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`HTTP ${String(response.status)}`)
      }
      if (!response.ok || body?.ok === false) {
        throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${String(response.status)}`)
      }
      return body
    }

    /**
     * The startup switch.
     * @param {{checked: boolean, disabled: boolean, label: string, onChange: (next: boolean) => void}} props
     * @returns the switch button.
     */
    function Switch(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          className: 'dsa-switch',
          'aria-checked': props.checked,
          'aria-label': props.label,
          'data-on': props.checked ? 'true' : 'false',
          disabled: props.disabled,
          onClick: () => props.onChange(!props.checked),
        },
        h('span', { className: 'dsa-knob', 'aria-hidden': 'true' }),
      )
    }

    /**
     * Render the Startup settings page.
     * @param {{t?: (key: string) => string}} props - slot props.
     * @returns the section element tree.
     */
    function AutostartSection(props) {
      const translate = props && typeof props.t === 'function' ? props.t : undefined
      const t = (key) => (translate ? translate(key) : en[key] ?? key)

      const [phase, setPhase] = React.useState('loading')
      const [state, setState] = React.useState(undefined)
      const [failure, setFailure] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [attempt, setAttempt] = React.useState(0)

      React.useEffect(() => {
        let live = true
        setPhase('loading')
        setFailure(undefined)
        requestJson(STATE_URL)
          .then((next) => {
            if (!live) return
            setState(next)
            setPhase('ready')
          })
          .catch((error) => {
            if (!live) return
            setFailure(error instanceof Error ? error.message : String(error))
            setPhase('error')
          })
        return () => {
          live = false
        }
      }, [attempt])

      const enabled = state?.enabled === true
      const supported = state?.supported === true
      const registered = state?.registered === true
      const approved = state?.approved !== false
      const toggle = (next) => {
        setBusy(true)
        setFailure(undefined)
        requestJson(SET_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        })
          .then((updated) => {
            setState(updated)
            setPhase('ready')
          })
          .catch((error) => {
            setFailure(error instanceof Error ? error.message : String(error))
          })
          .finally(() => setBusy(false))
      }

      let description
      let warning
      if (phase === 'loading') description = t('checking')
      else if (phase === 'error') description = t('loadFailed')
      else if (!supported) {
        description = t(state?.unsupportedReason === 'platform' ? 'unsupportedPlatform' : 'unsupportedNotFound')
      } else if (registered && !approved) {
        description = t('offHint')
        warning = t('disabledByWindows')
      } else description = enabled ? t('onHint') : t('offHint')

      return h(
        'div',
        { className: 'dsa-section' },
        h('style', { key: 'dsa-css' }, CSS),
        h('h2', { className: 'dsa-heading', key: 'heading' }, t('title')),
        h('p', { className: 'dsa-intro', key: 'intro' }, t('intro')),
        h(
          'div',
          { className: 'dsa-card', key: 'card' },
          h(
            'div',
            { className: 'dsa-row' },
            h(
              'div',
              { className: 'dsa-copy' },
              h('div', { className: 'dsa-title' }, t('toggleTitle')),
              h('div', { className: 'dsa-description' }, description),
              supported && state?.appPath
                ? h('div', { className: 'dsa-target' }, `${t('target')}: ${state.appPath}`)
                : null,
              supported
                ? h(
                    'div',
                    { className: 'dsa-source' },
                    `${t('source')}: ${t(SOURCE_KEYS[state?.appPathSource] ?? 'sourceUnknown')}`,
                  )
                : null,
              warning ? h('div', { className: 'dsa-warn' }, warning) : null,
              failure
                ? h(
                    'div',
                    { className: 'dsa-error', role: 'alert' },
                    `${phase === 'error' ? t('loadFailed') : t('saveFailed')} ${failure} `,
                    phase === 'error'
                      ? h(
                          'button',
                          { type: 'button', className: 'dsa-link', onClick: () => setAttempt((n) => n + 1) },
                          t('retry'),
                        )
                      : null,
                  )
                : null,
            ),
            h(Switch, {
              checked: enabled,
              disabled: !supported || busy || phase !== 'ready',
              label: t('toggleTitle'),
              onChange: toggle,
            }),
          ),
        ),
        h('p', { className: 'dsa-note', key: 'note' }, t('note')),
      )
    }

    /**
     * Sidebar glyph addressed by the section id.
     * @param {{size?: number, active?: boolean}} props - slot props.
     * @returns the icon element.
     */
    function StartupIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16
      const color = props && props.active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)'
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M8 1.75v5.5',
          stroke: color,
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M4.6 4.35a5.1 5.1 0 1 0 6.8 0',
          stroke: color,
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Mount the page and its navigation glyph.
       * @param ctx - the browser plugin context.
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'desktop-autostart: dictionaries')
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'desktop-autostart',
              order: 50,
              label: () => t('nav'),
              locale: NS,
            },
            AutostartSection,
          ),
        )
        ctx.slots.inject('settings.section.icon', () =>
          ctx.slots.register({ name: 'settings.section.icon', id: 'desktop-autostart', order: 50 }, StartupIcon),
        )
      },
    }
  },
})
