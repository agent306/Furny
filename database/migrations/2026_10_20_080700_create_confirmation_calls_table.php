<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('confirmation_calls', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            // Plain join-key index 02 omits: calls are read per order.
            $table->foreignUlid('order_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignUlid('staff_id')->index()->constrained('users')->restrictOnDelete();
            $table->timestampTz('called_at');
            $table->string('phone_e164', 20);
            $table->string('outcome', 24);
            $table->text('notes')->nullable();
            $table->timestampTz('callback_at')->nullable();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('confirmation_calls');
    }
};
