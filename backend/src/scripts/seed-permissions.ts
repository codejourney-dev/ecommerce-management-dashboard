
import { prisma } from "../config/prisma.js";

const permissions = [
  // Dashboard
  {
    name: "dashboard.view",
    description: "View the admin dashboard",
  },

  // Admins
  {
    name: "admins.view",
    description: "View admin users",
  },
  {
    name: "admins.create",
    description: "Create admin users",
  },
  {
    name: "admins.update",
    description: "Update admin users",
  },
  {
    name: "admins.delete",
    description: "Delete admin users",
  },

  // Roles
  {
    name: "roles.view",
    description: "View roles",
  },
  {
    name: "roles.create",
    description: "Create roles",
  },
  {
    name: "roles.update",
    description: "Update roles",
  },
  {
    name: "roles.delete",
    description: "Delete roles",
  },

  // Products
  {
    name: "products.view",
    description: "View products",
  },
  {
    name: "products.create",
    description: "Create products",
  },
  {
    name: "products.update",
    description: "Update products",
  },
  {
    name: "products.delete",
    description: "Delete products",
  },

  // Categories
  {
    name: "categories.view",
    description: "View categories",
  },
  {
    name: "categories.create",
    description: "Create categories",
  },
  {
    name: "categories.update",
    description: "Update categories",
  },
  {
    name: "categories.delete",
    description: "Delete categories",
  },

  // Orders
  {
    name: "orders.view",
    description: "View orders",
  },
  {
    name: "orders.update",
    description: "Update orders",
  },

  // Payments
  {
    name: "payments.view",
    description: "View payments",
  },
  {
    name: "payments.manage",
    description: "Manage payment operations",
  },

  // Inventory
  {
    name: "inventory.view",
    description: "View inventory",
  },
  {
    name: "inventory.manage",
    description: "Manage inventory",
  },

  // Customers
  {
    name: "customers.view",
    description: "View customers",
  },
  {
    name: "customers.update",
    description: "Update customer information",
  },

  // Coupons
  {
    name: "coupons.view",
    description: "View coupons",
  },
  {
    name: "coupons.create",
    description: "Create coupons",
  },
  {
    name: "coupons.update",
    description: "Update coupons",
  },
  {
    name: "coupons.delete",
    description: "Delete coupons",
  },

  // Reports
  {
    name: "reports.view",
    description: "View reports",
  },

  // Settings
  {
    name: "settings.view",
    description: "View settings",
  },
  {
    name: "settings.update",
    description: "Update settings",
  },
];

async function seedPermissions() {
  await prisma.$transaction(async (tx) => {
    // Find SUPER_ADMIN role
    const superAdminRole = await tx.role.findUnique({
      where: {
        name: "SUPER_ADMIN",
      },
    });

    if (!superAdminRole) {
      throw new Error(
        "SUPER_ADMIN role not found. Run the admin bootstrap first."
      );
    }

    const permissionIds: string[] = [];

    // Create or update permissions
    for (const permission of permissions) {
      const result = await tx.permission.upsert({
        where: {
          name: permission.name,
        },
        update: {
          description: permission.description,
        },
        create: permission,
      });

      permissionIds.push(result.id);
    }

    // Assign all permissions to SUPER_ADMIN
    const result = await tx.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({
        roleId: superAdminRole.id,
        permissionId,
      })),
      skipDuplicates: true,
    });

    console.log("Permissions seeded successfully!");
    console.log(`Total permissions: ${permissionIds.length}`);
    console.log(`New role assignments: ${result.count}`);
  });
}

seedPermissions()
  .catch((error) => {
    console.error("Permission seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
