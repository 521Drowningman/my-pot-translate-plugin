//
// pot-app 自定义大模型翻译插件
//
// 支持两种 API 格式（在服务设置的「接口格式」里切换）：
//   - openai: OpenAI 兼容的 /chat/completions（OpenAI、DeepSeek、Kimi、硅基流动、各类中转均可）
//   - claude: Anthropic 的 /v1/messages（Claude 官方及兼容网关）
//
// 流式输出默认关闭；开启后通过浏览器直连接口逐段显示，失败会自动回退为普通请求。
//

// pot 语言代码 → 英文名。from/to 已由 pot 按 info.json 的 language 映射为英文名，
// 这里的映射用于把 $detect（自动检测出的 pot 语言代码）转为可读名称。
const LANG_NAMES = {
    auto: 'auto',
    zh_cn: 'Simplified Chinese',
    zh_tw: 'Traditional Chinese',
    yue: 'Cantonese',
    ja: 'Japanese',
    ko: 'Korean',
    en: 'English',
    fr: 'French',
    es: 'Spanish',
    ru: 'Russian',
    de: 'German',
    it: 'Italian',
    tr: 'Turkish',
    pt_pt: 'Portuguese (Portugal)',
    pt_br: 'Portuguese (Brazil)',
    vi: 'Vietnamese',
    id: 'Indonesian',
    th: 'Thai',
    ms: 'Malay',
    ar: 'Arabic',
    hi: 'Hindi',
    mn_mo: 'Traditional Mongolian',
    mn_cy: 'Cyrillic Mongolian',
    km: 'Khmer',
    nb_no: 'Norwegian Bokmål',
    nn_no: 'Norwegian Nynorsk',
    fa: 'Persian',
    sv: 'Swedish',
    pl: 'Polish',
    nl: 'Dutch',
    uk: 'Ukrainian',
    he: 'Hebrew',
};

const DEFAULT_REQUEST_PATH = {
    openai: 'https://api.openai.com/v1/chat/completions',
    claude: 'https://api.anthropic.com/v1/messages',
};

const DEFAULT_SYSTEM_PROMPT =
    'You are a professional, faithful translation engine. ' +
    'Translate the input text from $from into $to, using natural, fluent and idiomatic $to. ' +
    'Output ONLY the translated text, never explain, interpret or add anything. ' +
    'Preserve the original formatting (line breaks, lists, markdown, code blocks).';

const DEFAULT_USER_PROMPT = '"""\n$text\n"""';

// pot 的配置输入框是单行的，把配置里输入的 \n 转义符变成真实换行
function expandNewlines(s) {
    return String(s).replaceAll('\\n', '\n');
}

// 智能补全端点：
//   留空                   → 官方默认端点
//   https://host           → https://host/v1/chat/completions（claude 为 /v1/messages）
//   https://host/v1        → 只补 /chat/completions（claude 为 /messages）
//   完整端点               → 原样使用
function resolveEndpoint(path, format) {
    let p = String(path || '').trim();
    if (!p) p = DEFAULT_REQUEST_PATH[format];
    if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
    p = p.replace(/\/+$/, '');
    if (format === 'openai') {
        if (/\/chat\/completions$/.test(p)) return p;
        if (/\/v\d+$/.test(p)) return p + '/chat/completions';
        return p + '/v1/chat/completions';
    }
    if (/\/messages$/.test(p)) return p;
    if (/\/v\d+$/.test(p)) return p + '/messages';
    return p + '/v1/messages';
}

function buildPrompts(config, text, from, to, detect) {
    const fromName = from === 'auto' ? 'the auto-detected source language' : from;
    const detectName = LANG_NAMES[detect] || detect || fromName;
    // $text 必须最后替换，避免原文中的 $from/$to 等字样被二次替换
    const fill = (tpl) =>
        tpl
            .replaceAll('$from', fromName)
            .replaceAll('$to', to)
            .replaceAll('$detect', detectName)
            .replaceAll('$text', text);
    return {
        system: fill(expandNewlines(config.systemPrompt || DEFAULT_SYSTEM_PROMPT)),
        user: fill(expandNewlines(config.userPrompt || DEFAULT_USER_PROMPT)),
    };
}

function buildBody(config, format, prompts) {
    let extra = {};
    const extraRaw = String(config.extraJson || '').trim();
    if (extraRaw) {
        try {
            extra = JSON.parse(extraRaw);
        } catch (e) {
            throw '「额外请求参数」不是合法 JSON：' + (e && e.message ? e.message : e);
        }
        if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
            throw '「额外请求参数」必须是 JSON 对象，例如 {"top_p":0.9}';
        }
    }
    const temperature = parseFloat(config.temperature);
    const maxTokens = parseInt(config.maxTokens, 10);

    if (format === 'claude') {
        // max_tokens 是 Claude 接口的必填参数
        const body = {
            model: config.model,
            max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
            system: prompts.system,
            messages: [{ role: 'user', content: prompts.user }],
        };
        if (Number.isFinite(temperature)) body.temperature = temperature;
        return Object.assign(body, extra);
    }

    const body = {
        model: config.model,
        messages: [
            { role: 'system', content: prompts.system },
            { role: 'user', content: prompts.user },
        ],
    };
    if (Number.isFinite(temperature)) body.temperature = temperature;
    if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
    return Object.assign(body, extra);
}

function buildHeaders(config, format) {
    if (format === 'claude') {
        return {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            // 浏览器直连（流式）时 Anthropic 要求携带该头才允许跨域访问
            'anthropic-dangerous-direct-browser-access': 'true',
        };
    }
    return {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.apiKey,
    };
}

// 普通请求：走 pot 内置的 Rust HTTP（无跨域限制，最可靠）
async function requestOnce(fetch, Body, url, headers, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: Body.json(body),
    });
    if (!res.ok) {
        throw 'Http Request Error\nHttp Status: ' + res.status + '\n' + JSON.stringify(res.data);
    }
    return res.data;
}

// 流式请求：浏览器直连，逐段解析 SSE 并回调；失败抛出，由上层决定是否回退
async function requestStream(url, headers, body, onEvent) {
    const res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        let errText = '';
        try {
            errText = await res.text();
        } catch (e) {}
        throw 'Http Request Error\nHttp Status: ' + res.status + '\n' + errText;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return;
            let evt;
            try {
                evt = JSON.parse(payload);
            } catch (e) {
                continue; // 忽略无法解析的行（如注释、心跳）
            }
            onEvent(evt);
        }
    }
}

function extractOpenAI(data) {
    if (data && data.error) {
        throw 'API Error: ' + JSON.stringify(data.error);
    }
    let content = null;
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
        content = data.choices[0].message.content;
    }
    if (typeof content !== 'string') {
        throw 'API 返回格式异常:\n' + JSON.stringify(data);
    }
    return content.trim();
}

function extractClaude(data) {
    if (data && data.type === 'error' && data.error) {
        throw 'API Error: ' + JSON.stringify(data.error);
    }
    const parts = [];
    if (data && Array.isArray(data.content)) {
        for (const block of data.content) {
            if (block && block.type === 'text' && typeof block.text === 'string') {
                parts.push(block.text);
            }
        }
    }
    if (!parts.length) {
        throw 'API 返回格式异常:\n' + JSON.stringify(data);
    }
    return parts.join('').trim();
}

// ===================== 多模型档案 =====================

// 档案里允许覆盖的字段；档案里没写的字段回退到服务设置里的基础配置
const PROFILE_KEYS = [
    'apiFormat',
    'requestPath',
    'apiKey',
    'model',
    'temperature',
    'maxTokens',
    'systemPrompt',
    'userPrompt',
    'extraJson',
];

function normalizeProfiles(arr) {
    if (!Array.isArray(arr)) {
        throw '档案列表必须是 JSON 数组，例如 [{"name":"deepseek","apiKey":"sk-xxx","model":"deepseek-chat"}]';
    }
    const profiles = [];
    for (const p of arr) {
        if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
        if (!p.name || !String(p.name).trim()) {
            throw '档案缺少 name 字段：' + JSON.stringify(p);
        }
        profiles.push(p);
    }
    return profiles;
}

// 档案来源：优先「档案列表」配置；留空则尝试读取插件目录下的 profiles.json
async function loadProfiles(config, utils) {
    const raw = String(config.profilesJson || '').trim();
    if (raw) {
        let arr;
        try {
            arr = JSON.parse(raw);
        } catch (e) {
            throw '「档案列表」不是合法 JSON：' + (e && e.message ? e.message : e);
        }
        return normalizeProfiles(arr);
    }
    try {
        if (utils && utils.pluginDir && utils.readTextFile) {
            const txt = await utils.readTextFile(utils.pluginDir + '/profiles.json');
            if (txt && txt.trim()) return normalizeProfiles(JSON.parse(txt));
        }
    } catch (e) {} // 没有 profiles.json 时静默忽略
    return [];
}

// 按名称选择当前档案：精确 → 忽略大小写 → 唯一片段；失败时抛错并列出可用档案
function pickProfile(profiles, activeName) {
    const name = String(activeName || '').trim();
    if (!name) return null;
    if (!profiles.length) {
        throw '已填写当前档案「' + name + '」，但档案列表为空。请在服务设置里填写「档案列表」，或在插件目录放置 profiles.json';
    }
    let hits = profiles.filter((p) => String(p.name) === name);
    if (!hits.length) hits = profiles.filter((p) => String(p.name).toLowerCase() === name.toLowerCase());
    if (!hits.length) {
        const lower = name.toLowerCase();
        hits = profiles.filter((p) => String(p.name).toLowerCase().includes(lower));
    }
    const names = profiles.map((p) => '「' + p.name + '」').join('、');
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
        throw (
            '当前档案「' +
            name +
            '」匹配到多个档案：' +
            hits.map((p) => '「' + p.name + '」').join('、') +
            '，请填写完整名称。可用档案：' +
            names
        );
    }
    throw '找不到当前档案「' + name + '」。可用档案：' + names;
}

function mergeProfile(config, profile) {
    const merged = Object.assign({}, config);
    for (const k of PROFILE_KEYS) {
        const v = profile[k];
        if (v !== undefined && v !== null && String(v) !== '') merged[k] = v;
    }
    return merged;
}

async function translate(text, from, to, options) {
    const { config, setResult, utils } = options;
    if (!text || !text.trim()) return '';

    const profiles = await loadProfiles(config, utils);
    const activeName = String(config.activeProfile || '').trim();
    const active = activeName ? pickProfile(profiles, activeName) : null;

    // 尝试顺序：当前档案（或基础配置）优先；开启「失败自动切换」后，其余档案按列表顺序兜底
    const attempts = [
        active
            ? { label: '档案「' + active.name + '」', config: mergeProfile(config, active) }
            : { label: '', config: config },
    ];
    const fallbackOn = config.autoFallback === true || config.autoFallback === 'true';
    if (fallbackOn) {
        for (const p of profiles) {
            if (active && String(p.name) === String(active.name)) continue;
            attempts.push({ label: '档案「' + p.name + '」', config: mergeProfile(config, p) });
        }
    }

    const errors = [];
    for (const attempt of attempts) {
        try {
            return await translateOnce(attempt.config, text, from, to, options);
        } catch (e) {
            const msg = typeof e === 'string' ? e : (e && e.message) || String(e);
            errors.push((attempt.label ? attempt.label + '：' : '') + msg);
            setResult(''); // 清空上一次尝试可能留下的半截流式输出
        }
    }
    if (attempts.length === 1) throw errors[0]; // 单次尝试保持原始错误不变
    throw '所有配置都翻译失败：\n' + errors.join('\n————————\n');
}

async function translateOnce(config, text, from, to, options) {
    const { detect, setResult, utils } = options;
    const { fetch, Body } = utils.http;

    if (!config.apiKey) throw '请先在服务设置中填写 API Key';
    if (!config.model) throw '请先在服务设置中填写模型名称';

    const format = config.apiFormat === 'claude' ? 'claude' : 'openai';
    const url = resolveEndpoint(config.requestPath, format);
    const headers = buildHeaders(config, format);
    const prompts = buildPrompts(config, text, from, to, detect);
    const body = buildBody(config, format, prompts);
    const wantStream = config.stream === true || config.stream === 'true';

    if (wantStream) {
        // 请求体里带上 stream 标记（OpenAI 与 Claude 的 SSE 均由此开启）
        const streamBody = Object.assign({}, body, { stream: true });
        let acc = '';
        const onEvent =
            format === 'claude'
                ? (evt) => {
                      if (evt && evt.type === 'error') {
                          throw new Error('API Error: ' + JSON.stringify(evt.error));
                      }
                      if (
                          evt &&
                          evt.type === 'content_block_delta' &&
                          evt.delta &&
                          typeof evt.delta.text === 'string'
                      ) {
                          acc += evt.delta.text;
                          setResult(acc);
                      }
                  }
                : (evt) => {
                      if (evt && evt.error) {
                          throw new Error('API Error: ' + JSON.stringify(evt.error));
                      }
                      const delta = evt && evt.choices && evt.choices[0] && evt.choices[0].delta;
                      if (delta && typeof delta.content === 'string' && delta.content.length) {
                          acc += delta.content;
                          setResult(acc);
                      }
                  };
        try {
            await requestStream(url, headers, streamBody, onEvent);
            if (acc.trim()) return acc.trim();
            // 流式正常结束但没有任何输出 → 回退普通请求再试一次
        } catch (e) {
            // 浏览器直连可能因跨域（CORS）或网络原因失败 → 清空半截输出，回退普通请求
            setResult('');
        }
    }

    const data = await requestOnce(fetch, Body, url, headers, body);
    return format === 'claude' ? extractClaude(data) : extractOpenAI(data);
}
