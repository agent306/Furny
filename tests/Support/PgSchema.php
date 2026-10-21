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
     * information_schema row of one column: data_type, udt_name, character_maximum_length, is_nullable, column_default.
     *
     * @return array<string, mixed>
     */
    public static function column(string $table, string $column): array
    {
        $row = DB::selectOne(
            'select data_type, udt_name, character_maximum_length, is_nullable, column_default
             from information_schema.columns
             where table_schema = current_schema() and table_name = ? and column_name = ?',
            [$table, $column],
        );

        return (array) $row;
    }

    public static function indexDefinition(string $table, string $index): ?string
    {
        $row = DB::selectOne(
            'select indexdef from pg_indexes where schemaname = current_schema() and tablename = ? and indexname = ?',
            [$table, $index],
        );

        return $row?->indexdef;
    }
}
