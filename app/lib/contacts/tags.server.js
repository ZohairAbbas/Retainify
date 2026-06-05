import prisma from "../../db.server.js";

const PALETTE = ["forest", "blue", "amber", "purple", "tan", "red"];

export async function upsertTag(shop, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const nameKey = trimmed.toLowerCase();

  const existing = await prisma.tag.findUnique({
    where: { shop_nameKey: { shop, nameKey } },
  });
  if (existing) return existing;

  const count = await prisma.tag.count({ where: { shop } });
  const color = PALETTE[count % PALETTE.length];
  return prisma.tag.create({
    data: { shop, name: trimmed, nameKey, color },
  });
}

export async function applyTag(contactId, tagId) {
  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId } },
    create: { contactId, tagId },
    update: {},
  });
}

export async function removeTag(contactId, tagId) {
  await prisma.contactTag.deleteMany({ where: { contactId, tagId } });
}

export async function listTagsForShop(shop) {
  const tags = await prisma.tag.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { contacts: true } } },
  });
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    contactCount: t._count.contacts,
  }));
}

export async function applyTagByName(shop, contactId, name) {
  const tag = await upsertTag(shop, name);
  if (!tag) return null;
  await applyTag(contactId, tag.id);
  return tag;
}

export async function bulkApplyTag(shop, contactIds, tagId) {
  await prisma.contactTag.createMany({
    data: contactIds.map((contactId) => ({ contactId, tagId })),
    skipDuplicates: true,
  });
}

const VALID_COLORS = new Set(["forest", "blue", "amber", "purple", "tan", "red"]);

// Rename a tag in place. We also update nameKey (the lowercased uniqueness
// key) so the post-rename tag still de-dupes by case-insensitive name.
// Throws on the unique-constraint collision so the route can surface a
// friendly error.
export async function renameTag(shop, id, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Name is required");
  const nameKey = trimmed.toLowerCase();
  return prisma.tag.update({
    where: { id },
    data: { name: trimmed, nameKey },
  });
}

export async function recolorTag(shop, id, color) {
  if (!VALID_COLORS.has(color)) throw new Error("Unknown color");
  return prisma.tag.update({ where: { id }, data: { color } });
}

export async function deleteTag(shop, id) {
  // ContactTag cascades via Prisma's onDelete on the relation, so we only
  // need to delete the Tag row.
  await prisma.tag.delete({ where: { id } });
}
