import { queryOptions } from '@tanstack/react-query';
import { readSimulator2 } from './dashboard.functions';

export const simulator2Options = queryOptions({
  queryKey: ['simulator2'], queryFn: () => readSimulator2(), refetchInterval: 15000,
});