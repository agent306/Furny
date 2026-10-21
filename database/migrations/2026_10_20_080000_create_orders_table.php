<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('number', 20);
            $table->foreignUlid('project_id')->index()->constrained()->restrictOnDelete();
            $table->foreignUlid('customer_id')->constrained('users')->restrictOnDelete();
            $table->string('state', 32)->default('draft');
            $table->string('state_before_hold', 32)->nullable();
            $table->foreignUlid('assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('production_assignee_id')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->string('title', 160);
            $table->text('customer_notes')->nullable();
            $table->foreignUlid('site_address_id')->nullable()->index()->constrained('addresses')->nullOnDelete();
            $table->boolean('needs_installation')->default(true);
            $table->date('preferred_delivery_on')->nullable();
            $table->date('expected_delivery_on')->nullable();
            // The foreign keys to quotes are added with the quotes table (02 §15 group 8, Task 11).
            $table->ulid('accepted_quote_id')->nullable()->index();
            $table->ulid('current_quote_id')->nullable()->index();
            $table->smallInteger('production_progress')->default(0);
            $table->string('production_stage', 32)->nullable();
            $table->string('cancel_reason', 32)->nullable();
            $table->text('cancel_note')->nullable();
            $table->timestampTz('submitted_at')->nullable();
            $table->timestampTz('reviewed_at')->nullable();
            $table->timestampTz('quoted_at')->nullable();
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampTz('production_started_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('customer_approved_at')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->timestampTz('last_customer_activity_at')->nullable();
            $table->timestampTz('last_staff_activity_at')->nullable();
            $table->timestampTz('state_changed_at')->default(DB::raw('now()'));
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->unique('number');
            $table->index(['state', 'updated_at']);
            $table->index(['state', 'state_changed_at']);
            $table->index(['customer_id', 'created_at']);
            $table->index(['assigned_to', 'state']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
