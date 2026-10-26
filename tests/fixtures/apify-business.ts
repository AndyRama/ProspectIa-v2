import { readFileSync } from 'node:fs';
// Official anonymous GET snapshots: no account, credentials, or paid runs.
export const businessMetadata = JSON.parse(readFileSync(new URL('./apify-business-metadata.json', import.meta.url), 'utf8')).data;
export const businessBuild = JSON.parse(readFileSync(new URL('./apify-business-build.json', import.meta.url), 'utf8')).data;
export const businessPricing = businessMetadata.pricingInfos.at(-1);
export const businessMetadataResponse = (url: unknown) => Response.json({ data: String(url).endsWith('/builds/default') ? businessBuild : { id: businessMetadata.id, currentPricingInfo: businessPricing } });
