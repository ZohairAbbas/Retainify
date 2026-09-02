-- Normalize PushSubscription.contactEmail, and repair the contacts it broke.
--
-- PushSubscription.contactEmail was written with whatever case the browser
-- happened to send, while Contact.email is lowercased and trimmed on every
-- write. Every consumer joins the two on that column, so a subscription saved
-- with a capital letter matched no contact at all: not the new pushEnabled
-- rollup, and not the push worker looking up a recipient's endpoints either --
-- meaning those browsers were silently never sent to.
--
-- Three rows in this database are in that state, and their contacts read
-- pushEnabled = false while holding a live subscription. The subscribe route
-- now lowercases on write; this repairs what is already stored.
--
-- Split from 20260903120000_add_contact_engagement_rollup, which had already
-- been applied by the time this was found -- an applied migration is not
-- something to amend, or environments diverge depending on when they ran it.

UPDATE "PushSubscription"
   SET "contactEmail" = lower(btrim("contactEmail"))
 WHERE "contactEmail" IS NOT NULL
   AND "contactEmail" <> lower(btrim("contactEmail"));

-- Re-derive pushEnabled now that the join key matches. A recompute over every
-- contact rather than a targeted fix: it is one pass, and it also corrects any
-- row the original backfill got wrong for reasons other than casing.
UPDATE "Contact" c
   SET "pushEnabled" = EXISTS (
         SELECT 1 FROM "PushSubscription" p
          WHERE p."isActive"
            AND p."shop" = c."shop"
            AND p."contactEmail" = c."email"
       )
 WHERE c."pushEnabled" <> EXISTS (
         SELECT 1 FROM "PushSubscription" p
          WHERE p."isActive"
            AND p."shop" = c."shop"
            AND p."contactEmail" = c."email"
       );
