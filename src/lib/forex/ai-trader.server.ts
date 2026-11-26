import { createOpenAI } from '@ai-sdk/openai';
import { NoObjectGeneratedError, Output, streamText } from 'ai';
import { z } from 'zod';
import { createLovableAiGatewayRunIdFetch, getLovableAiGatewayRunId } from '../ai/run-id.ts';
import { AI_TRADER_INSTRUCTIONS, buildAiTradePrompt, normalizeDecision, type AiTradeDecision } from './ai-prompt.ts';
import type { Bar } from './cpes.ts';

export const AI_FOREX_MODEL = 'openai/gpt-6-astra';
const GATEWAY_BASE_URL = 'https://ai.gateway.lovable.dev/v1';

const decisionSchema = z.object({
  action: z.enum(['LONG', 'SHORT', 'SKIP']),
  confidence: z.number(),
  reason: z.string(),
});

export type AiDecisionResult = AiTradeDecision & {
  model: string;
  runId?: string;
};

export async function requestAiForexDecision(params: {
  m3: Bar[];
  m1: Bar[];
  entryTimeSec: number;
  request?: Request;
  abortSignal?: AbortSignal;
}): Promise<AiDecisionResult> {
  const apiKey = process.env['LOVABLE_API_KEY'];
  if (!apiKey) {
    throw new Error('LOVABLE_API_KEY is not configured on the server.');
  }
  if (params.m3.length < 5) {
    return { action: 'SKIP', confidence: 0, reason: 'Not enough prior candles for AI price-action analysis.', model: AI_FOREX_MODEL };
  }

  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(params.request));
  const provider = createOpenAI({
    baseURL: GATEWAY_BASE_URL,
    apiKey,
    headers: {
      'Lovable-API-Key': apiKey,
      'X-Lovable-AIG-SDK': 'vercel-ai-sdk',
    },
    fetch: runIdFetch.fetch,
  });

  const prompt = buildAiTradePrompt(params.m3, params.m1, params.entryTimeSec);
  let streamError: unknown;
  const result = streamText({
    model: provider.responses(AI_FOREX_MODEL),
    instructions: AI_TRADER_INSTRUCTIONS,
    messages: [{ role: 'user', content: prompt }],
    output: Output.object({ schema: decisionSchema }),
    maxRetries: 0,
    onError: ({ error }) => { streamError = error; },
    ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: 'low',
        reasoningSummary: 'auto',
        include: ['reasoning.encrypted_content'],
      },
    },
  });

  try {
    const parsed = await result.output;
    const norm = normalizeDecision(parsed);
    const runId = runIdFetch.getRunId();
    return { ...norm, model: AI_FOREX_MODEL, ...(runId ? { runId } : {}) };
  } catch (err) {
    if (streamError) throw streamError;
    if (NoObjectGeneratedError.isInstance(err) && err.text) {
      try {
        const fallback = JSON.parse(err.text) as { action?: string; confidence?: number; reason?: string };
        const norm = normalizeDecision({
          action: String(fallback.action ?? 'SKIP'),
          confidence: Number(fallback.confidence ?? 0),
          reason: String(fallback.reason ?? 'Fallback parse from AI response.'),
        });
        const runId = runIdFetch.getRunId();
        return { ...norm, model: AI_FOREX_MODEL, ...(runId ? { runId } : {}) };
      } catch {
        // Fall through to terminal error below
      }
    }
    throw err;
  }
}