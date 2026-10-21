<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_items', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('order_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('furniture_design_id')->constrained()->restrictOnDelete();
            $table->foreignUlid('furniture_revision_id')->nullable()->constrained()->restrictOnDelete();
            $table->smallInteger('quantity')->default(1);
            $table->string('room_label', 80)->nullable();
            $table->text('customer_notes')->nullable();
            $table->text('staff_notes')->nullable();
            $table->smallInteger('sort_order')->default(0);
            $table->timestampsTz();

            $table->unique(['order_id', 'furniture_design_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
    }
};
