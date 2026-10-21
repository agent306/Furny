<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('order_id')->constrained()->restrictOnDelete();
            $table->foreignUlid('quote_id')->nullable()->constrained()->nullOnDelete();
            $table->string('kind', 16);
            $table->bigInteger('amount_minor');
            $table->char('currency', 3);
            $table->string('method', 24);
            $table->string('status', 16);
            $table->string('gateway', 24)->nullable();
            $table->string('gateway_reference', 120)->nullable();
            $table->timestampTz('paid_at')->nullable();
            $table->foreignUlid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
