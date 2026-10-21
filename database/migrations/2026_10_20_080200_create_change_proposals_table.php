<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('change_proposals', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('order_id')->constrained()->cascadeOnDelete();
            $table->smallInteger('number');
            $table->string('status', 16)->default('draft');
            $table->text('message')->nullable();
            $table->foreignUlid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->timestampTz('withdrawn_at')->nullable();
            $table->text('customer_comment')->nullable();
            $table->timestampsTz();

            $table->unique(['order_id', 'number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('change_proposals');
    }
};
