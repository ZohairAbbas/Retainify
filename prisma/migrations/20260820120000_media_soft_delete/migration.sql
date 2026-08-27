-- Soft delete for media assets. Removing an asset from the library must not
-- break images in emails that have already been delivered, so the row (and the
-- bytes it points at) survive removal and only stop appearing in the picker.
ALTER TABLE "MediaAsset" ADD COLUMN "deletedAt" TIMESTAMP(3);
