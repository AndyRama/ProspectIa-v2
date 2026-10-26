import { readFileSync } from 'node:fs';
// Anonymous official GET snapshots; no account, credential or paid run data.
export const emailMetadata = JSON.parse(readFileSync(new URL('./apify-email-metadata.json', import.meta.url), 'utf8')).data;
export const emailBuild = JSON.parse(readFileSync(new URL('./apify-email-build.json', import.meta.url), 'utf8')).data;
export const emailPricing = emailMetadata.pricingInfos.at(-1);
export const emailMetadataResponse = (url: unknown) => Response.json({ data: String(url).endsWith('/builds/default') ? emailBuild : { id: emailMetadata.id, currentPricingInfo: emailPricing } });
