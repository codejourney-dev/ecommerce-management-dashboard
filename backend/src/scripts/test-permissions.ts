
import { prisma } from "../config/prisma.js";
import { hasPermission } from "../services/permission.service.js";

async function testPermissions() {
  const testAdmin = await prisma.adminUser.findUnique({
    where: {
      email: "rbac-test@example.com",
    },
    select: {
      id: true,
      email: true,
    },
  });

  if (!testAdmin) {
    throw new Error("Test admin not found.");
  }

  const tests = [
    { permission: "dashboard.view", expected: true },
    { permission: "products.create", expected: true },
    { permission: "inventory.manage", expected: true },
    { permission: "orders.update", expected: false },
    { permission: "payments.manage", expected: false },
    { permission: "admins.delete", expected: false },
  ];

  console.log(`Testing permissions for: ${testAdmin.email}\n`);

  let passed = 0;

  for (const test of tests) {
    const result = await hasPermission(
      testAdmin.id,
      test.permission
    );

    const success = result === test.expected;

    if (success) passed++;

    console.log(
      `${test.permission}: ${result} | Expected: ${test.expected} | ${
        success ? "PASS" : "FAIL"
      }`
    );
  }

  console.log(`\nResults: ${passed}/${tests.length} passed`);

  if (passed !== tests.length) {
    throw new Error("Some permission tests failed.");
  }
}

testPermissions().catch((error) => {
    console.error("Permission test failed:", error);
    process.exitCode = 1;
}).finally(async () => {
    await prisma.$disconnect();
});
