// Actuent LAWP for Cloudflare — serves https://yoursite.com/.well-known/lawp.json so AI agents can
// read and act on your site. By default it builds the LAWP from your own homepage and main pages;
// set LAWP_JSON (a full LAWP document) or LAWP_ACTIONS (a JSON array of actions) to control it.
// It also serves /llms.txt, and (optionally) counts visits from AI bots for Actuent Analytics.
// Made by localilabs — https://docs.actuent.ai/#actions

const PATH = "/.well-known/lawp.json"
const LLMS_PATH = "/llms.txt"
const ANALYTICS_API = "https://agents.actuent.ai/api/analytics?op=bot_hits"
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
    lawp_version: "0.4", domain: host, name, ...(language ? { language } : {}),
    updated_at: new Date().toISOString(), ttl: CACHE_SECONDS,
    pages, actions, generator: "Actuent LAWP for Cloudflare 1.2.0"
  }
}

// llms.txt (https://llmstxt.org) made from the same data: a summary and the main pages.
export function llmsTxt(lawp, origin) {
  const home = lawp.pages?.["/"]
  const lines = [`# ${lawp.name}`, "", `> ${String(home?.content || `Website of ${lawp.name}.`).replace(/\s+/g, " ")}`, ""]
  const pages = Object.entries(lawp.pages || {}).filter(([path]) => path !== "/")
  if (pages.length) {
    lines.push("## Pages", "")
    for (const [path, page] of pages) lines.push(`- [${page.title || path}](${origin}${path}): ${String(page.content || "").replace(/\s+/g, " ").slice(0, 200)}`)
    lines.push("")
  }
  lines.push("## For AI agents", "", `- [LAWP](${origin}${PATH}): Structured pages and actions for AI agents`)
  return lines.join("\n") + "\n"
}

// AI bots recognised by user agent (same list as the WordPress plugin).
const BOTS = [
  ["GPTBot", /GPTBot/i], ["OAI-SearchBot", /OAI-SearchBot/i], ["ChatGPT-User", /ChatGPT-User/i],
  ["ClaudeBot", /ClaudeBot/i], ["Claude-User", /Claude-User/i], ["Claude-SearchBot", /Claude-SearchBot/i], ["anthropic-ai", /anthropic-ai/i],
  ["PerplexityBot", /PerplexityBot/i], ["Perplexity-User", /Perplexity-User/i], ["Amazonbot", /Amazonbot/i], ["Bytespider", /Bytespider/i],
  ["CCBot", /CCBot/i], ["meta-externalagent", /meta-externalagent/i], ["FacebookBot", /FacebookBot/i], ["cohere-ai", /cohere-ai/i],
  ["DuckAssistBot", /DuckAssistBot/i], ["MistralAI-User", /MistralAI-User/i], ["YouBot", /YouBot/i], ["Diffbot", /Diffbot/i], ["Actuent", /Actuent/i]
]

export function botName(userAgent) {
  const ua = String(userAgent || "")
  return BOTS.find(([, re]) => re.test(ua))?.[0] || null
}

// Counts are batched in memory and sent every minute (or every 50 visits) to keep requests low.
const pending = new Map()
let lastFlush = Date.now()

function flush(env, host) {
  if (!pending.size) return null
  const hits = [...pending.entries()].map(([key, count]) => { const [bot, day] = key.split("|"); return { bot, day, count } })
  pending.clear()
  lastFlush = Date.now()
  return fetch(ANALYTICS_API, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.ACTUENT_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ domain: host.replace(/^www\./, ""), hits })
  }).catch(() => {})
}

function countBot(request, env, ctx, host) {
  if (!env.ACTUENT_API_KEY) return
  const bot = botName(request.headers.get("user-agent"))
  if (!bot) return
  const key = `${bot}|${new Date().toISOString().slice(0, 10)}`
  pending.set(key, (pending.get(key) || 0) + 1)
  const total = [...pending.values()].reduce((a, b) => a + b, 0)
  if (total >= 50 || Date.now() - lastFlush > 60000) { const sending = flush(env, host); if (sending) ctx.waitUntil(sending) }
}

async function cachedResponse(cacheKey, ctx, build, type) {
  const cache = caches.default
  const cached = await cache.match(cacheKey)
  if (cached) return cached
  const response = new Response(await build(), {
    headers: { "Content-Type": type, "Access-Control-Allow-Origin": "*", "Cache-Control": `public, max-age=${CACHE_SECONDS}` }
  })
  ctx.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    countBot(request, env, ctx, url.hostname)

    if (url.pathname === PATH) {
      return cachedResponse(new Request(url.origin + PATH), ctx, async () => JSON.stringify(await buildLawp(url.origin, env), null, 2), "application/json; charset=utf-8")
    }
    // Your own llms.txt, if you have one, always wins.
    if (url.pathname === LLMS_PATH && env.LLMS_TXT !== "off") {
      const own = await fetch(request)
      if (own.ok && !(own.headers.get("content-type") || "").includes("html")) return own
      return cachedResponse(new Request(url.origin + LLMS_PATH), ctx, async () => llmsTxt(await buildLawp(url.origin, env), url.origin), "text/markdown; charset=utf-8")
    }
    // Everything else goes to your site untouched, except that HTML pages get a LAWP 0.4 discovery
    // header (Link: <…/.well-known/lawp.json>; rel="lawp") when the Worker runs on all routes.
    const response = await fetch(request)
    if (!(response.headers.get("content-type") || "").includes("text/html") || /rel="?lawp/.test(response.headers.get("link") || "")) return response
    const withLink = new Response(response.body, response)
    withLink.headers.append("Link", `<${url.origin}${PATH}>; rel="lawp"`)
    return withLink
  }
}
