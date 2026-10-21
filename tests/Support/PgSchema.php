<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Introspection helpers for schema tests (PostgreSQL only, 16 §4.1).
 */
final class PgSchema
{
    /**
     * Column names of a table, sorted (order of creation is not part of the contract).
     *
     * @return list<string>
     */
    public static function columns(string $table): array
    {
        $columns = Schema::getColumnListing($table);
        sort($columns);

        return $columns;
    }

    /**
     * @param  list<string>  $columns
     * @return list<string>
     */
    public static function sorted(array $columns): array
    {
        sort($columns);

        return $columns;
    }

    /**
     * information_schema row of one column: data_type, udt_name, character_maximum_length, numeric_precision,
     * numeric_scale, is_nullable, column_default.
     *
     * @return array<string, mixed>
     */
    public static function column(string $table, string $column): array
    {
        $row = DB::selectOne(
            'select data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
             from information_schema.columns
             where table_schema = current_schema() and table_name = ? and column_name = ?',
            [$table, $column],
        );

        return (array) $row;
    }

    /**
     * Every column of the given tables that has a database default, as `table.column`, sorted. The
     * complement (`column_default IS NULL`) is every column the spec gives no default.
     *
     * @param  list<string>  $tables
     * @return list<string>
     */
    public static function defaultedColumns(array $tables): array
    {
        $marks = implode(', ', array_fill(0, count($tables), '?'));
        $rows = DB::select(
            "select table_name || '.' || column_name as name
             from information_schema.columns
             where table_schema = current_schema() and table_name in ({$marks}) and column_default is not null",
            $tables,
        );
        $names = array_column($rows, 'name');
        sort($names);

        return $names;
    }

    public static function indexDefinition(string $table, string $index): ?string
    {
        $row = DB::selectOne(
            'select indexdef from pg_indexes where schemaname = current_schema() and tablename = ? and indexname = ?',
            [$table, $index],
        );

        return $row?->indexdef;
    }

    /**
     * Every index name of a table, sorted. Pins the complete set, so an index nobody listed fails too.
     *
     * @return list<string>
     */
    public static function indexNames(string $table): array
    {
        $names = array_column(
            DB::select('select indexname from pg_indexes where schemaname = current_schema() and tablename = ?', [$table]),
            'indexname',
        );
        sort($names);

        return $names;
    }

    /**
     * Foreign keys of the current schema whose column list is not a leading prefix of any full, valid
     * index (primary keys and unique indexes count; partial and expression indexes do not), as
     * `table(col, col)`, sorted. Postgres does not index foreign keys, so such a key makes the parent's
     * deletes and joins from the child scan the whole child table.
     *
     * @return list<string>
     */
    public static function unindexedForeignKeys(): array
    {
        $rows = DB::select(
            "select c.conrelid::regclass::text || '(' || string_agg(a.attname, ', ' order by k.ord) || ')' as name
             from pg_constraint c
             cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
             where c.contype = 'f' and c.connamespace = current_schema()::regnamespace
             group by c.oid, c.conrelid, c.conkey
             having not exists (
                 select 1 from pg_index i
                 where i.indrelid = c.conrelid and i.indisvalid and i.indpred is null
                   and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] = c.conkey
             )",
        );
        $names = array_column($rows, 'name');
        sort($names);

        return $names;
    }
}
