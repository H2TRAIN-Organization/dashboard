export type PersistenceFilter =
  | { readonly kind: "eq"; readonly column: string; readonly value: string | number | boolean }
  | { readonly kind: "gte"; readonly column: string; readonly value: string }
  | { readonly kind: "lt"; readonly column: string; readonly value: string }
  | { readonly kind: "lte"; readonly column: string; readonly value: string }
  | { readonly kind: "ilike"; readonly column: string; readonly value: string }
  | { readonly kind: "is"; readonly column: string; readonly value: null };

export interface SelectRequest {
  readonly columns: string;
  readonly filters?: readonly PersistenceFilter[];
  readonly order?: { readonly column: string; readonly ascending?: boolean };
  readonly range?: { readonly from: number; readonly to: number };
  readonly limit?: number;
  readonly count?: "exact" | "planned" | "estimated";
  readonly head?: boolean;
}

export interface SelectResult {
  readonly rows: readonly unknown[];
  readonly count: number | null;
}

/**
 * Narrow persistence gateway. Repositories depend on this interface instead of
 * the full Supabase client, which keeps query construction and error mapping in
 * one place and makes the adapters testable without a live project.
 */
export interface PersistenceGateway {
  select(table: string, request: SelectRequest): Promise<SelectResult>;
  insert(
    table: string,
    values: Record<string, unknown>,
    columns: string,
  ): Promise<unknown | null>;
  update(
    table: string,
    values: Record<string, unknown>,
    match: Record<string, string | number>,
    columns: string,
  ): Promise<readonly unknown[]>;
  rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
}
