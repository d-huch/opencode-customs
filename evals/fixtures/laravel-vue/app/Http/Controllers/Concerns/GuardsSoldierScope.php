<?php

namespace App\Http\Controllers\Concerns;

trait GuardsSoldierScope
{
    protected function ensureSoldierScopeAccess(object $soldier): void
    {
        abort_unless($soldier->unit_id === auth()->user()->unit_id, 403);
    }
}
