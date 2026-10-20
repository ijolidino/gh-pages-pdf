/**
 * PDF 文库静态快照逻辑（无框架、无构建，浏览器直接跑）
 * 数据来自 data.js 的 window.PDF_DATA：{ generatedAt, docs:[{title, keywords[], fileName, dir, size}] }
 * dir 是站点相对路径（如 pdfs/00/），PDF 文件本体就放在本站 pdfs/ 目录下，
 * 因此点标题 = 新页签直开该 PDF（本地预览和 GitHub Pages 线上行为一致）。
 * 行为对齐项目里 Vue 版 PdfScanList：每页 10 条、标题/关键词搜索、关键词索引（共性 ≥2 篇）点击检索。
 */
const PAGE_SIZE = 10

const docs = (window.PDF_DATA?.docs || []).slice().sort((a, b) =>
  String(a.dir).localeCompare(String(b.dir)) || String(a.fileName).localeCompare(String(b.fileName))
)

const state = { kw: '', page: 1, idxAll: false }

/* ---------- 关键词索引：前端现算每个词被多少篇共用 ---------- */
function buildIndex() {
  const map = new Map()
  // 用 Set 去重：同一篇的关键词数组里可能重复列同一个词，共性口径是「多少篇共用」而非「出现多少次」
  for (const d of docs) for (const k of new Set(d.keywords || [])) map.set(k, (map.get(k) || 0) + 1)
  return [...map.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword, 'zh'))
}
const indexAll = buildIndex()
const sharedCount = indexAll.filter((x) => x.count >= 2).length

/* ---------- 搜索与分页（纯客户端） ---------- */
function filtered() {
  const kw = state.kw.toLowerCase()
  if (!kw) return docs
  return docs.filter(
    (d) =>
      (d.title || '').toLowerCase().includes(kw) ||
      (d.keywords || []).some((k) => k.toLowerCase().includes(kw))
  )
}
const totalPages = () => Math.max(1, Math.ceil(filtered().length / PAGE_SIZE))

/* ---------- 小工具 ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function shortDir(dir) {
  const parts = String(dir || '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || '（根目录）'
}
function pdfUrl(d) {
  // dir 导出时已是站点相对路径且带结尾斜杠（如 pdfs/00/）；这里兜底补斜杠，避免出现双斜杠或缺斜杠
  let dir = String(d.dir || 'pdfs/').replace(/\\/g, '/')
  if (!dir.endsWith('/')) dir += '/'
  return encodeURI(dir + d.fileName)
}
function sizeText(b) {
  if (b == null) return ''
  return b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB'
}
let toastTimer = null
function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.hidden = true), 2200)
}
async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text)
    toast(okMsg)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
    toast(okMsg)
  }
}
function openPdf(url) {
  // 新页签打开站内 PDF；个别浏览器拦截弹窗时退化为复制完整链接
  const w = window.open(url, '_blank')
  if (!w) copyText(new URL(url, location.href).href, '弹窗被拦截，已复制该 PDF 的链接')
}

/* ---------- 渲染 ---------- */
function renderIndex() {
  const list = state.idxAll ? indexAll : indexAll.filter((x) => x.count >= 2)
  document.getElementById('idxSub').textContent = state.idxAll
    ? `全部 ${indexAll.length} 个关键词`
    : `共性关键词 ${sharedCount} 个（被 ≥2 篇共用） / 共 ${indexAll.length} 个`
  document.getElementById('idxToggle').textContent = state.idxAll ? '只看共性词' : '看全部关键词'
  document.getElementById('idxChips').innerHTML = list
    .map(
      (x) =>
        `<button class="chip kw ${state.kw === x.keyword ? 'on' : ''}" data-kw="${esc(x.keyword)}" title="搜索：${esc(x.keyword)}">${esc(x.keyword)}<b>${x.count}</b></button>`
    )
    .join('')
}

function renderList() {
  const rows = filtered()
  const tp = totalPages()
  if (state.page > tp) state.page = tp
  const pageItems = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE)

  document.getElementById('sub').textContent = state.kw
    ? `搜索「${state.kw}」命中 ${rows.length} 个 PDF`
    : `共 ${docs.length} 个 PDF · 每页 ${PAGE_SIZE} 条（浏览器端分页）`
  document.getElementById('clearBtn').hidden = !state.kw

  document.getElementById('list').innerHTML = pageItems.length
    ? pageItems
        .map(
          (d) => `
      <article class="row">
        <button class="title" data-url="${esc(pdfUrl(d))}" title="在新页签打开：${esc(pdfUrl(d))}">${esc(d.title)}</button>
        ${(d.keywords || []).length
            ? `<p class="chips">${d.keywords
                .map((k) => `<button class="chip kw ${state.kw === k ? 'on' : ''}" data-kw="${esc(k)}">${esc(k)}</button>`)
                .join('')}</p>`
            : ''}
        <p class="meta"><span class="tag">PDF</span><span class="mono" title="${esc(d.fileName)}">${esc(d.fileName)}</span> · 目录：${esc(shortDir(d.dir))} · ${sizeText(d.size)}</p>
      </article>`
        )
        .join('')
    : `<p class="empty">${state.kw ? '没有匹配的 PDF，换个词或点「清除」' : '导出数据为空'}</p>`

  document.getElementById('pageInfo').textContent = `第 ${state.page} / ${tp} 页 · 共 ${rows.length} 条`
  document.getElementById('prevBtn').disabled = state.page <= 1
  document.getElementById('nextBtn').disabled = state.page >= tp
}

function render() {
  renderIndex()
  renderList()
}

/* ---------- 事件 ---------- */
function searchBy(kw) {
  state.kw = kw
  document.getElementById('searchInput').value = kw
  state.page = 1
  render()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

document.getElementById('searchBtn').addEventListener('click', () => {
  state.kw = document.getElementById('searchInput').value.trim()
  state.page = 1
  render()
})
document.getElementById('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('searchBtn').click()
})
document.getElementById('clearBtn').addEventListener('click', () => searchBy(''))
document.getElementById('idxToggle').addEventListener('click', () => {
  state.idxAll = !state.idxAll
  renderIndex()
})
document.getElementById('prevBtn').addEventListener('click', () => {
  if (state.page > 1) { state.page--; renderList() }
})
document.getElementById('nextBtn').addEventListener('click', () => {
  if (state.page < totalPages()) { state.page++; renderList() }
})
// 事件委托：关键词 chip 搜索、标题新页签打开 PDF
document.body.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-kw]')
  if (chip) return searchBy(chip.dataset.kw)
  const title = e.target.closest('.title[data-url]')
  if (title) openPdf(title.dataset.url)
})

document.getElementById('gen').textContent = window.PDF_DATA
  ? `数据快照：${window.PDF_DATA.generatedAt} · ${docs.length} 篇`
  : '未找到 data.js，请先运行 build_data.py 导出数据'
render()
