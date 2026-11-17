/**
 * dsh-money-board — Client half.
 * 徽标与浮层全部使用 DSH 主题变量（--dsw-alias-*），深浅色主题自动跟随，不写死底色。
 * 数据链：同源读 /save-token/api/dashboard → POST /money-board/api/compute（Host 折钱）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-money-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const CSS = `
.mb-wrap{position:relative;display:inline-flex;width:max-content;max-width:100%;font-family:inherit}
.mb-pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1;
  padding:3px 10px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:transparent;
  color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;cursor:default}
.mb-wrap:hover .mb-pill{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.mb-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#16a34a);flex:0 0 auto}
.mb-dot.peak{background:var(--dsw-alias-state-warn-primary,#b45309)}
.mb-dot.off{background:var(--dsw-alias-label-tertiary,#9ca3af)}
.mb-strong{color:var(--dsw-alias-label-primary,#1f2937);font-weight:600;font-variant-numeric:tabular-nums}
.mb-sep{color:var(--dsw-alias-label-tertiary,#9ca3af)}
.mb-tip{position:absolute;left:0;bottom:calc(100% + 6px);z-index:60;pointer-events:none;
  display:grid;grid-template-columns:auto 1fr;column-gap:14px;row-gap:3px;align-items:baseline;
  min-width:252px;max-width:min(520px,88vw);padding:9px 12px;
  border:1px solid var(--dsw-alias-border-l2,#d1d5db);
  border-radius:var(--dsw-radius-md,10px);
  background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));
  box-shadow:var(--dsw-elevation-panel,0 3px 8px rgba(0,0,0,.06),0 0 16px rgba(0,0,0,.04));
  color:var(--dsw-alias-label-secondary,#6b7280);
  font-size:12px;line-height:1.5;white-space:normal}
.mb-h{grid-column:1 / -1;color:var(--dsw-alias-label-primary,#1f2937);font-weight:600;margin-bottom:3px}
.mb-h .mb-dim{font-weight:400;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.mb-k{color:var(--dsw-alias-label-tertiary,#9ca3af);white-space:nowrap}
.mb-v{text-align:right;color:var(--dsw-alias-label-primary,#1f2937);
  font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.mb-pct{color:var(--dsw-alias-label-tertiary,#9ca3af);font-weight:400;margin-left:8px}
.mb-f{grid-column:1 / -1;color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:11px;margin-top:3px}
`

    const sym = (cur) => (cur === 'USD' ? '$' : '¥')
    const body = (n) => (n >= 10 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toFixed(4))
    function money(v, cur) {
      return sym(cur) + body(Number(v) || 0)
    }
    function range(low, high, cur) {
      return sym(cur) + body(Number(low) || 0) + '~' + body(Number(high) || 0)
    }
    function tok(v) {
      const n = Number(v) || 0
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
      if (n >= 1e3) return Math.round(n / 1e3) + 'K'
      return String(Math.round(n))
    }
    function clock(ms) {
      try {
        return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        function lang() {
          try {
            const loc = ctx.locale
            const raw = typeof loc === 'string' ? loc : loc && (loc.current || loc.locale || loc.lang || loc.id)
            if (typeof raw === 'string' && raw) return raw.slice(0, 2).toLowerCase()
          } catch {
            /* locale service 缺失时回退 <html lang> */
          }
          try {
            const html = document.documentElement && document.documentElement.lang
            if (html) return String(html).slice(0, 2).toLowerCase()
          } catch {
            /* ignore */
          }
          return 'en'
        }

        function MoneyBoard() {
          const zh = lang() === 'zh'
          const [snap, setSnap] = React.useState(null)
          const [totals, setTotals] = React.useState(null)
          const [error, setError] = React.useState('')
          const [open, setOpen] = React.useState(false)

          React.useEffect(() => {
            let alive = true
            let timer = null
            const tick = async () => {
              try {
                const res = await fetch('/save-token/api/dashboard', { cache: 'no-store' })
                if (!res.ok) throw new Error('save-token')
                const payload = await res.json()
                const out = await fetch('/money-board/api/compute', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(payload),
                  cache: 'no-store',
                }).then((r) => r.json())
                if (!alive) return
                if (!out || !out.ok) {
                  setError(out && out.error === 'pricing-not-found' ? 'pricing' : String((out && out.error) || 'error'))
                  setSnap(null)
                } else {
                  setError('')
                  setSnap(out)
                  setTotals(payload.totals || null)
                }
              } catch (e) {
                if (!alive) return
                setError(String((e && e.message) || e) === 'save-token' ? 'no-save-token' : 'offline')
                setSnap(null)
              }
              if (alive) timer = setTimeout(tick, 30000)
            }
            tick()
            return () => {
              alive = false
              if (timer) clearTimeout(timer)
            }
          }, [])

          const style = h('style', { key: 's' }, CSS)
          const shell = (children) =>
            h('div', {
              className: 'mb-wrap',
              onMouseEnter: () => setOpen(true),
              onMouseLeave: () => setOpen(false),
            }, ...children)

          if (!snap) {
            const msg =
              error === 'no-save-token'
                ? zh ? '省钱看板 · 未检测到 save-token' : 'Money board · save-token missing'
                : error === 'pricing'
                  ? zh ? '省钱看板 · 缺少成本价表' : 'Money board · price table missing'
                  : zh ? '省钱看板 · 等待数据…' : 'Money board · waiting…'
            return shell([style, h('span', { className: 'mb-pill' }, h('span', { className: 'mb-dot off' }), msg)])
          }

          const cur = snap.currency
          const ph = snap.phase || {}
          const c = snap.spend
          const total = c.total
          const idle = !snap.counters || snap.counters.requests === 0
          const pct = (v) => (total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '—')
          const phaseChar = ph.label === 'peak' ? (zh ? '峰' : 'peak')
            : ph.label === 'weekend' ? (zh ? '周末' : 'wknd')
              : ph.label === 'holiday' ? (zh ? '假日' : 'hol')
                : (zh ? '谷' : 'off')
          const dim = (t) => h('span', { className: 'mb-dim' }, t)

          const pill = h('span', { className: 'mb-pill' },
            h('span', { className: 'mb-dot' + (ph.inPeak ? ' peak' : idle ? ' off' : '') }),
            h('span', null, zh ? '省钱看板' : 'Money board'),
            idle
              ? dim(zh ? ' · 本会话待计费' : ' · idle')
              : [
                  h('span', { key: 'p', className: 'mb-strong' }, ' ' + phaseChar + ' ' + money(total, cur)),
                  h('span', { key: 's1', className: 'mb-sep' }, ' · '),
                  h('span', { key: 's', className: 'mb-strong' }, (zh ? '省 ' : 'saved ') + range(snap.saved.low, snap.saved.high, cur)),
                  h('span', { key: 's2', className: 'mb-sep' }, ' · '),
                  h('span', { key: 'o', className: 'mb-strong' }, (zh ? '错峰 ' : 'off-peak ') + money(snap.peak.delta, cur)),
                ])

          if (!open || idle) return shell([style, pill])

          const rows = []
          const kv = (k, v, extra) => {
            rows.push(h('div', { className: 'mb-k', key: 'k' + k }, k))
            rows.push(h('div', { className: 'mb-v', key: 'v' + k }, v, extra ? h('span', { className: 'mb-pct' }, extra) : null))
          }
          rows.push(h('div', { className: 'mb-h', key: 'h' },
            snap.model,
            dim(zh
              ? ` · ${phaseChar}时${ph.nextAt ? ` · ${clock(ph.nextAt)} ${ph.nextIntoPeak ? '转峰时 ×2' : '回谷时'}` : ''}`
              : ` · ${ph.label || ''}${ph.nextAt ? ` · ${clock(ph.nextAt)} ${ph.nextIntoPeak ? 'to peak ×2' : 'to off-peak'}` : ''}`)))

          kv(zh ? '本会话花费' : 'spend', money(total, cur))
          kv(zh ? '未命中输入' : 'cache miss', money(c.miss, cur), pct(c.miss))
          kv(zh ? '缓存读' : 'cache read', money(c.hit, cur), pct(c.hit))
          kv(zh ? '输出' : 'output', money(c.out, cur), pct(c.out))
          kv(zh ? '压缩省下' : 'compression saved', range(snap.saved.low, snap.saved.high, cur),
            total > 0 ? `${((snap.saved.low / total) * 100).toFixed(1)}%` : undefined)
          kv(zh ? '错峰可省' : 'off-peak saving', money(snap.peak.delta, cur))

          const foot = totals
            ? zh
              ? `${tok(totals.inputTokens)} 输入 · ${tok(totals.cacheReadTokens ?? totals.cachedTokens)} 缓存 · ${tok(totals.outputTokens)} 输出 · 命中 ${snap.counters.cacheHitPct}% · ${snap.counters.requests} 请求 · 压缩 ${snap.counters.compressions} 次`
              : `${tok(totals.inputTokens)} in · ${tok(totals.cacheReadTokens ?? totals.cachedTokens)} cached · ${tok(totals.outputTokens)} out · hit ${snap.counters.cacheHitPct}% · ${snap.counters.requests} requests · ${snap.counters.compressions} compressions`
            : ''
          if (foot) rows.push(h('div', { className: 'mb-f', key: 'f' }, foot))

          return shell([style, pill, h('div', { className: 'mb-tip' }, ...rows)])
        }

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'money-board', order: 6 }, MoneyBoard))
      },
    }
  },
})
