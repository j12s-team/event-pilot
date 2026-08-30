import type {
  DecisionV1,
  EvaluationRequestV1,
  ExecutionIntentV1,
  MarketSnapshotV1,
  RunnerEventV1,
  StrategyV1,
} from '@eventpilot/contracts';

export const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN ?? 'http://127.0.0.1:4100';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type'))
    headers.set('content-type', 'application/json');
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface MarketsResponse {
  source: 'fixture' | 'dreamdex-live';
  message: string;
  markets: MarketSnapshotV1[];
}

export interface PublicEvidence {
  event: RunnerEventV1;
  strategy: StrategyV1 | null;
  snapshot: MarketSnapshotV1 | null;
  decision: DecisionV1 | null;
  intent: ExecutionIntentV1 | null;
  transaction: {
    hash: string;
    intentKey: string;
    receiptStatus: 'success' | 'reverted';
    blockNumber: string | null;
    gasUsed: string | null;
    createdAtMs: number;
  } | null;
  fills: Array<{
    id: string;
    transactionHash: string;
    intentKey: string;
    quantityRaw: string;
    priceRaw: string;
    recordedAtMs: number;
  }>;
  claim: Record<string, unknown> | null;
  explorer: string | null;
}

export const api = {
  markets: () => request<MarketsResponse>('/v1/markets'),
  evaluate: (input: EvaluationRequestV1) =>
    request<DecisionV1>('/v1/evaluations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  runner: () => request<Record<string, unknown>>('/v1/demo-runner'),
  events: (cursor = 0) =>
    request<{ events: RunnerEventV1[]; nextCursor: number }>(
      `/v1/demo-runner/events?cursor=${cursor}`,
    ),
  latestEvidence: () => request<PublicEvidence>('/v1/evidence/latest'),
};
