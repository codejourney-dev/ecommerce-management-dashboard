
import { prisma } from "../config/prisma.js";

const roles = [
  {
    name: "SUPER_ADMIN",
    description: "System owner with full access to all resources",
  },
  {
    name: "ADMIN",
    description: "Manages general store operations",
  },
  {
    name: "PRODUCT_MANAGER",
    description: "Manages products, categories, and inventory",
  },
  {
    name: "ORDER_MANAGER",
    description: "Manages orders, payments, and order operations",
  },
  {
    name: "SUPPORT",
    description: "Handles customer support and inquiries",
  },
];

async function seedRoles() {
  await prisma.$transaction(async (tx) => {
    for (const role of roles) {
      await tx.role.upsert({
        where: {
          name: role.name,
        },
        update: {
          description: role.description,
        },
        create: role,
      });
    }
  });

  console.log("Roles seeded successfully!");
  console.log(`Total roles: ${roles.length}`);
}

seedRoles().catch((error) => {
    console.error("Role seeding failed:", error);
    process.exitCode = 1;
}).finally(async () => {
    await prisma.$disconnect();
});
