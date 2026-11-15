import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

/** A client with retries and background refetching off, so tests stay deterministic. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

type RenderWithQueryOptions = Omit<RenderOptions, "wrapper"> & {
  client?: QueryClient;
};

export function renderWithQuery(
  ui: ReactElement,
  { client = createTestQueryClient(), ...options }: RenderWithQueryOptions = {},
): RenderResult & { client: QueryClient } {
  const result = render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
    ...options,
  });
  return { ...result, client };
}
