<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('furniture_revisions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('furniture_design_id')->constrained()->cascadeOnDelete();
            $table->integer('number');
            $table->jsonb('document');
            $table->smallInteger('schema_version');
            $table->jsonb('bom')->nullable();
            $table->jsonb('price')->nullable();
            $table->string('bom_status', 16)->default('pending');
            $table->string('engine_version', 16)->nullable();
            $table->integer('catalog_version')->nullable();
            $table->string('reason', 24);
            $table->foreignUlid('author_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('author_kind', 8);
            $table->jsonb('change_summary')->nullable();
            // Immutable rows: created_at only, no updated_at (02 §5.2).
            $table->timestampTz('created_at');

            $table->unique(['furniture_design_id', 'number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('furniture_revisions');
    }
};
