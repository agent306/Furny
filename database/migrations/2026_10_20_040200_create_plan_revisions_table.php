<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_revisions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('plan_id')->constrained()->cascadeOnDelete();
            $table->integer('number');
            $table->jsonb('document');
            $table->smallInteger('schema_version');
            $table->string('reason', 24);
            $table->string('label', 120)->nullable();
            $table->foreignUlid('author_id')->nullable()->index()->constrained('users')->nullOnDelete();
            // Immutable rows: created_at only, no updated_at (02 §3.3).
            $table->timestampTz('created_at');

            $table->unique(['plan_id', 'number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_revisions');
    }
};
