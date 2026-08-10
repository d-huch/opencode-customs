<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\GuardsSoldierScope;
use App\Services\OffenderJournalService;

final class OffenderJournalController
{
    use GuardsSoldierScope;

    public function __construct(private OffenderJournalService $service)
    {
    }

    public function index()
    {
        return response()->json($this->service->all());
    }
}
