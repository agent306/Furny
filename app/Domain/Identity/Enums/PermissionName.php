<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * The 24 spatie permissions (guard `web`) of 13 §7.1. No other permission names exist (master D17, D18).
 * Customers hold none: their access is decided by ownership policies.
 */
#[TypeScript]
enum PermissionName: string
{
    case OrdersView = 'orders.view';
    case OrdersReview = 'orders.review';
    case OrdersAssign = 'orders.assign';
    case OrdersProposeChanges = 'orders.propose_changes';
    case QuotesCreate = 'quotes.create';
    case QuotesSend = 'quotes.send';
    case QuotesViewCosts = 'quotes.view_costs';
    case OrdersConfirm = 'orders.confirm';
    case OrdersCancel = 'orders.cancel';
    case OrdersHold = 'orders.hold';
    case OrdersClose = 'orders.close';
    case ProductionManage = 'production.manage';
    case MessagesPost = 'messages.post';
    case CustomersView = 'customers.view';
    case CustomersManage = 'customers.manage';
    case CatalogManage = 'catalog.manage';
    case PresetsManage = 'presets.manage';
    case TemplatesManage = 'templates.manage';
    case SettingsManage = 'settings.manage';
    case StaffManage = 'staff.manage';
    case AiManage = 'ai.manage';
    case ReportsView = 'reports.view';
    case PlansEditAny = 'plans.edit_any';
    case AuditView = 'audit.view';
}
