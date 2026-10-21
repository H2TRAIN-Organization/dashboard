import type { SupabaseClient } from "@supabase/supabase-js";

import { persistenceErrorFromDatabase } from "../errors";
import type {
  PersistenceFilter,
  PersistenceGateway,
  SelectRequest,
  SelectResult,
} from "./query-types";

interface PostgrestResponse {
  readonly data: unknown;
  readonly error: unknown;
  readonly count?: number | null;
}

/**
 * Minimal structural view of the PostgREST builder methods used here. The
 * official client satisfies it at runtime; keeping the surface narrow avoids
 * generated database types and `any`.
 */
interface QueryBuilder extends PromiseLike<PostgrestResponse> {
  eq(column: string, value: unknown): QueryBuilder;
  gte(column: string, value: unknown): QueryBuilder;
  lt(column: string, value: unknown): QueryBuilder;
  lte(column: string, value: unknown): QueryBuilder;
  ilike(column: string, value: string): QueryBuilder;
  is(column: string, value: null): QueryBuilder;
  order(
    column: string,
    options?: { readonly ascending?: boolean; readonly nullsFirst?: boolean },
  ): QueryBuilder;
  range(from: number, to: number): QueryBuilder;
  limit(count: number): QueryBuilder;
  select(
    columns: string,
    options?: {
      readonly count?: "exact" | "planned" | "estimated";
      readonly head?: boolean;
    },
  ): QueryBuilder;
  insert(values: Record<string, unknown>): QueryBuilder;
  update(values: Record<string, unknown>): QueryBuilder;
  match(match: Record<string, unknown>): QueryBuilder;
  single(): QueryBuilder;
  rpc(name: string, args: Record<string, unknown>): QueryBuilder;
}

function asBuilder(value: unknown): QueryBuilder {
  return value as QueryBuilder;
}

function applyFilter(builder: QueryBuilder, filter: PersistenceFilter): QueryBuilder {
  switch (filter.kind) {
    case "eq":
      return builder.eq(filter.column, filter.value);
    case "gte":
      return builder.gte(filter.column, filter.value);
    case "lt":
      return builder.lt(filter.column, filter.value);
    case "lte":
      return builder.lte(filter.column, filter.value);
    case "ilike":
      return builder.ilike(filter.column, filter.value);
    case "is":
      return builder.is(filter.column, null);
  }
}

function asRows(data: unknown): readonly unknown[] {
  if (data === null || data === undefined) {
    return [];
  }
  return Array.isArray(data) ? data : [data];
}

/**
 * Official Supabase/PostgREST adapter. It uses the service-role client and the
 * `public` schema configured by the factory. No raw database message is copied
 * into an error.
 */
export function createPostgrestGateway(client: SupabaseClient): PersistenceGateway {
  return {
    async select(table: string, request: SelectRequest): Promise<SelectResult> {
      let builder = asBuilder(
        client.from(table).select(request.columns, {
          ...(request.count === undefined ? {} : { count: request.count }),
          ...(request.head === undefined ? {} : { head: request.head }),
        }),
      );

      for (const filter of request.filters ?? []) {
        builder = applyFilter(builder, filter);
      }
      if (request.order !== undefined) {
        builder = builder.order(request.order.column, {
          ascending: request.order.ascending ?? true,
          nullsFirst: false,
        });
      }
      if (request.range !== undefined) {
        builder = builder.range(request.range.from, request.range.to);
      }
      if (request.limit !== undefined) {
        builder = builder.limit(request.limit);
      }

      const response = await builder;
      if (response.error !== null && response.error !== undefined) {
        throw persistenceErrorFromDatabase(response.error, {
          operation: "select",
          table,
        });
      }
      return {
        rows: request.head === true ? [] : asRows(response.data),
        count:
          typeof response.count === "number" && Number.isFinite(response.count)
            ? response.count
            : null,
      };
    },

    async insert(
      table: string,
      values: Record<string, unknown>,
      columns: string,
    ): Promise<unknown | null> {
      const response = await asBuilder(
        client.from(table).insert(values).select(columns).single(),
      );
      if (response.error !== null && response.error !== undefined) {
        throw persistenceErrorFromDatabase(response.error, {
          operation: "insert",
          table,
        });
      }
      return response.data ?? null;
    },

    async update(
      table: string,
      values: Record<string, unknown>,
      match: Record<string, string | number>,
      columns: string,
    ): Promise<readonly unknown[]> {
      const response = await asBuilder(
        client.from(table).update(values).match(match).select(columns),
      );
      if (response.error !== null && response.error !== undefined) {
        throw persistenceErrorFromDatabase(response.error, {
          operation: "update",
          table,
        });
      }
      return asRows(response.data);
    },

    async rpc<T = unknown>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      const response = await asBuilder(client.rpc(name, args));
      if (response.error !== null && response.error !== undefined) {
        throw persistenceErrorFromDatabase(response.error, {
          operation: `rpc:${name}`,
        });
      }
      return response.data as T;
    },
  };
}
