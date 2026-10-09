// The shared ST8 transactional email layout: plain table HTML with inline styles (what mail clients render), branded
// from runtime config (app name, colour, URL) so Summit and Portal get their own look from the same templates.
// Values are HTML-escaped here; templates pass plain strings.

export interface EmailContent {
  /** Hidden inbox preview line. */
  preheader: string
  heading: string
  /** Plain-text paragraphs. */
  paragraphs: string[]
  cta?: { label: string, url: string }
  /** Small print under the button. */
  footnote?: string
}

export interface RenderedEmail {
  html: string
  text: string
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c)

/** Black or white, whichever reads better on `hex`. */
function textOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#0a0a0a'
  const n = Number.parseInt(m[1]!, 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0a0a0a' : '#ffffff'
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const config = useRuntimeConfig()
  const { appName, appUrl } = useSt8Auth()
  const brand = config.public.st8Auth.brandColor || '#00efd1'

  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#27272a;">${esc(p)}</p>`)
    .join('')
  const button = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:999px;background:${brand};">
<a href="${esc(content.cta.url)}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${textOn(brand)};text-decoration:none;border-radius:999px;">${esc(content.cta.label)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:#71717a;">Or paste this link into your browser:<br><a href="${esc(content.cta.url)}" style="color:#52525b;word-break:break-all;">${esc(content.cta.url)}</a></p>`
    : ''
  const footnote = content.footnote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#71717a;">${esc(content.footnote)}</p>`
    : ''

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(content.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Proxima Nova',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="height:6px;background:${brand};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 32px 8px;">
<a href="${esc(appUrl)}" style="font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#0a0a0a;text-decoration:none;">${esc(appName)}</a>
</td></tr>
<tr><td style="padding:16px 32px 32px;">
<h1 style="margin:0 0 20px;font-size:24px;line-height:32px;font-weight:700;color:#0a0a0a;">${esc(content.heading)}</h1>
${paragraphs}${button}${footnote}
</td></tr>
</table>
<p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#a1a1aa;">Southern Tier 8 Regional Board · <a href="https://so-tier.com" style="color:#a1a1aa;">so-tier.com</a></p>
</td></tr></table>
</body></html>`

  const text = [
    content.heading,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(content.cta ? [`${content.cta.label}: ${content.cta.url}`, ''] : []),
    ...(content.footnote ? [content.footnote, ''] : []),
    `${appName} · Southern Tier 8 Regional Board · so-tier.com`,
  ].join('\n')

  return { html, text }
}
