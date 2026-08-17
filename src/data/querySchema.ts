import { z } from "zod";

export const QueryScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type QueryScalar = z.infer<typeof QueryScalarSchema>;

export const QueryFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum([
    "equals",
    "notEquals",
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
    "contains",
    "in",
    "notIn",
    "isNull",
    "isNotNull",
  ]),
  value: z.union([QueryScalarSchema, z.array(QueryScalarSchema).min(1).max(100)]).optional(),
});
export type QueryFilter = z.infer<typeof QueryFilterSchema>;

export const QueryFieldSchema = z.object({
  field: z.string().min(1),
  as: z.string().min(1).optional(),
});
export type QueryField = z.infer<typeof QueryFieldSchema>;

export const QueryDimensionSchema = QueryFieldSchema.extend({
  timeBucket: z.enum(["hour", "day", "week", "month", "quarter", "year"]).optional(),
});
export type QueryDimension = z.infer<typeof QueryDimensionSchema>;

export const QueryMetricSchema = z.object({
  field: z.string().min(1).optional(),
  operation: z.enum(["count", "countDistinct", "sum", "average", "min", "max"]),
  as: z.string().min(1),
});
export type QueryMetric = z.infer<typeof QueryMetricSchema>;

export const QuerySortSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
export type QuerySort = z.infer<typeof QuerySortSchema>;

export const DatasetTransformSchema = z.object({
  /** Plain projected fields for non-aggregated datasets. */
  select: z.array(QueryFieldSchema).max(50).default([]),
  /** Filters are combined with AND. */
  filters: z.array(QueryFilterSchema).max(25).default([]),
  /** Dimensions become GROUP BY expressions when metrics are present. */
  dimensions: z.array(QueryDimensionSchema).max(20).default([]),
  metrics: z.array(QueryMetricSchema).max(20).default([]),
  /** Sort fields refer to selected fields or output aliases. */
  sort: z.array(QuerySortSchema).max(10).default([]),
  limit: z.number().int().min(1).max(5000).default(1000),
});
export type DatasetTransform = z.infer<typeof DatasetTransformSchema>;

export const DatasetDefinitionSchema = z.object({
  /** Stable logical capability name, never a physical SQLite table name. */
  source: z.string().min(1),
  transform: DatasetTransformSchema.default({}),
});
export type DatasetDefinition = z.infer<typeof DatasetDefinitionSchema>;

export const DatasetRefSchema = z.object({
  dataset: z.string().min(1),
});
export type DatasetRef = z.infer<typeof DatasetRefSchema>;
