<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('owner_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('created_by')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->string('name', 120);
            $table->string('property_type', 24)->default('apartment');
            $table->foreignUlid('site_address_id')->nullable()->index()->constrained('addresses')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->string('status', 16)->default('active');
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['owner_id', 'status', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('projects');
    }
};
