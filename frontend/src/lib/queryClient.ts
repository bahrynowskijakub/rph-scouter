import { QueryClient } from '@tanstack/react-query';

/**
 * The cache, as a module rather than a `useState` in `main.tsx`.
 *
 * It moved out here so `api.ts` can reach it. One thing outside React needs to write to the
 * cache: the fetch wrapper, when the server answers "your pass expired" — see `revokeAccess`
 * in `access.ts`. Every reader still goes through `QueryClientProvider`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
