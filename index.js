/**
 * dsh-money-board — Host half.
 *
 * 只做两件事：把「token 统计」按官方价表折成钱，并把结果通过 Web 路由交给 Client。
 * 价格与峰谷窗口一律现读本机 dsh-cost-meter 的 pricing.js，本文件不写死任何单价。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const inject = ['webServer']

const DEFAULT_CFG = { currency: 'CNY', model: 'auto' }
const cache = { key: '', mod: null }

const dshHome = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const profilesDir = () => path.join(dshHome(), 'profiles')

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

async function loadPricing() {
  const dir = profilesDir()
  if (!fs.existsSync(dir)) return null
  for (const profile of fs.readdirSync(dir)) {
    const file = path.join(dir, profile, 'node_modules', 'dsh-cost-meter', 'lib', 'pricing.js')
    if (!fs.existsSync(file)) continue
    const key = `${file}@${fs.statSync(file).mtimeMs}`
    if (cache.key === key && cache.mod) return cache.mod
    const mod = await import(pathToFileURL(file).href)
    cache.key = key
    cache.mod = mod
    return mod
  }
  return null
}

function detectModel() {
  const dir = profilesDir()
  if (!fs.existsSync(dir)) return 'deepseek-flash'
  for (const profile of fs.readdirSync(dir)) {
    const file = path.join(dir, profile, 'cordis.patch.yml')
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    const at = text.indexOf('agent-default-model')
    if (at < 0) continue
    const m = text.slice(at, at + 400).match(/^\s*model:\s*([\w.\-]+)/m)
    if (m) return m[1]
  }
  return 'deepseek-flash'
}

async function compute(dash, cfg) {
  const P = await loadPricing()
  if (!P) return { ok: false, error: 'pricing-not-found' }

  const currency = cfg.currency === 'USD' ? 'USD' : 'CNY'
  const table = currency === 'USD' ? P.DEFAULT_PRICE_TABLE : P.DEFAULT_PRICE_TABLE_CNY
  if (!table || !table.models) return { ok: false, error: 'pricing-table-missing' }

  const wanted = cfg.model && cfg.model !== 'auto' ? String(cfg.model) : detectModel()
  const exact = Object.hasOwn(table.models, wanted) ? wanted : null
  const fuzzy = exact
    ? null
    : Object.keys(table.models).find((k) => k.toLowerCase().includes(wanted.toLowerCase())) || null
  const modelId = exact || fuzzy
  const entry = modelId ? table.models[modelId] : table.default
  if (!entry) return { ok: false, error: 'model-unpriced', model: wanted }

  const effectiveAt = Date.parse(P.DEFAULT_PEAK_EFFECTIVE_AT)
  const peakCfg = {
    enabled: true,
    effectiveAtMs: Number.isFinite(effectiveAt) ? effectiveAt : 0,
    windows: P.DEFAULT_PEAK_WINDOWS,
    holidays: P.DEFAULT_PEAK_HOLIDAYS,
  }

  const t = (dash && dash.totals) || {}
  const input = num(t.inputTokens)
  const cacheRead = num(t.cacheReadTokens ?? t.cachedTokens)
  const cacheWrite = num(t.cacheWriteTokens)
  const output = num(t.outputTokens)
  const reasoning = num(t.reasoningTokens)
  const avoided = num(t.avoidedTokens)
  const now = Date.now()

  const cost = (tokens, atMs) => {
    try {
      return num(P.costOf(tokens, entry, atMs, peakCfg))
    } catch {
      return 0
    }
  }

  const at = (atMs) => ({
    miss: cost({ input }, atMs),
    hit: cost({ cacheRead }, atMs),
    write: cost({ cacheWrite }, atMs),
    out: cost({ output }, atMs),
    reason: cost({ reasoning }, atMs),
  })
  const sum = (b) => b.miss + b.hit + b.write + b.out + b.reason

  const spend = at(now)
  const total = sum(spend)

  const nextPeakAt = (from) => {
    const phase = P.peakPhaseAt(from, peakCfg.windows, peakCfg.holidays)
    if (phase && phase.inPeak) return from
    if (phase && phase.nextIntoPeak) return phase.nextAtMs
    for (let h = 1; h <= 24 * 8; h += 1) {
      const candidate = from + h * 3600e3
      if (P.isPeakHour(candidate, peakCfg.effectiveAtMs, peakCfg.windows, peakCfg.holidays)) return candidate
    }
    return from
  }
  const peakAt = nextPeakAt(now)
  const peakTotal = sum(at(peakAt))

  const phase = P.peakPhaseAt(now, peakCfg.windows, peakCfg.holidays) || null
  const tier = P.tierFor(entry, now, peakCfg) || entry

  return {
    ok: true,
    at: now,
    currency,
    model: modelId || wanted,
    prices: {
      cacheHit: num(tier.cacheHit),
      cacheMiss: num(tier.cacheMiss),
      output: num(tier.output),
    },
    phase: phase
      ? {
          label: phase.holiday ? 'holiday' : phase.weekend ? 'weekend' : phase.inPeak ? 'peak' : 'offpeak',
          inPeak: phase.inPeak === true,
          nextAt: phase.nextAtMs || null,
          nextIntoPeak: phase.nextIntoPeak === true,
        }
      : null,
    counters: {
      requests: num(t.requests),
      cacheHitPct: num(dash && dash.cacheHitPct),
      compressions: num(dash && dash.compression && dash.compression.count),
      replays: num(dash && dash.compression && dash.compression.replays),
      avoidedTokens: avoided,
    },
    spend: { ...spend, total },
    saved: {
      low: cost({ cacheRead: avoided }, now),
      high: cost({ input: avoided }, now),
    },
    peak: { at: peakAt, total: peakTotal, delta: peakTotal - total },
  }
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CFG, ...(config || {}) }

  ctx.effect(
    () => {
      const handler = async (req, res) => {
        try {
          const route = String(req.url || '').split('?')[0].replace(/\/+$/, '')
          if (req.method === 'GET' && route.endsWith('/api/health')) {
            send(res, 200, { ok: true, plugin: 'dsh-money-board' })
            return
          }
          if (req.method === 'POST' && route.endsWith('/api/compute')) {
            const body = await readJson(req)
            send(res, 200, await compute(body, cfg))
            return
          }
          send(res, 404, { ok: false, error: 'unknown money-board endpoint' })
        } catch (error) {
          send(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      }
      return ctx.webServer.register({ kind: 'prefix', path: '/money-board', handler })
    },
    'money-board: compute API'
  )
}
