import { Daytona } from '@daytonaio/sdk'
const d = new Daytona() as any
for (const key of ['region', 'regions']) if (d[key]?.list) { try { console.log(key, JSON.stringify(await d[key].list(), null, 1).slice(0, 1500)) } catch (e) { console.log(key, (e as Error).message.slice(0, 200)) } }
// Fall back to raw API
const res = await fetch((process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api') + '/regions', { headers: { Authorization: `Bearer ${process.env.DAYTONA_API_KEY}` } })
console.log('GET /regions', res.status, (await res.text()).slice(0, 1500))
