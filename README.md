# dsh-money-board

**Session cost board for DeepSeek Harness — turns token counters into money.**

`save-token` tells you how many tokens you saved. `dsh-cost-meter` tells you what you spent. Neither tells you what the savings were *worth*. This plugin closes that gap: it multiplies the real token counters by DeepSeek's **official price table** and puts the answer above the composer.

```
● 省钱看板 谷 ¥3.0554 · 省 ¥0.0276~1.3778 · 错峰 ¥3.0554
```

Hover for the breakdown:

```
deepseek-flash · 谷时 · 09:00 转峰时 ×2
本会话花费                          ¥3.0554
未命中输入                          ¥0.4949   16.2%
缓存读                              ¥1.5742   51.5%
输出                                ¥0.9863   32.3%
压缩省下                     ¥0.0276~1.3778   0.9%
错峰可省                            ¥3.0554
150K 输入 · 17.1M 缓存 · 89.9K 输出 · 命中 98.6% · 260 请求 · 压缩 11 次
```

## Requirements

- DeepSeek Harness (dsh) with its Web GUI
- [`dsh-plugin-save-token`](https://www.npmjs.com/package/dsh-plugin-save-token) — provides the token counters (`/save-token/api/dashboard`)
- [`dsh-cost-meter`](https://www.npmjs.com/package/dsh-cost-meter) — provides the official price table and peak/off-peak windows

The badge degrades gracefully and says which one is missing.

## Install

```bash
dsh plugin --profile web add dsh-money-board
```

Or install it from the DSH plugin market / **Settings → Plugins → Add plugin**, then refresh the page.

## How it works

1. The client reads `GET /save-token/api/dashboard` (same origin, every 30 s).
2. It posts that payload to the host half at `POST /money-board/api/compute`.
3. The host imports `dsh-cost-meter`'s own `pricing.js` and uses `DEFAULT_PRICE_TABLE(_CNY)`, `DEFAULT_PEAK_WINDOWS`, `peakPhaseAt()` and `costOf()` to price every bucket.

**No prices are hardcoded.** When `dsh-cost-meter` syncs official pricing, this plugin follows automatically. Peak/off-peak uses the same constants: UTC 01–04 and 06–10 (09:00–12:00 and 14:00–18:00 Beijing), with weekends and Chinese public holidays fully off-peak.

## Configuration

`cordis.patch.yml` → `config`:

| key | default | meaning |
|---|---|---|
| `currency` | `CNY` | `CNY` uses the CNY table, `USD` the USD table |
| `model` | `auto` | `auto` reads the model from the profile's `agent-default-model`; or pin a model id |

## Why the savings are a range

`save-token` exposes only an aggregate `avoidedTokens`, so the plugin bounds it:

- **low** — every avoided token priced as a cache read (¥0.02/1M). History replays bill at exactly that rate, so the truth sits near the low end.
- **high** — every avoided token priced as a cache miss (¥1/1M). Only holds if the removed content was brand new and sent once.

On DeepSeek that gap is ~50×, which is the point: **compression barely moves the bill; peak/off-peak pricing moves it by 2×.**

## Limitations

- Counters live in the `save-token` process and reset when DSH restarts; the badge then shows an idle state.
- Depends on `save-token`'s private route and on `dsh-cost-meter`'s `lib/pricing.js`. If either changes shape, the badge reports `pricing`/`save-token` missing instead of guessing.
- Refresh rate is 30 s; this is not per-request metering.
- Client half is unverified only in the sense that visual regressions are the author's, not the API's: the compute endpoint is covered by the CLI in the same repository.

## License

MIT © YG
