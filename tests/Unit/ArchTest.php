<?php

declare(strict_types=1);

arch('strict types')->expect('App')->toUseStrictTypes();

arch('no debug calls')->expect(['dd', 'dump', 'ray', 'var_dump'])->not->toBeUsed();
