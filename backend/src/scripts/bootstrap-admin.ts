
import readline from "node:readline";
import { prisma } from "../config/prisma.js";
import { hashPassword } from "../services/password.service.js";
import { AdminStatus } from "../../generated/prisma/client.js";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error("Hidden password input requires an interactive terminal."));
      return;
    }

    let password = "";

    process.stdout.write(question);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (key: string) => {
      if (key === "\u0003") {
        cleanup();
        reject(new Error("Operation cancelled."));
        return;
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(password);
        return;
      }

      if (key === "\u007f" || key === "\b") {
        password = password.slice(0, -1);
        return;
      }

      if (key >= " " && key !== "\u007f") {
        password += key;
      }
    };

    process.stdin.on("data", onData);
  });
}

async function main() {
  console.log("\n=== Admin Bootstrap ===\n");

  const name = await ask("Admin name: ");
  const email = (await ask("Admin email: ")).toLowerCase();
  const phone = await ask("Admin phone: ");

  if (!name || !email || !phone) {
    throw new Error("All fields are required.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email address.");
  }

  if (!/^\+?[0-9]{10,15}$/.test(phone)) {
    throw new Error("Invalid phone number.");
  }

  const password = await askHidden("Admin password: ");
  const confirmPassword = await askHidden("Confirm password: ");

  if (password.length < 12) {
    throw new Error("Password must contain at least 12 characters.");
  }

  if (password !== confirmPassword) {
    throw new Error("Passwords do not match.");
  }

  const passwordHash = await hashPassword(password);

  const admin = await prisma.$transaction(async (tx) => {
    // Prevent simultaneous bootstrap executions.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8273641)`;

    const existingAdmins = await tx.adminUser.count();

    if (existingAdmins > 0) {
      throw new Error(
        "Bootstrap is only allowed when the admin_users table is empty."
      );
    }

    const superAdminRole = await tx.role.upsert({
      where: { name: "SUPER_ADMIN" },
      update: {},
      create: {
        name: "SUPER_ADMIN",
        description: "Full system access",
      },
    });

    const newAdmin = await tx.adminUser.create({
      data: {
        name,
        email,
        phone,
        passwordHash,
        status: AdminStatus.ACTIVE,
        phoneVerifiedAt: new Date(),
      },
    });

    await tx.adminUserRole.create({
      data: {
        adminUserId: newAdmin.id,
        roleId: superAdminRole.id,
      },
    });

    return newAdmin;
  });

  console.log("\nAdmin created successfully!");
  console.log(`Admin ID: ${admin.id}`);
  console.log(`Email: ${admin.email}`);
  console.log("Role: SUPER_ADMIN");
}

main()
  .catch((error: unknown) => {
    console.error("\nBootstrap failed:");

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
