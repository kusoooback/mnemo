/** Formats de fichiers pris en charge par la bibliothèque de cours. */
export const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'rmd', 'qmd', 'tex', 'latex', 'bib', 'sty', 'cls', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log',
  'py', 'js', 'ts', 'tsx', 'jsx', 'c', 'h', 'cpp', 'hpp', 'java', 'cs', 'go', 'rs', 'r', 'sql', 'sh', 'bat', 'ps1', 'm', 'jl', 'lua', 'css'
])
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'svg'])
export const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'])
export const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'])
const OFFICE = new Set(['docx', 'dotx', 'pptx', 'odt', 'odp', 'ods', 'rtf', 'pages', 'epub', 'ipynb', 'html', 'htm'])

export type DocKind = 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'office' | 'other'

/** Comment un fichier s'ouvre dans l'application. */
export function docKind(ext: string): DocKind {
  const e = ext.toLowerCase().replace(/^\./, '')
  if (e === 'pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(e)) return 'image'
  if (VIDEO_EXTENSIONS.has(e)) return 'video'
  if (AUDIO_EXTENSIONS.has(e)) return 'audio'
  if (TEXT_EXTENSIONS.has(e)) return 'text'
  if (OFFICE.has(e)) return 'office'
  return 'other'
}
