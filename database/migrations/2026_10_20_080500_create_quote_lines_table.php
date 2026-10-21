<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quote_lines', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            // Postgres does not index foreign keys and 02 lists no index here: the quote's lines are read by this key.
            $table->foreignUlid('quote_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignUlid('order_item_id')->nullable()->constrained()->nullOnDelete();
            $table->string('kind', 16);
            $table->string('description', 255);
            $table->jsonb('details')->nullable();
            $table->decimal('quantity', 12, 3)->default(1);
            $table->string('unit', 16)->default('item');
            $table->bigInteger('unit_price_minor');
            $table->bigInteger('amount_minor');
            $table->foreignUlid('tax_rate_id')->nullable()->constrained()->nullOnDelete();
            $table->boolean('is_visible_to_customer')->default(true);
            $table->smallInteger('sort_order')->default(0);
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quote_lines');
    }
};
