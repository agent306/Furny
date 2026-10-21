<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('production_updates', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('order_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('author_id')->constrained('users')->restrictOnDelete();
            $table->string('stage', 32);
            $table->smallInteger('progress');
            $table->string('title', 160);
            $table->text('body')->nullable();
            $table->string('visibility', 16)->default('customer');
            $table->boolean('is_completion')->default(false);
            $table->timestampsTz();

            $table->index(['order_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('production_updates');
    }
};
