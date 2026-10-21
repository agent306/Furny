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
        Schema::create('quotes', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('order_id')->constrained()->cascadeOnDelete();
            $table->smallInteger('version');
            $table->string('number', 24);
            $table->string('status', 16)->default('draft');
            $table->char('currency', 3);
            $table->boolean('prices_include_tax');
            $table->bigInteger('subtotal_minor')->default(0);
            $table->bigInteger('discount_minor')->default(0);
            $table->bigInteger('tax_minor')->default(0);
            $table->bigInteger('total_minor')->default(0);
            $table->jsonb('tax_breakdown')->default('[]');
            $table->date('valid_until');
            $table->smallInteger('lead_time_days')->nullable();
            $table->text('notes_to_customer')->nullable();
            $table->text('terms');
            $table->text('internal_notes')->nullable();
            $table->jsonb('cost_snapshot')->default('{}');
            $table->integer('catalog_version');
            $table->string('engine_version', 16);
            $table->foreignUlid('created_by')->index()->constrained('users')->restrictOnDelete();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('declined_at')->nullable();
            $table->timestampTz('expired_at')->nullable();
            $table->timestampTz('superseded_at')->nullable();
            $table->timestampTz('withdrawn_at')->nullable();
            $table->text('decline_reason')->nullable();
            // `inet` on PostgreSQL.
            $table->ipAddress('accepted_by_ip')->nullable();
            $table->timestampsTz();

            $table->unique(['order_id', 'version']);
            $table->unique('number');
        });

        // At most one sent quote per order (02 §8.5): the customer always sees a single open offer.
        DB::statement("create unique index quotes_one_sent_per_order on quotes (order_id) where status = 'sent'");
    }

    public function down(): void
    {
        Schema::dropIfExists('quotes');
    }
};
