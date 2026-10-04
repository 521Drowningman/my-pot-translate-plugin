// 本地模拟服务器：同时提供 OpenAI 兼容与 Claude 两种格式的端点，支持流式与非流式。
// 独立运行：node test/mock-server.mjs
// 被测试脚本导入：import { startMockServer } from './mock-server.mjs'
import http from 'node:http';

// 从请求体最后一条 user 消息里取出 """...""" 包裹的原文，回显作为"译文"
function extractSourceText(body) {
    const msgs = (body && body.messages) || [];
    const last = msgs[msgs.length - 1];
    const content = (last && last.content) || '';
    const m = content.match(/"""\n([\s\S]*?)\n"""/);
    return m ? m[1] : content;
}

function unauthorized(req) {
    const okBearer = req.headers.authorization === 'Bearer test-key';
    const okXapi = req.headers['x-api-key'] === 'test-key';
    return !(okBearer || okXapi);
}

function sendSSE(res, events) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    for (const e of events) res.write(e);
    res.end();
}

export function startMockServer(port = 8787) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (c) => (raw += c));
            req.on('end', () => {
                let body = {};
                try {
                    body = JSON.parse(raw || '{}');
                } catch {}

                const isClaude = req.url.includes('/messages');
                const isOpenAI = req.url.includes('chat/completions');

                if (unauthorized(req)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'invalid api key (mock)' } }));
                    return;
                }

                // /whoami 调试端点：回显实际使用的格式、鉴权、模型和系统提示词，用于断言提示词风格
                if (req.url.includes('whoami')) {
                    const key =
                        req.headers['x-api-key'] ||
                        String(req.headers.authorization || '').replace(/^Bearer\s*/, '');
                    const sys = isClaude
                        ? String((body && body.system) || '')
                        : String(
                              (body && body.messages && body.messages[0] && body.messages[0].content) || ''
                          );
                    const reply = `format=${isClaude ? 'claude' : 'openai'} key=${key} model=${body.model} sys=${sys.slice(0, 200)}`;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    if (isClaude) {
                        res.end(
                            JSON.stringify({ id: 'mock', type: 'message', content: [{ type: 'text', text: reply }] })
                        );
                    } else {
                        res.end(
                            JSON.stringify({
                                id: 'mock',
                                choices: [{ message: { role: 'assistant', content: reply } }],
                            })
                        );
                    }
                    return;
                }

                if (!isOpenAI && !isClaude) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'unknown endpoint (mock)' } }));
                    return;
                }

                const text = extractSourceText(body) + ' (translated)';
                const chunks = [text.slice(0, 4), text.slice(4, 8), text.slice(8)].filter(Boolean);

                if (body.stream) {
                    if (isClaude) {
                        const events = chunks.map(
                            (c) =>
                                `data: ${JSON.stringify({
                                    type: 'content_block_delta',
                                    delta: { type: 'text_delta', text: c },
                                })}\n\n`
                        );
                        events.push('data: {"type":"message_stop"}\n\n');
                        sendSSE(res, events);
                    } else {
                        const events = chunks.map(
                            (c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`
                        );
                        events.push('data: [DONE]\n\n');
                        sendSSE(res, events);
                    }
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                if (isClaude) {
                    res.end(
                        JSON.stringify({
                            id: 'mock',
                            type: 'message',
                            content: [{ type: 'text', text }],
                        })
                    );
                } else {
                    res.end(
                        JSON.stringify({
                            id: 'mock',
                            choices: [{ message: { role: 'assistant', content: text } }],
                        })
                    );
                }
            });
        });
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('test/mock-server.mjs');
if (isMain) {
    const port = Number(process.env.MOCK_PORT || 8787);
    startMockServer(port).then(() =>
        console.log(`mock server listening on http://127.0.0.1:${port}`)
    );
}
