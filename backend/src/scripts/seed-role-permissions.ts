
import { prisma } from "../config/prisma.js";

const rolePermissions: Record<string, string[]> = {
  ADMIN: [
    "dashboard.view",
    "admins.view",

    "products.view",
    "products.create",
    "products.update",
    "products.delete",

    "categories.view",
    "categories.create",
    "categories.update",
    "categories.delete",

    "orders.view",
    "orders.update",

    "payments.view",
    "payments.manage",

    "inventory.view",
    "inventory.manage",

    "customers.view",
    "customers.update",

    "coupons.view",
    "coupons.create",
    "coupons.update",
    "coupons.delete",

    "reports.view",
    "settings.view",
  ],

  PRODUCT_MANAGER: [
    "dashboard.view",

    "products.view",
    "products.create",
    "products.update",
    "products.delete",

    "categories.view",
    "categories.create",
    "categories.update",
    "categories.delete",

    "inventory.view",
    "inventory.manage",
  ],

  ORDER_MANAGER: [
    "dashboard.view",

    "orders.view",
    "orders.update",

    "payments.view",
    "payments.manage",

    "inventory.view",
    "customers.view",

    "reports.view",
  ],

  SUPPORT: [
    "dashboard.view",
    "orders.view",
    "customers.view",
  ],
};

async function seedRolePermissions() {
  await prisma.$transaction(async (tx) => {
    for (const [roleName, permissionNames] of Object.entries(
      rolePermissions
    )) {
      // Find role
      const role = await tx.role.findUnique({
        where: { name: roleName },
      });

      if (!role) {
        throw new Error(`Role not found: ${roleName}`);
      }

      // Find permissions
      const permissions = await tx.permission.findMany({
        where: {
          name: {
            in: permissionNames,
          },
        },
        select: {
          id: true,
          name: true,
        },
      });

      // Check for missing permissions
      const foundNames = new Set(
        permissions.map((permission) => permission.name)
      );

      const missingPermissions = permissionNames.filter(
        (name) => !foundNames.has(name)
      );

      if (missingPermissions.length > 0) {
        throw new Error(
          `Missing permissions for ${roleName}: ${missingPermissions.join(", ")}`
        );
      }

      // Assign permissions to role
      const result = await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });

      console.log(
        `${roleName}: ${result.count} new permissions assigned.`
      );
    }
  });

  console.log("Role permissions seeded successfully!");
}

seedRolePermissions().catch((error) => {
    console.error("Role permission seeding failed:", error);
    process.exitCode = 1;
}).finally(async () => {
    await prisma.$disconnect();
});
