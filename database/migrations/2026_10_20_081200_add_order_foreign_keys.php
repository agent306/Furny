<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The keys that point at tables created after their own (02 §15 group 8): the two quote ids of
 * `orders` and the order lock of `furniture_designs`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->foreign('accepted_quote_id')->references('id')->on('quotes')->nullOnDelete();
            $table->foreign('current_quote_id')->references('id')->on('quotes')->nullOnDelete();
        });

        Schema::table('furniture_designs', function (Blueprint $table): void {
            $table->foreign('locked_by_order_id')->references('id')->on('orders')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('furniture_designs', function (Blueprint $table): void {
            $table->dropForeign(['locked_by_order_id']);
        });

        Schema::table('orders', function (Blueprint $table): void {
            $table->dropForeign(['current_quote_id']);
            $table->dropForeign(['accepted_quote_id']);
        });
    }
};
