// Synthetic child process: only the OpenRouter HTTP transport is replaced.
import { appendFileSync } from 'node:fs';
process.env.VERCEL = '1';
const { default: app } = await import('../../server/index');
delete process.env.VERCEL;
await (await import('../../server/db')).db.execute('SELECT 1');
const model = 'google/gemma-4-26b-a4b-it:free';
globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://openrouter.ai/api/v1/models')
        return new Response(JSON.stringify({ data: [{ id: model, pricing: { prompt: '0', completion: '0' } }] }));
    if (String(url) !== 'https://openrouter.ai/api/v1/chat/completions')
        throw Error('Unexpected external transport');
    appendFileSync(process.env.GEMMA_TEST_CALLS!, 'POST\n');
    if (process.env.GEMMA_TEST_CRASH === '1') {
        process.send?.({ posted: true });
        return new Promise(() => { });
    }
    await new Promise(r => setTimeout(r, 100));
    const wire = JSON.parse(String(init?.body));
    const data = JSON.parse(wire.messages[1].content);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: data.leads.map((p: {
                            id: string;
                        }) => ({ id: p.id, score: 75, reason: 'Preuve synthétique publique', missingData: [] })) }) } }] }));
};
const server = app.listen(0, '127.0.0.1', () => process.send?.({ port: (server.address() as {
        port: number;
    }).port }));
process.on('SIGTERM', () => { server.close(); process.exit(0); });