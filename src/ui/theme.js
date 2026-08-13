const STORAGE_KEY = 'gfm-theme'

function persistTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* localStorage indisponível (ex. modo privado) — tema só vale para a sessão */
  }
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/**
 * Troca o tema no elemento raiz e persiste.
 *
 * O tema inicial já foi aplicado pelo script inline em `index.html` (antes do
 * primeiro paint, para não piscar claro→escuro), então isto NÃO é estado do
 * React: quem manda no `data-theme` é o documento, e o React só reage a ele.
 *
 * @returns {'light'|'dark'} o tema aplicado
 */
export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  persistTheme(next)
  return next
}
