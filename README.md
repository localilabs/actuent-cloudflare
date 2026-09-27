# Actuent LAWP for Cloudflare

Make any website on Cloudflare readable and actionable by AI agents in one click, without touching your site's code.

This Cloudflare Worker serves `https://yoursite.com/.well-known/lawp.json` ([LAWP](https://github.com/localilabs/lawp)). By default it builds it from your own homepage and main navigation pages (titles and descriptions), and adds a contact action if your site links an email address. Sites with native LAWP rank higher on [Actuent](https://actuent.ai), and can make actions executable by AI agents.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/localilabs/actuent-cloudflare)

## Setup

1. Click **Deploy to Cloudflare** above.
2. In Cloudflare, go to **Workers Routes → Add route** with Worker `actuent-lawp`, for:
   - `yoursite.com/.well-known/lawp.json`
   - `yoursite.com/llms.txt`
3. Open `https://yoursite.com/.well-known/lawp.json` to see what AI agents see, and check it with the [LAWP Checker](https://docs.actuent.ai/#checker).

Only those paths are handled; the rest of your site is untouched.

## llms.txt

The Worker also serves [`/llms.txt`](https://llmstxt.org), a Markdown summary of your site for AI, made from the same pages. If your site already has its own `llms.txt`, yours is served instead. Set `LLMS_TXT` to `off` to turn it off.

## AI bot visits (optional)

See how often GPTBot, ClaudeBot, PerplexityBot and other AI bots visit your site, in [Actuent Analytics](https://analytics.actuent.ai):

1. Claim your site in Analytics → My sites.
2. Add your Actuent Pro API key as an encrypted variable named `ACTUENT_API_KEY`.
3. Use a single route, `yoursite.com/*`, instead of the two above. Every request passes straight through to your site; the Worker only looks at the user agent.

Only the bot's name and a daily count are sent, batched about once a minute. Nothing about human visitors is counted or sent.

With the `yoursite.com/*` route, every HTML page also gets a `Link: <…/.well-known/lawp.json>; rel="lawp"` header, so agents that start from any page can find your LAWP ([LAWP 0.4 discovery](https://github.com/localilabs/lawp/blob/main/LAWP.md#discovery-v04)).

## Customise (optional)

In the Worker's **Settings → Variables**:

- `LAWP_JSON`: a complete LAWP document, used instead of the automatic one.
- `LAWP_ACTIONS`: a JSON array of extra actions. Give an action an `endpoint` on your own domain to make it executable by AI agents ([LAWP Actions](https://docs.actuent.ai/#actions)):

```json
[{"id":"book","name":"Book a table","description":"Reserve a table","intent":["book","reserve","table"],
  "input":{"type":"text","required":true},"endpoint":{"url":"https://yoursite.com/api/book","method":"POST"}}]
```

The generated LAWP is cached for an hour.

Made by [localilabs](https://localilabs.com). MIT licensed.
