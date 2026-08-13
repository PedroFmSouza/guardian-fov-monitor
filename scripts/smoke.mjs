/**
 * Smoke test end-to-end contra o build estático (dist/).
 * Sobe um servidor estático local, abre o Edge/Chrome instalado via CDP,
 * carrega as duas planilhas de amostra e valida os critérios de aceite:
 *  - upload duplicado não infla nenhuma agregação
 *  - "Detalhar" abre os 3 piores dias hora a hora e o pior turno
 *  - com uma semana só, o equipamento fica "em observação" (sem dado pós)
 *  - com dado pós-manutenção, a reincidência é detectada sem novo upload
 *  - encerrar e recolocar em observação preserva a série diária
 *  - nenhuma requisição de rede sai do host local
 *
 * Uso: node scripts/smoke.mjs   (requer dist/ e sample/ gerados)
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const dist = join(root, 'dist')

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
const executablePath = BROWSERS.find((p) => existsSync(p))
if (!executablePath) throw new Error('Nenhum Chromium encontrado (Edge/Chrome).')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0])
    const file = join(dist, url === '/' ? 'index.html' : url)
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  // profile fora do repositório: em pasta sincronizada (OneDrive) o Chrome
  // falha ao criar o perfil e o launch morre sem mensagem
  userDataDir: join(tmpdir(), 'gfm-smoke-profile'),
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-features=OptimizationGuideModelDownloading,MediaRouter',
  ],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1100 })

const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('pageerror', (e) => consoleErrors.push(String(e)))

const external = []
page.on('request', (r) => {
  if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external.push(r.url())
})

await page.goto(base, { waitUntil: 'networkidle0' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle0' })

const upload = async (...files) => {
  const input = await page.$('#file-input')
  await input.uploadFile(...files.map((f) => join(root, 'sample', f)))
  await page.waitForFunction(
    () => document.querySelector('#ingest-status').className.includes('ingest-status--ok'),
    { timeout: 20000 },
  )
  await new Promise((r) => setTimeout(r, 500))
}

const report = () => page.evaluate(() => window.__gfmReport)
const dailyTotals = () =>
  page.evaluate(() => {
    const daily = JSON.parse(localStorage.getItem('gfm.v2.daily') || '{}')
    const out = {}
    const count = (d) => (typeof d === 'number' ? d : (d.s1 || 0) + (d.s2 || 0))
    for (const [v, byDay] of Object.entries(daily)) {
      out[v] = Object.values(byDay).reduce((a, d) => a + count(d), 0)
    }
    return out
  })

// ---- 1ª carga -------------------------------------------------------------
await upload('guardian-semana-1.xlsx')
const report1 = await report()
const daily1 = await dailyTotals()
check(
  'upload 1 preenche os metadados do período',
  report1.rowCount > 0 && report1.fovCount > 0,
  `${report1.rowCount} linhas · ${report1.fovCount} FOV`,
)
check('upload não popula a lista de observação', (await page.$$('#wl-grid .wl-card')).length === 0)

// ---- indicação manual dos equipamentos em observação -----------------------
const OBSERVED = ['707', '224', '712', '208', '731']
for (const v of OBSERVED) {
  await page.evaluate((vehicle) => {
    document.querySelector('#wl-add').value = vehicle
    document.querySelector('#wl-add-btn').click()
  }, v)
}
await new Promise((r) => setTimeout(r, 350))
check(
  'equipamentos indicados manualmente entram na lista',
  (await page.$$('#wl-grid .wl-card')).length === OBSERVED.length,
)

/** Pixels opacos por canvas — canvas em branco passa em qualquer check de DOM. */
const paintedCanvases = (selector) =>
  page.evaluate((sel) => {
    const out = {}
    for (const canvas of document.querySelectorAll(sel)) {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      let opaque = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++
      out[canvas.id] = opaque
    }
    return out
  }, selector)

// a data sugerida no formulário é HOJE, sempre posterior ao export de amostra:
// se a janela do gráfico esticasse até ela, todas as séries sairiam em branco
const freshCharts = await paintedCanvases('#wl-grid canvas[id^="wl-chart-"]')
check(
  'série diária desenha mesmo com a manutenção posterior ao export',
  Object.keys(freshCharts).length === OBSERVED.length &&
    Object.values(freshCharts).every((n) => n > 500),
  Object.entries(freshCharts)
    .map(([id, n]) => `${id.replace('wl-chart-', '')}=${n}px`)
    .join(' · '),
)

// ---- mesma planilha de novo (idempotência) --------------------------------
await upload('guardian-semana-1.xlsx')
const report2 = await report()
const daily2 = await dailyTotals()
check(
  're-upload não infla o relatório',
  report1.rowCount === report2.rowCount && report1.fovCount === report2.fovCount,
  `${report2.rowCount} linhas · ${report2.fovCount} FOV`,
)
check(
  're-upload não duplica a série diária',
  JSON.stringify(daily1) === JSON.stringify(daily2),
  `${Object.values(daily1).reduce((a, b) => a + b, 0)} FOV/dia acumulados`,
)

// ---- observação com uma semana só -----------------------------------------
const cardVehicles = () =>
  page.$$eval('#wl-grid .wl-card__id', (els) => els.map((e) => e.textContent.trim()))

/** Cada card tem sua própria data de manutenção — aplica a mesma em todos. */
const setMaintenanceDates = async (date) => {
  for (const v of await cardVehicles()) {
    await page.evaluate(
      (vehicle, d) => {
        const i = document.querySelector(`#wl-grid [data-date="${vehicle}"]`)
        i.value = d
        i.dispatchEvent(new Event('change', { bubbles: true }))
      },
      v,
      date,
    )
  }
  await new Promise((r) => setTimeout(r, 350))
}

await setMaintenanceDates('2026-07-20')
const badges1 = await page.$$eval('#wl-grid .badge', (els) => els.map((e) => e.className))
check(
  'sem dado pós-manutenção o badge é "em observação"',
  badges1.length > 0 && badges1.every((c) => c.includes('badge--em-observacao')),
  badges1.join(', '),
)

// ---- 2ª semana: soma ao período em vez de substituir ----------------------
const beforeSecond = await report()
await upload('guardian-semana-2.xlsx')
await new Promise((r) => setTimeout(r, 400))
const withBoth = await report()
check(
  'segundo arquivo soma ao relatório em vez de substituir',
  withBoth.fileCount === 2 && withBoth.rowCount > beforeSecond.rowCount,
  `${beforeSecond.fileCount} arq/${beforeSecond.rowCount} linhas → ${withBoth.fileCount} arq/${withBoth.rowCount} linhas`,
)
check(
  'os dois arquivos aparecem listados, com período de cada um',
  (await page.$$('#filelist .fileitem')).length === 2,
  (await page.$$eval('#filelist .fileitem__meta', (els) => els.map((e) => e.textContent.trim()))).join(' | '),
)

const badges2 = await page.$$eval('#wl-grid .badge', (els) => els.map((e) => e.textContent.trim()))
check(
  'equipamento sem tratativa real é marcado como reincidente',
  badges2.some((t) => t.startsWith('Reincidente')),
  badges2.join(' | '),
)
check(
  'resumo contabiliza os reincidentes',
  Number(await page.$$eval('#wl-summary .wl-tile__v', (els) => els[1].textContent.trim())) > 0,
)

// ---- detalhe por equipamento ----------------------------------------------
await page.click('#wl-grid [data-detail]')
await new Promise((r) => setTimeout(r, 400))
const detail = await page.evaluate(() => {
  const card = document.querySelector('.wl-card--open')
  if (!card) return null
  const sum = card.querySelector('.wl-shift__sum')
  const zones = [...card.querySelectorAll('.wl-zone')].map((z) => {
    const days = [...z.querySelectorAll('.wl-day')]
    return {
      key: (z.className.match(/wl-zone--(\w+)/) || [])[1] || '',
      title: z.querySelector('.wl-zone__title').textContent.replace(/\s+/g, ' ').trim(),
      cards: days.length,
      canvases: z.querySelectorAll('canvas[id^="wl-day-"]').length,
      // totais dentro da zona — devem sair decrescentes
      totals: days.map((d) => Number(d.querySelector('.wl-day__n b').textContent.trim())),
    }
  })
  return {
    vehicle: card.querySelector('.wl-card__id').textContent.trim(),
    zones,
    legendItems: card.querySelectorAll('.wl-daylegend__item').length,
    worst: card.querySelectorAll('.wl-worst li').length,
    shiftCanvas: Boolean(card.querySelector('canvas[id^="wl-shift-"]')),
    shiftSummary: sum ? sum.textContent.replace(/\s+/g, ' ').trim() : '',
  }
})
check(
  'detalhar separa os piores dias em zonas antes × depois da manutenção',
  detail !== null &&
    detail.zones.length === 2 &&
    detail.zones[0].key === 'before' &&
    detail.zones[1].key === 'after' &&
    detail.worst > 0,
  detail ? detail.zones.map((z) => `${z.key}:${z.cards}`).join(' · ') : 'nenhum card aberto',
)
check(
  'cada zona traz no máximo 3 dias, um gráfico por dia, em ordem decrescente',
  detail !== null &&
    detail.zones.every(
      (z) =>
        z.cards <= 3 &&
        z.canvases === z.cards &&
        z.totals.every((n, i) => i === 0 || z.totals[i - 1] >= n),
    ) &&
    detail.zones.some((z) => z.cards > 0),
  detail ? detail.zones.map((z) => `${z.key} [${z.totals.join('/')}]`).join(' · ') : '',
)
check(
  'título de cada zona traz o agregado do lado',
  detail !== null && detail.zones.every((z) => /manuten/i.test(z.title)),
  detail ? detail.zones.map((z) => z.title).join(' | ') : '',
)
check(
  'legenda explica as faixas de turno',
  detail !== null && detail.legendItems === 2,
  detail ? `${detail.legendItems} itens de legenda` : '',
)
check(
  'pior turno já vem renderizado no detalhe',
  detail !== null && detail.shiftCanvas && /Pior turno: [12]º/.test(detail.shiftSummary),
  detail ? detail.shiftSummary : 'sem bloco de turno',
)

// os canvas precisam ter pixels desenhados — canvas em branco passaria nas
// checagens de DOM acima sem que nada apareça na tela
const painted = await paintedCanvases('.wl-card--open canvas')
check(
  'gráficos do detalhe realmente desenham',
  Object.keys(painted).length >= 3 && Object.values(painted).every((n) => n > 500),
  Object.entries(painted)
    .map(([id, n]) => `${id}=${n}px`)
    .join(' · '),
)

// ---- zoom da série diária no card aberto ----------------------------------
const zoomBoxEl = await page.$('.wl-card--open .chartbox--zoom')
if (zoomBoxEl) {
  await zoomBoxEl.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await new Promise((r) => setTimeout(r, 250))
}
// Coordenadas do VIEWPORT, não da página: `page.mouse` trabalha em viewport e
// `boundingBox()` não desconta o scroll. Com o card aberto abaixo da primeira
// dobra — que é o caso assim que há alguns equipamentos em observação — a roda
// do mouse caía fora da tela e o gráfico nunca recebia o evento.
const zoomBox = zoomBoxEl
  ? await zoomBoxEl.evaluate((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
  : null
check(
  'série diária fica maior com o detalhe aberto',
  zoomBox !== null && zoomBox.height > 250,
  zoomBox ? `${Math.round(zoomBox.height)}px de altura` : 'sem chartbox--zoom',
)

/** Faixa de dias visível no eixo x — encolhe conforme o zoom entra. */
const visibleSpan = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('.wl-card--open canvas[id^="wl-chart-"]')
    const chart = canvas && window.__gfmCharts && window.__gfmCharts.get(canvas.id)
    if (!chart) return null
    return Number((chart.scales.x.max - chart.scales.x.min).toFixed(3))
  })
const spanBefore = await visibleSpan()
await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2)
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel({ deltaY: -120 })
  await new Promise((r) => setTimeout(r, 60))
}
const spanZoomed = await visibleSpan()
check(
  'roda do mouse amplia a série diária',
  spanBefore !== null && spanZoomed !== null && spanZoomed < spanBefore,
  `${spanBefore} → ${spanZoomed} dias visíveis`,
)

await page.click('.wl-card--open [data-zoomreset]')
await new Promise((r) => setTimeout(r, 300))
check(
  '"Ver tudo" volta ao enquadramento original',
  (await visibleSpan()) === spanBefore,
  `${await visibleSpan()} dias visíveis`,
)

await page.click('#wl-grid [data-detail]')
await new Promise((r) => setTimeout(r, 250))
check('ocultar detalhe fecha o card', (await page.$$('.wl-card--open')).length === 0)

// ---- troca de data recalcula sem novo upload ------------------------------
await setMaintenanceDates('2026-07-10')
const badges3 = await page.$$eval('#wl-grid .badge', (els) => els.map((e) => e.textContent.trim()))
check('trocar a data recalcula os badges na hora', badges3.join('|') !== badges2.join('|'),
  badges3.join(' | '))

// ---- encerrar/recolocar preserva histórico --------------------------------
const firstChip = await page.$eval('#wl-grid [data-remove]', (e) => e.dataset.remove)
await page.click('#wl-grid [data-remove]')
await new Promise((r) => setTimeout(r, 200))
await page.evaluate((v) => {
  const i = document.querySelector('#wl-add')
  i.value = v
  document.querySelector('#wl-add-btn').click()
}, firstChip)
await new Promise((r) => setTimeout(r, 300))
const restored = await page.$$eval('#wl-grid .wl-card', (els) =>
  els.map((e) => e.querySelector('.wl-card__id').textContent.trim()),
)
check('recolocar em observação traz o histórico diário de volta', restored.includes(firstChip))

// ---- remover um arquivo recalcula o relatório -----------------------------
await page.click('#filelist [data-file]')
await new Promise((r) => setTimeout(r, 500))
const afterRemove = await report()
check(
  'remover um arquivo recalcula o relatório',
  afterRemove.fileCount === 1 && afterRemove.rowCount < withBoth.rowCount,
  `${withBoth.rowCount} → ${afterRemove.rowCount} linhas`,
)

// ---- formato novo: CSV pt-BR do portal ------------------------------------
// O que importa aqui é o fovCount subir: se "Exceção FOV" não fosse
// reconhecida, o arquivo entraria com todas as linhas e ZERO exceções — o
// relatório carregaria sem erro nenhum e sem nada para mostrar.
await upload('guardian-semana-3.csv')
const withCsv = await report()
check(
  'CSV pt-BR do portal soma ao relatório como qualquer .xlsx',
  withCsv.fileCount === afterRemove.fileCount + 1 &&
    withCsv.rowCount > afterRemove.rowCount &&
    withCsv.fovCount > afterRemove.fovCount,
  `${afterRemove.rowCount} → ${withCsv.rowCount} linhas · ${afterRemove.fovCount} → ${withCsv.fovCount} FOV`,
)
check(
  'a série diária cresce com os dias vindos do CSV',
  Object.values(await dailyTotals()).reduce((a, b) => a + b, 0) >
    Object.values(daily2).reduce((a, b) => a + b, 0),
)

// ---- rede -----------------------------------------------------------------
check('nenhuma requisição externa', external.length === 0, external.slice(0, 3).join(', '))
check('nenhum erro de console', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await page.screenshot({ path: join(root, 'sample', 'smoke.png'), fullPage: true })
await browser.close()
server.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`)
process.exit(failed.length ? 1 : 0)