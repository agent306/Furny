<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quote_negotiations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('quote_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('order_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('customer_id')->constrained('users')->restrictOnDelete();
            $table->bigInteger('proposed_total_minor')->nullable();
            $table->text('message');
            $table->jsonb('item_comments')->default('[]');
            // 02 §8.7 says 16, but `answered_with_revision` has 22 characters: the default 32 of 02 §0.
            $table->string('status', 32)->default('open');
            $table->foreignUlid('answered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('answer_message')->nullable();
            $table->timestampTz('answered_at')->nullable();
            $table->foreignUlid('resulting_quote_id')->nullable()->constrained('quotes')->nullOnDelete();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quote_negotiations');
    }
};
