/* ChaskaBox free-AI helpers for Cloudflare Workers AI bindings.
 *
 * SECURITY / COST RULES:
 * - Uses ONLY context.env.AI (Workers AI binding). No browser API key.
 * - Models are allow-listed to Cloudflare-hosted models that are suitable for
 *   Workers Free usage as of the 2026-10 implementation review.
 * - AI is optional. Callers must degrade gracefully when the binding/quota is
 *   unavailable; checkout/orders/auth must never depend on AI.
 */

const TEXT_MODELS = new Set([
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/ibm-granite/granite-4.0-h-micro',
]);

const EMBEDDING_MODELS = new Set([
  '@cf/qwen/qwen3-embedding-0.6b',
  '@cf/baai/bge-m3',
]);

export const DEFAULT_TEXT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
export const DEFAULT_EMBEDDING_MODEL = '@cf/qwen/qwen3-embedding-0.6b';

function cleanModel(value, allowed, fallback) {
  const v = String(value || '').trim();
  return allowed.has(v) ? v : fallback;
}

export function aiAvailable(context) {
  return !!context?.env?.AI && typeof context.env.AI.run === 'function';
}

export function selectedTextModel(context) {
  return cleanModel(context?.env?.AI_TEXT_MODEL, TEXT_MODELS, DEFAULT_TEXT_MODEL);
}

export function selectedEmbeddingModel(context) {
  return cleanModel(context?.env?.AI_EMBEDDING_MODEL, EMBEDDING_MODELS, DEFAULT_EMBEDDING_MODEL);
}

function extractText(result) {
  if (typeof result === 'string') return result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const candidates = [
    result?.response,
    result?.result?.response,
    result?.choices?.[0]?.message?.content,
    result?.result?.choices?.[0]?.message?.content,
    result?.text,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }
  return '';
}

export async function runTextAI(context, {
  system,
  user,
  maxTokens = 500,
  temperature = 0.35,
  model,
} = {}) {
  if (!aiAvailable(context)) {
    const error = new Error('Workers AI binding is not configured');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }
  const selected = cleanModel(model, TEXT_MODELS, selectedTextModel(context));
  const result = await context.env.AI.run(selected, {
    messages: [
      { role: 'system', content: String(system || '').slice(0, 8000) },
      { role: 'user', content: String(user || '').slice(0, 12000) },
    ],
    max_tokens: Math.max(32, Math.min(1200, Number(maxTokens) || 500)),
    temperature: Math.max(0, Math.min(1.2, Number(temperature) || 0.35)),
  });
  const text = extractText(result);
  if (!text) {
    const error = new Error('Workers AI returned an empty response');
    error.code = 'AI_EMPTY';
    throw error;
  }
  return { text, model: selected };
}

function normalizeEmbeddingResult(result, expectedCount) {
  let data = result?.data ?? result?.result?.data;
  const shape = result?.shape ?? result?.result?.shape;
  if (!Array.isArray(data)) return [];
  if (Array.isArray(data[0])) return data;
  if (expectedCount === 1 && data.every((x) => Number.isFinite(Number(x)))) return [data.map(Number)];
  if (Array.isArray(shape) && shape.length >= 2 && Number(shape[0]) > 0 && Number(shape[1]) > 0) {
    const rows = Number(shape[0]), dims = Number(shape[1]);
    const out = [];
    for (let i = 0; i < rows; i++) out.push(data.slice(i * dims, (i + 1) * dims).map(Number));
    return out;
  }
  return [];
}

export async function runEmbeddings(context, texts, { model } = {}) {
  if (!aiAvailable(context)) {
    const error = new Error('Workers AI binding is not configured');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }
  const list = (Array.isArray(texts) ? texts : [texts])
    .map((x) => String(x || '').trim().slice(0, 6000))
    .filter(Boolean);
  if (!list.length) return { embeddings: [], model: selectedEmbeddingModel(context) };
  if (list.length > 50) throw new Error('Embedding batch too large');
  const selected = cleanModel(model, EMBEDDING_MODELS, selectedEmbeddingModel(context));
  const result = await context.env.AI.run(selected, { text: list });
  const embeddings = normalizeEmbeddingResult(result, list.length);
  if (embeddings.length !== list.length || embeddings.some((v) => !Array.isArray(v) || !v.length)) {
    const error = new Error('Workers AI returned invalid embeddings');
    error.code = 'AI_EMBEDDING_INVALID';
    throw error;
  }
  return { embeddings, model: selected };
}

export function vectorLiteral(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('Embedding vector required');
  const safe = values.map((n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) throw new Error('Invalid embedding value');
    return Number(v.toFixed(8));
  });
  return `[${safe.join(',')}]`;
}
