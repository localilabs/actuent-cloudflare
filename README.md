# Actuent LAWP for Cloudflare

Make any website on Cloudflare readable and actionable by AI agents in one click, without touching your site's code.

This Cloudflare Worker serves `https://yoursite.com/.well-known/lawp.json` ([LAWP](https://github.com/localilabs/lawp)). By default it builds it from your own homepage and main navigation pages (titles and descriptions), and adds a contact action if your site links an email address. Sites with native LAWP rank higher on [Actuent](https://actuent.ai), and can make actions executable by AI agents.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/localilabs/actuent-cloudflare)

## Setup

1. Click **Deploy to Cloudflare** above.
2. In Cloudflare, go to **Workers Routes → Add route**:
   - Route: `yoursite.com/.well-known/lawp.json`
   - Worker: `actuent-lawp`
3. Open `https://yoursite.com/.well-known/lawp.json` to see what AI agents see, and check it with the [LAWP Checker](https://docs.actuent.ai/#checker).

Only that one path is handled; the rest of your site is untouched.

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
