import { Table, getTableName, is } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, test } from "vitest";

import * as schema from "./schema";
import { relations } from "./schema";

// Logical edges the relation graph declares without a database-level foreign key. A
// self-referencing FK would make any future rebuild of the table order-dependent, so the
// navigation tree is enforced in app code instead.
const UNCONSTRAINED_EDGES = new Set(["cms_navigation_item.parentId->cms_navigation_item.id"]);

interface RelationEntry {
  sourceColumns?: { name: string; table: Table }[];
  targetColumns?: { name: string; table: Table }[];
}

type RelationGraph = Record<string, { table: Table; relations: Record<string, RelationEntry> }>;

function edgeKey({
  fromTable,
  fromColumns,
  toTable,
  toColumns,
}: {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
}): string {
  return `${fromTable}.${fromColumns.join("+")}->${toTable}.${toColumns.join("+")}`;
}

function getSchemaTables(): SQLiteTable[] {
  return (Object.values(schema) as unknown[]).filter((value) => is(value, Table)) as SQLiteTable[];
}

const relationGraph = relations as unknown as RelationGraph;

/** Every declared FK, keyed child -> parent. */
function getForeignKeyEdges(): string[] {
  return getSchemaTables().flatMap((table) =>
    getTableConfig(table).foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();

      return edgeKey({
        fromTable: getTableName(table),
        fromColumns: reference.columns.map((column) => column.name),
        toTable: getTableName(reference.foreignTable),
        toColumns: reference.foreignColumns.map((column) => column.name),
      });
    }),
  );
}

/** Every edge the relation graph declares, in the direction it was declared. */
function getRelationEdges(): Map<string, string> {
  const edges = new Map<string, string>();

  for (const [tableKey, tableConfig] of Object.entries(relationGraph)) {
    for (const [fieldName, relation] of Object.entries(tableConfig.relations)) {
      const { sourceColumns, targetColumns } = relation;
      if (!sourceColumns?.length || !targetColumns?.length) {
        continue;
      }

      const key = edgeKey({
        fromTable: getTableName(sourceColumns[0].table),
        fromColumns: sourceColumns.map((column) => column.name),
        toTable: getTableName(targetColumns[0].table),
        toColumns: targetColumns.map((column) => column.name),
      });

      edges.set(key, `${tableKey}.${fieldName}`);
    }
  }

  return edges;
}

function reverseEdge(key: string): string {
  const [from, to] = key.split("->");
  return `${to}->${from}`;
}

describe("schema relations", () => {
  test("covers every table in the schema", () => {
    const missing = getSchemaTables()
      .map((table) => getTableName(table))
      .filter(
        (name) =>
          !Object.values(relationGraph).some((config) => getTableName(config.table) === name),
      );

    expect(missing).toEqual([]);
  });

  test("declares both sides of every foreign key", () => {
    const relationEdges = getRelationEdges();
    const foreignKeyEdges = getForeignKeyEdges();

    expect(foreignKeyEdges.length).toBeGreaterThan(0);
    expect(foreignKeyEdges.filter((edge) => !relationEdges.has(edge))).toEqual([]);
    expect(foreignKeyEdges.filter((edge) => !relationEdges.has(reverseEdge(edge)))).toEqual([]);
  });

  test("declares no relation that is not backed by a foreign key", () => {
    const foreignKeyEdges = new Set(getForeignKeyEdges());

    const unbacked = [...getRelationEdges()]
      .filter(
        ([edge]) =>
          !foreignKeyEdges.has(edge) &&
          !foreignKeyEdges.has(reverseEdge(edge)) &&
          !UNCONSTRAINED_EDGES.has(edge) &&
          !UNCONSTRAINED_EDGES.has(reverseEdge(edge)),
      )
      .map(([, fieldName]) => fieldName);

    expect(unbacked).toEqual([]);
  });
});
