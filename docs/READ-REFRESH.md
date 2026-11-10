# Read refresh contract

Sidebar statistics have per-tab account/session/shop ownership and last-started response authority. Startup and routine polling may share an identical pending request; explicit mutation refreshes supersede it. Hidden tabs perform no routine stats polling. Errors back off from 24 seconds to a 5-minute cap; success returns to 12 seconds. Returning to a visible tab refreshes when due. Explicit user/mutation reads are not blocked by routine backoff.

Warehouse data belongs to the loaded account/session, not the warehouse modal generation or active shop. Starting a different owner clears previous data. Same-owner read failure retains last good HQ data and reports failure. Movement dispatch requires a fresh successful read and unchanged launching account, shop, form and navigation generation. No modal opens after a failed or superseded read.

Analytics and expenses capture their filters and authenticated session. Late success/failure cannot replace the current result. Print requires the exact loaded scope. A loading failure displays a Retry control. Expired sessions cancel business dialogs and release inert background controls before showing sign-in.

This does not claim all legacy screens have been converted to one state framework. No cross-tab leader, tenant-independent cache, new money calculation or new API shape is introduced.
