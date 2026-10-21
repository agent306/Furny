<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_issues', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            // Plain join-key index 02 omits: issues are read per order.
            $table->foreignUlid('order_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignUlid('order_item_id')->nullable()->index()->constrained()->nullOnDelete();
            $table->foreignUlid('raised_by')->index()->constrained('users')->restrictOnDelete();
            $table->text('description');
            $table->string('status', 16)->default('open');
            $table->text('resolution_note')->nullable();
            $table->foreignUlid('resolved_by')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->timestampTz('resolved_at')->nullable();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_issues');
    }
};
