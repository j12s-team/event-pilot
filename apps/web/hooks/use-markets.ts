'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { MarketSnapshotV1 } from '@eventpilot/contracts';

import { API_ORIGIN, api, type MarketsResponse } from '@/lib/api';

interface MarketStreamEvent extends MarketsResponse {
  cursor: number;
  kind: 'snapshot' | 'reset' | 'status';
  occurredAtMs: number;
}

export function useMarkets() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['markets'],
    queryFn: api.markets,
    refetchInterval: 15_000,
  });
  const [streamState, setStreamState] = useState<
    'connecting' | 'live' | 'disconnected'
  >('connecting');
  const [lastUpdateMs, setLastUpdateMs] = useState<number | null>(null);

  useEffect(() => {
    const stream = new EventSource(`${API_ORIGIN}/v1/markets/stream`);
    const receive = (raw: MessageEvent<string>) => {
      const event = JSON.parse(raw.data) as MarketStreamEvent;
      queryClient.setQueryData<MarketsResponse>(['markets'], {
        source: event.source,
        message: event.message,
        markets: event.markets,
      });
      setLastUpdateMs(event.occurredAtMs);
      setStreamState(event.kind === 'status' ? 'disconnected' : 'live');
    };
    stream.addEventListener('snapshot', receive as EventListener);
    stream.addEventListener('reset', receive as EventListener);
    stream.addEventListener('status', receive as EventListener);
    stream.onerror = () => setStreamState('disconnected');
    return () => stream.close();
  }, [queryClient]);

  return {
    ...query,
    markets: query.data?.markets ?? ([] as MarketSnapshotV1[]),
    source: query.data?.source ?? null,
    sourceMessage: query.data?.message ?? null,
    streamState,
    lastUpdateMs,
  };
}
