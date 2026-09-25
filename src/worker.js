// Actuent LAWP for Cloudflare — serves https://yoursite.com/.well-known/lawp.json so AI agents can
// read and act on your site. By default it builds the LAWP from your own homepage and main pages;
// set LAWP_JSON (a full LAWP document) or LAWP_ACTIONS (a JSON array of actions) to control it.
// Made by localilabs — https://docs.actuent.ai/#actions

const PATH = "/.well-known/lawp.json"
const CACHE_SECONDS = 3600
const MAX_PAGES = 8

function decode(text) {
  return String(text || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function strip(html) {
  return decode(String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i")
  const tag = html.match(re)?.[0]
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] || "").trim() : ""
}

function summary(html) {
  const description = meta(html, "description") || meta(html, "og:description")
  if (description) return description.slice(0, 400)
  const paragraph = (html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []).map(strip).find(t => t.length > 60)
  return (paragraph || strip(html.match(/<main[\s\S]*<\/main>/i)?.[0] || html)).slice(0, 400)
}

function title(html) {
  return strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 120)
}

// Internal links from the header/nav (or anywhere, as a fallback): [{ path, text }]
function navLinks(html, origin) {
  const area = html.match(/<nav[\s\S]*?<\/nav>/gi)?.join(" ") || html.match(/<header[\s\S]*?<\/header>/i)?.[0] || html
  const seen = new Set(["/"])
  const links = []
  for (const m of area.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url
    try { url = new URL(m[1], origin) } catch { continue }
    if (url.origin !== origin) continue
    const path = url.pathname.replace(/\/+$/, "") || "/"
    const text = strip(m[2])
    if (seen.has(path) || !text || text.length > 40 || /\.(pdf|jpg|png|zip)$/i.test(path) || /login|signin|cart|account|wp-admin/i.test(path)) continue
    seen.add(path)
    links.push({ path, text })
    if (links.length >= MAX_PAGES) break
  }
  return links
}

async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Actuent-LAWP-Worker/1.0 (+https://docs.actuent.ai/bot)", "Accept": "text/html" }, cf: { cacheTtl: CACHE_SECONDS } })
  if (!res.ok || !(res.headers.get("content-type") || "").includes("html")) return null
  return res.text()
}

function parseJson(value) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

export async function buildLawp(origin, env = {}) {
  const custom = parseJson(env.LAWP_JSON)
  if (custom && typeof custom === "object" && !Array.isArray(custom)) return custom

  const host = new URL(origin).hostname
  const home = await getHtml(origin + "/")
  const name = (home && (meta(home, "og:site_name") || title(home).split(/\s[|\-–—]\s/)[0])) || host
  const pages = { "/": { title: home ? title(home) || name : name, content: home ? summary(home) || `Website of ${name}.` : `Website of ${name}.` } }

  if (home) {
    const links = navLinks(home, origin)
    const fetched = await Promise.all(links.map(async link => {
      const html = await getHtml(origin + link.path).catch(() => null)
      return html ? { path: link.path, title: title(html) || link.text, content: summary(html) } : null
    }))
    for (const page of fetched) if (page && page.content) pages[page.path] = { title: page.title, content: page.content }
  }

  const actions = []
  const email = home?.match(/mailto:([^"'?\s>]+@[^"'?\s>]+)/i)?.[1]
  if (email) actions.push({
    id: "contact", name: "Contact", description: `Email ${decode(email)}`,
    intent: ["contact", "email", "get in touch", "message"], input: { type: "text", required: false }
  })
  const extra = parseJson(env.LAWP_ACTIONS)
  if (Array.isArray(extra)) for (const a of extra) if (a && a.id) actions.push(a)

  const language = home?.match(/<html[^>]+lang=["']([a-z]{2})/i)?.[1]?.toLowerCase()
  return {
    protocol: "LAWP", version: "0.2.0", domain: host, name, ...(language ? { language } : {}),
    pages, actions, generator: "Actuent LAWP for Cloudflare 1.0.0"
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname !== PATH) return fetch(request) // Only this path is handled; everything else goes to your site.

    const cache = caches.default
    const cacheKey = new Request(url.origin + PATH)
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    const lawp = await buildLawp(url.origin, env)
    const response = new Response(JSON.stringify(lawp, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    })
    ctx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  }
}
