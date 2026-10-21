<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('deliveries', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('order_id')->constrained()->cascadeOnDelete();
            $table->timestampTz('scheduled_for')->nullable();
            $table->timestampTz('scheduled_until')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->boolean('installed')->default(false);
            $table->string('recipient_name', 120)->nullable();
            $table->text('notes')->nullable();
            $table->foreignUlid('recorded_by')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique('order_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deliveries');
    }
};
