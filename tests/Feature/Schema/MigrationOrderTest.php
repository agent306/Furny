<?php

declare(strict_types=1);

/**
 * 02 §15: one migration file per table, in dependency order, none added or missing. A new
 * migration changes this list on purpose; the order of the names is the order they run in.
 */
it('has exactly the migrations of 02 §15, in that order', function (): void {
    $files = glob(database_path('migrations/*.php')) ?: [];
    $names = array_map(static fn (string $file): string => basename($file, '.php'), $files);
    sort($names);

    $expected = array_map(static fn (string $name): string => '2026_10_20_'.$name, [
        '010000_create_users_table',
        '010100_create_addresses_table',
        '010200_create_password_reset_tokens_table',
        '010300_create_otp_codes_table',
        '010400_create_notification_preferences_table',
        '010500_create_staff_invitations_table',
        '020000_create_permission_tables',
        '020100_create_media_table',
        '020200_create_activity_log_table',
        '020300_create_notifications_table',
        '020400_create_notification_deliveries_table',
        '020500_create_push_subscriptions_table',
        '020600_create_upload_intents_table',
        '020700_create_jobs_table',
        '020800_create_job_batches_table',
        '020900_create_failed_jobs_table',
        '021000_create_cache_table',
        '021100_create_sessions_table',
        '021200_create_pulse_tables',
        '021300_create_telescope_entries_table',
        '030000_create_app_settings_table',
        '030100_create_number_sequences_table',
        '040000_create_projects_table',
        '040100_create_plans_table',
        '040200_create_plan_revisions_table',
        '040300_add_current_revision_fk_to_plans_table',
        '050000_create_materials_table',
        '050100_create_edge_bands_table',
        '050200_create_hardware_items_table',
        '050300_create_finishes_table',
        '050400_create_labour_rates_table',
        '050500_create_tax_rates_table',
        '060000_create_furniture_presets_table',
        '060100_create_furniture_template_settings_table',
        '060200_create_furniture_designs_table',
        '060300_create_furniture_revisions_table',
        '060400_add_current_revision_fk_to_furniture_designs_table',
        '070000_create_blueprint_imports_table',
        '080000_create_orders_table',
        '080100_create_order_items_table',
        '080200_create_change_proposals_table',
        '080300_create_change_proposal_items_table',
        '080400_create_quotes_table',
        '080500_create_quote_lines_table',
        '080600_create_quote_negotiations_table',
        '080700_create_confirmation_calls_table',
        '080800_create_production_updates_table',
        '080900_create_order_issues_table',
        '081000_create_deliveries_table',
        '081100_create_payments_table',
        '081200_add_order_foreign_keys',
        '090000_create_messages_table',
        '090100_create_message_reads_table',
        '100000_create_ai_credit_ledger_table',
        '100100_create_ai_usage_events_table',
    ]);

    expect($names)->toBe($expected);
});
