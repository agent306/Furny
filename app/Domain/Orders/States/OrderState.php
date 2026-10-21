<?php

declare(strict_types=1);

namespace App\Domain\Orders\States;

use App\Domain\Orders\Enums\OrderStateKey;
use App\Domain\Orders\Models\Order;
use Spatie\ModelStates\State;
use Spatie\ModelStates\StateConfig;

/**
 * `orders.state` (09 §1). One final class per state sits next to this file; the base class finds
 * them by scanning the directory. Only the default is configured here: the transitions of 09 §2
 * (`allowTransition` and the `Transition` classes) arrive with the order workflow (P7, P1-D7).
 *
 * @extends State<Order>
 */
abstract class OrderState extends State
{
    public static function config(): StateConfig
    {
        return parent::config()->default(Draft::class);
    }

    public function key(): OrderStateKey
    {
        return OrderStateKey::from($this->getValue());
    }

    /** Active = every state except `draft`, `closed` and `cancelled` (09 §1). */
    public function isActive(): bool
    {
        return ! in_array($this->key(), [OrderStateKey::Draft, OrderStateKey::Closed, OrderStateKey::Cancelled], true);
    }

    /** Terminal = `closed` and `cancelled`: no transition leaves them (09 §1). */
    public function isTerminal(): bool
    {
        return in_array($this->key(), [OrderStateKey::Closed, OrderStateKey::Cancelled], true);
    }
}
