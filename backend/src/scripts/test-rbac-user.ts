
import { prisma } from "../config/prisma.js";
import { hashPassword } from "../services/password.service.js";

const TEST_EMAIL = "rbac-test@example.com";
const TEST_PHONE = "+989000000000";

async function createTestAdmin() {
  await prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({
      where: {
        name: "PRODUCT_MANAGER",
      },
    });

    if (!role) {
      throw new Error("PRODUCT_MANAGER role not found.");
    }

    const existingAdmin = await tx.adminUser.findUnique({
      where: {
        email: TEST_EMAIL,
      },
    });

    if (existingAdmin) {
      throw new Error(
        "Test admin already exists. Do not create a duplicate."
      );
    }

    const passwordHash = await hashPassword(
      "Temporary-Test-Password-2026!"
    );

    const admin = await tx.adminUser.create({
      data: {
        name: "RBAC Test User",
        email: TEST_EMAIL,
        phone: TEST_PHONE,
        passwordHash,
        status: "ACTIVE",
        phoneVerifiedAt: new Date(),
      },
    });

    await tx.adminUserRole.create({
      data: {
        adminUserId: admin.id,
        roleId: role.id,
      },
    });

    console.log("Test admin created successfully!");
    console.log(`Email: ${admin.email}`);
    console.log(`Role: ${role.name}`);
    console.log(`Admin ID: ${admin.id}`);
  });
}

createTestAdmin().catch((error) => {
    console.error("Test admin creation failed:", error);
    process.exitCode = 1;
}).finally(async () => {
    await prisma.$disconnect();
});
